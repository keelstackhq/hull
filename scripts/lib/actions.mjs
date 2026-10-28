// Finds `uses:` references in workflow sources (raw text, jinja included) for the SHA-pin test and
// the docs/actions.md generator.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const ROOT = new URL("../../", import.meta.url).pathname;

// `uses: owner/repo[/path]@ref [# comment]`, also inside quoted JS strings and after `{% raw %}`.
const USES = /(?<![A-Za-z])uses:\s*(\S+?)(?:\s+(#[^"\n]*?))?\s*"?,?\s*$/;

/** @param {string} text @returns {{ line: number, ref: string, comment: string }[]} */
export function findUses(text) {
  const out = [];
  text.split("\n").forEach((l, i) => {
    const m = USES.exec(l);
    if (m) out.push({ line: i + 1, ref: m[1], comment: m[2] ?? "" });
  });
  return out;
}

/** @param {string} dir @returns {Promise<string[]>} absolute file paths under dir (recursive). */
export async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") out.push(...(await walk(p)));
    } else out.push(p);
  }
  return out;
}

const WORKFLOW = /\.github\/workflows\/[^/]+\.ya?ml(\.jinja)?$/;

/** Workflow files (and the ci-tasks generator source) that can contain `uses:`. */
export async function workflowSources() {
  const files = [];
  for (const d of ["template", "template-rust", "rigging", ".github/workflows"])
    for (const f of await walk(join(ROOT, d)))
      if (WORKFLOW.test(f) || (d === ".github/workflows" && /\.ya?ml$/.test(f))) files.push(f);
  files.push(join(ROOT, "scripts/lib/ci-tasks.mjs"));
  return files.sort();
}

/** @returns {Promise<{ file: string, line: number, ref: string, comment: string }[]>} */
export async function allUses() {
  const out = [];
  for (const f of await workflowSources())
    for (const u of findUses(await readFile(f, "utf8")))
      out.push({ file: relative(ROOT, f), ...u });
  return out;
}

export const HOIST_EXEMPT = /^keelstackhq\/hoist\/secrets@0{40}$/;
