#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CI_TASKS } from "./lib/ci-tasks.mjs";
import { renderNew } from "./render.mjs";

const TEMPLATE = fileURLToPath(new URL("../template", import.meta.url));
const COMBOS = new URL("./combos.json", import.meta.url);

/** The CI command every rendered combo runs (parity with generated CI). */
export const ciCommand = () => ["pnpm", "turbo", "run", ...CI_TASKS];

/** Steps run in each rendered combo. Hook: plan 02 adds `check-single-vite` for Vite combos. */
export function comboSteps(cacheDir) {
  const [cmd, ...args] = ciCommand();
  return [
    ["git", ["init", "-q"]],
    ["pnpm", ["install", "--no-frozen-lockfile", "--prefer-offline"]],
    [cmd, [...args, `--cache-dir=${cacheDir}`]],
  ];
}

function run(prefix, cmd, args, cwd) {
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
 * @param {{ combos: string[], root?: string, cacheDir?: string, template?: string }} opts
 * @returns {Promise<{ name: string, ok: boolean, seconds: number }[]>}
 */
export async function dogfood(opts) {
  const { vars, combos } = JSON.parse(await readFile(COMBOS, "utf8"));
  const root = resolve(opts.root ?? join(tmpdir(), "hull-dogfood"));
  const cacheDir = resolve(opts.cacheDir ?? join(root, ".turbo-cache"));
  const results = [];
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
        await renderNew({
          template: opts.template ?? TEMPLATE,
          out: dir,
          pieces: combo.pieces,
          vars,
        });
        ok = true;
      } catch (e) {
        process.stderr.write(`[${name}] ${e.message ?? String(e)}\n`);
      }
      if (ok) {
        for (const [cmd, args] of comboSteps(cacheDir)) {
          if ((await run(name, cmd, args, dir)) !== 0) {
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
    },
  });
  if (!values.combo?.length) {
    process.stderr.write(
      "usage: dogfood.mjs --combo <name>... [--root <dir>] [--cache-dir <dir>]\n",
    );
    process.exit(2);
  }
  const results = await dogfood({
    combos: values.combo,
    root: values.root,
    cacheDir: values["cache-dir"],
  });
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
