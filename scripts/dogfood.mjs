#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CI_TASKS } from "./lib/ci-tasks.mjs";
import { snapshotTemplate, spliceCommand, spliceNewArgs } from "./lib/splice.mjs";
import { renderNew } from "./render.mjs";

const TEMPLATE = fileURLToPath(new URL("../template", import.meta.url));
const COMBOS = new URL("./combos.json", import.meta.url);

/** The CI command every rendered combo runs (parity with generated CI). */
export const ciCommand = () => ["pnpm", "turbo", "run", ...CI_TASKS];

const CHECK_SINGLE_VITE = fileURLToPath(new URL("./check-single-vite.mjs", import.meta.url));
const RUST_PIECES = new Set(["rust-tool", "rust-cli"]);
const VITE_PIECES = new Set(["preact-app", "ui-storybook", "astro-site"]);

/** Steps run in each rendered combo; `check-single-vite` for combos with Vite pieces. */
export function comboSteps(cacheDir, pieces = [], dir = ".", renderer = "dev") {
  const [cmd, ...args] = ciCommand();
  // splice already ran the [[post]] hooks (pnpm install, cargo generate-lockfile, agents index)
  const steps =
    renderer === "splice"
      ? spliceSteps(cmd, args, cacheDir)
      : [
          ["git", ["init", "-q"]],
          ["pnpm", ["install", "--no-frozen-lockfile", "--prefer-offline"]],
          // the rust-tool and rust-cli [[post]] hooks, which the dev renderer does not run; keeps Cargo.lock (a turbo
          // input) stable, so a second run hits the cache
          ...(pieces.some((p) => RUST_PIECES.has(p.split(":")[0]))
            ? [["cargo", ["generate-lockfile"]]]
            : []),
          // the base [[post]] hook, which the dev renderer does not run
          ["node", ["scripts/agents-index.mjs"]],
          [cmd, [...args, `--cache-dir=${cacheDir}`]],
          ["node", ["scripts/agents-index.mjs", "--check"]],
        ];
  if (pieces.some((p) => VITE_PIECES.has(p.split(":")[0]))) {
    steps.push(["node", [CHECK_SINGLE_VITE, dir]]);
  }
  return steps;
}

// splice `new` already ran `git init` and the [[post]] hooks
function spliceSteps(cmd, args, cacheDir) {
  return [
    [cmd, [...args, `--cache-dir=${cacheDir}`]],
    ["node", ["scripts/agents-index.mjs", "--check"]],
  ];
}

const RENDERERS = new Set(["splice", "dev"]);

function run(cmd, args, cwd, prefix = cwd.split(/[\\/]/).pop()) {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    const rest = { out: "", err: "" };
    const emit = (key, chunk, stream) => {
      const lines = (rest[key] + chunk).split("\n");
      rest[key] = lines.pop() ?? "";
      for (const l of lines) stream.write(`[${prefix}] ${l}\n`);
    };
    child.stdout.on("data", (d) => emit("out", d.toString(), process.stdout));
    child.stderr.on("data", (d) => emit("err", d.toString(), process.stderr));
    child.on("error", (e) => {
      process.stderr.write(`[${prefix}] ${e.message}\n`);
      done(1);
    });
    child.on("close", (code) => {
      if (rest.out) process.stdout.write(`[${prefix}] ${rest.out}\n`);
      if (rest.err) process.stderr.write(`[${prefix}] ${rest.err}\n`);
      done(code ?? 1);
    });
  });
}

/**
 * `renderer` is `splice` (default; `SPLICE_BIN` or `pnpm dlx`, see lib/splice.mjs) or `dev`
 * (scripts/render.mjs). splice renders a git snapshot of `template`, uncommitted edits included.
 * @param {{ combos: string[], root?: string, cacheDir?: string, template?: string, renderer?: "splice" | "dev", splice?: string[], run?: (cmd: string, args: string[], cwd: string) => Promise<number> }} opts
 * @returns {Promise<{ name: string, ok: boolean, seconds: number }[]>}
 */
export async function dogfood(opts) {
  const renderer = opts.renderer ?? "splice";
  if (!RENDERERS.has(renderer)) throw new Error(`unknown renderer ${renderer}; use splice or dev`);
  const { vars, combos } = JSON.parse(await readFile(COMBOS, "utf8"));
  const root = resolve(opts.root ?? join(tmpdir(), "hull-dogfood"));
  const [spliceBin, ...spliceArgs] = opts.splice ?? spliceCommand();
  let source;
  const cacheDir = resolve(opts.cacheDir ?? join(root, ".turbo-cache"));
  const results = [];
  const exec = opts.run ?? run;
  for (const name of opts.combos) {
    const combo = combos.find((c) => c.name === name);
    const start = Date.now();
    let ok = false;
    if (!combo) {
      process.stderr.write(`[${name}] unknown combo\n`);
    } else {
      const dir = join(root, name);
      try {
        await rm(dir, { recursive: true, force: true });
        await mkdir(root, { recursive: true });
        if (renderer === "dev") {
          await renderNew({
            template: opts.template ?? TEMPLATE,
            out: dir,
            pieces: combo.pieces,
            vars,
          });
          ok = true;
        } else {
          source ??= await snapshotTemplate(opts.template ?? TEMPLATE, root);
          const args = [...spliceArgs, ...spliceNewArgs(source, dir, combo.pieces, vars)];
          ok = (await exec(spliceBin, args, root, name)) === 0;
        }
      } catch (e) {
        process.stderr.write(`[${name}] ${e.message ?? String(e)}\n`);
      }
      if (ok) {
        for (const [cmd, args] of comboSteps(cacheDir, combo.pieces, dir, renderer)) {
          if ((await exec(cmd, args, dir)) !== 0) {
            ok = false;
            break;
          }
        }
      }
    }
    const seconds = Math.round((Date.now() - start) / 100) / 10;
    process.stdout.write(`${name} ${ok ? "ok" : "FAILED"} ${seconds}s\n`);
    results.push({ name, ok, seconds });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      combo: { type: "string", multiple: true },
      root: { type: "string" },
      "cache-dir": { type: "string" },
      renderer: { type: "string", default: "splice" },
    },
  });
  if (!values.combo?.length) {
    process.stderr.write(
      "usage: dogfood.mjs --combo <name>... [--root <dir>] [--cache-dir <dir>] [--renderer splice|dev]\n",
    );
    process.exit(2);
  }
  const results = await dogfood({
    combos: values.combo,
    root: values.root,
    cacheDir: values["cache-dir"],
    renderer: values.renderer,
  });
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
