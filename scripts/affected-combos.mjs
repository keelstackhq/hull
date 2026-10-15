#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** @typedef {{ name: string, pieces: string[], scheduled?: boolean }} Combo */

const ALL_EXACT = new Set([
  "template/splice.toml",
  "scripts/render.mjs",
  "scripts/dogfood.mjs",
  "scripts/check-single-vite.mjs",
  "scripts/combos.json",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/affected-combos.mjs",
  ".node-version",
]);

/**
 * Which combos a diff touches (spec §10.2). `scheduled` combos (heavy, e.g. the Tauri build) are
 * never selected: they run in their own workflow.
 * @param {string[]} changed repo-relative paths
 * @param {Combo[]} combos
 * @returns {string[]} combo names
 */
export function affectedCombos(changed, combos) {
  const all = combos.filter((c) => !c.scheduled).map((c) => c.name);
  const hit = new Set();
  for (const f of changed) {
    if (ALL_EXACT.has(f) || f.startsWith("scripts/lib/") || f.startsWith(".github/workflows/"))
      return all;
    const m = f.match(/^template\/pieces\/([^/]+)\//);
    if (m) {
      if (m[1] === "base") return all;
      for (const c of combos) {
        if (!c.scheduled && c.pieces.some((p) => p.split(":")[0] === m[1])) hit.add(c.name);
      }
    } else if (f.startsWith("template/")) {
      return all;
    }
  }
  return all.filter((n) => hit.has(n));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { base: { type: "string" }, all: { type: "boolean" } },
  });
  if (!values.base && !values.all) {
    process.stderr.write("usage: affected-combos.mjs --base <ref> | --all\n");
    process.exit(2);
  }
  const { combos } = JSON.parse(readFileSync(new URL("./combos.json", import.meta.url), "utf8"));
  const everything = combos.filter((c) => !c.scheduled).map((c) => c.name);
  let list = everything;
  if (!values.all) {
    try {
      const out = execFileSync("git", ["diff", "--name-only", `${values.base}...HEAD`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      list = affectedCombos(out.split("\n").filter(Boolean), combos);
    } catch (e) {
      process.stderr.write(
        `warning: git diff against ${values.base} failed (${String(e.message).split("\n")[0]}); selecting all combos\n`,
      );
    }
  }
  process.stdout.write(`${JSON.stringify(list)}\n`);
}
