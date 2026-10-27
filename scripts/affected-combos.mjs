#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { comboTemplate, loadCombos } from "./lib/combos.mjs";

/** @typedef {import("./lib/combos.mjs").Combo} Combo */

const ALL_EXACT = new Set([
  "scripts/render.mjs",
  "scripts/dogfood.mjs",
  "scripts/check-single-vite.mjs",
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
  const live = combos.filter((c) => !c.scheduled);
  const all = live.map((c) => c.name);
  const templates = new Set(live.map(comboTemplate));
  const hit = new Set();
  for (const f of changed) {
    if (
      ALL_EXACT.has(f) ||
      f.startsWith("scripts/lib/") ||
      f.startsWith("scripts/combos/") ||
      f.startsWith(".github/workflows/")
    )
      return all;
    const tpl = f.split("/")[0];
    if (!templates.has(tpl)) continue;
    const ofTemplate = live.filter((c) => comboTemplate(c) === tpl);
    const m = f.slice(tpl.length).match(/^\/pieces\/([^/]+)\//);
    // base, splice.toml, migrations and anything else outside a piece reach every combo of it
    const pick =
      m && m[1] !== "base"
        ? ofTemplate.filter((c) => c.pieces.some((p) => p.split(":")[0] === m[1]))
        : ofTemplate;
    for (const c of pick) hit.add(c.name);
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
  const { combos } = loadCombos();
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
