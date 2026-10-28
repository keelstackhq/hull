#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CI_TASKS, RUST_CI_STEPS } from "./lib/ci-tasks.mjs";
import { comboTemplate, comboVars, isRustTemplate, loadCombos } from "./lib/combos.mjs";
import { isMain } from "./lib/is-main.mjs";
import { snapshotTemplate, spliceCommand, spliceNewArgs } from "./lib/splice.mjs";
import { renderNew } from "./render.mjs";

const HULL = fileURLToPath(new URL("..", import.meta.url));

/** The CI command every rendered combo runs (parity with generated CI). */
export const ciCommand = () => ["pnpm", "turbo", "run", ...CI_TASKS];

const CHECK_SINGLE_VITE = fileURLToPath(new URL("./check-single-vite.mjs", import.meta.url));
const CHECK_CIRCLECI = fileURLToPath(new URL("./circleci-check.mjs", import.meta.url));
const RUST_PIECES = new Set(["rust-tool", "rust-cli"]);
const VITE_PIECES = new Set(["preact-app", "ui-storybook", "astro-site"]);

/** Steps run in a rendered template-rust combo (spec §15): no pnpm, no turbo. */
export function rustComboSteps(renderer = "dev") {
  const ci = RUST_CI_STEPS.map((s) => {
    const [cmd, ...args] = s.split(" ");
    return [cmd, args];
  });
  // splice already ran `git init` and the [[post]] hooks (cargo generate-lockfile, agents index)
  const setup =
    renderer === "splice"
      ? []
      : [
          ["git", ["init", "-q"]],
          ["cargo", ["generate-lockfile"]],
          ["node", ["scripts/agents-index.mjs"]],
        ];
  return [...setup, ...ci, ["node", ["scripts/agents-index.mjs", "--check"]]];
}

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
          turbo(cmd, args, cacheDir),
          ["node", ["scripts/agents-index.mjs", "--check"]],
        ];
  if (pieces.some((p) => VITE_PIECES.has(p.split(":")[0]))) {
    steps.push(["node", [CHECK_SINGLE_VITE, dir]]);
  }
  // pack .circleci/src with the pinned CLI and check it (S§12 item 3)
  if (pieces.some((p) => p.split(":")[0] === "circleci")) {
    steps.push(["node", [CHECK_CIRCLECI, dir]]);
  }
  return steps;
}

// splice `new` already ran `git init` and the [[post]] hooks
// no cache dir with a remote cache (hoard sets TURBO_API)
const turbo = (cmd, args, cacheDir) => [
  cmd,
  cacheDir ? [...args, `--cache-dir=${cacheDir}`] : args,
];

function spliceSteps(cmd, args, cacheDir) {
  return [turbo(cmd, args, cacheDir), ["node", ["scripts/agents-index.mjs", "--check"]]];
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
  const { vars, combos } = loadCombos();
  const root = resolve(opts.root ?? join(tmpdir(), "hull-dogfood"));
  const [spliceBin, ...spliceArgs] = opts.splice ?? spliceCommand();
  /** @type {Map<string, string>} template dir → splice source */
  const sources = new Map();
  const cacheDir = opts.cacheDir
    ? resolve(opts.cacheDir)
    : process.env.TURBO_API
      ? undefined
      : join(root, ".turbo-cache");
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
        const template = opts.template ?? join(HULL, comboTemplate(combo));
        const cvars = comboVars(combo, vars);
        if (renderer === "dev") {
          await renderNew({ template, out: dir, pieces: combo.pieces, vars: cvars });
          ok = true;
        } else {
          if (!sources.has(template)) sources.set(template, await snapshotTemplate(template, root));
          const source = sources.get(template);
          const args = [...spliceArgs, ...spliceNewArgs(source, dir, combo.pieces, cvars)];
          ok = (await exec(spliceBin, args, root, name)) === 0;
        }
      } catch (e) {
        process.stderr.write(`[${name}] ${e.message ?? String(e)}\n`);
      }
      if (ok) {
        const steps = isRustTemplate(combo)
          ? rustComboSteps(renderer)
          : comboSteps(cacheDir, combo.pieces, dir, renderer);
        for (const [cmd, args] of steps) {
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

if (isMain(import.meta.url)) {
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
