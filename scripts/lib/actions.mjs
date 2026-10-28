// Finds `uses:` references in workflow sources (raw text, jinja included) for the SHA-pin test and
// the docs/actions.md generator.
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import YAML from "yaml";
import { loadCombos, comboTemplate, comboVars } from "./combos.mjs";
import { renderNew } from "../render.mjs";

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

export const WORKFLOW = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml(\.jinja)?$/;
export const ACTION = /(^|\/)action\.ya?ml(\.jinja)?$/;
const isUsesFile = (f) => WORKFLOW.test(f) || ACTION.test(f);

/**
 * Parse YAML and return every `uses` value (job-level reusable workflows, steps, composite action
 * steps, flow maps alike) with its line and the `# comment` after it on that line.
 * @param {string} text
 * @returns {{ line: number, ref: string, comment: string }[]}
 */
export function scanYaml(text) {
  const lc = new YAML.LineCounter();
  const doc = YAML.parseDocument(text, { lineCounter: lc });
  if (doc.errors.length) throw new Error(`invalid YAML: ${doc.errors[0].message}`);
  const out = [];
  YAML.visit(doc, {
    Pair(_, pair, path) {
      if (!YAML.isScalar(pair.key) || pair.key.value !== "uses") return;
      if (path.some((p) => YAML.isPair(p) && ["with", "env", "run"].includes(p.key?.value))) return;
      const v = pair.value;
      if (!YAML.isScalar(v)) return void out.push({ line: 0, ref: "", comment: "" });
      const end = v.range[1];
      const eol = text.indexOf("\n", end);
      const rest = text.slice(end, eol < 0 ? undefined : eol);
      out.push({
        line: lc.linePos(v.range[0]).line,
        ref: String(v.value),
        comment: /^\s+(#.*?)\s*$/.exec(rest)?.[1] ?? "",
      });
    },
  });
  return out;
}

/** Workflow and action files in the source trees (plain and `.jinja`). */
export async function sourceFiles() {
  const files = [];
  for (const d of ["template", "template-rust", "rigging", ".github"])
    for (const f of await walk(join(ROOT, d))) if (isUsesFile(f)) files.push(f);
  return files.sort();
}

/** Render every combo; returns [{ label, dir, files }] with the rendered workflow/action files. */
export async function renderedFiles() {
  const { vars, combos } = loadCombos();
  const out = [];
  for (const c of combos) {
    const dir = join(await mkdtemp(join(tmpdir(), "hull-pins-")), "out");
    await renderNew({
      template: join(ROOT, comboTemplate(c)),
      out: dir,
      pieces: c.pieces,
      vars: comboVars(c, vars),
    });
    const files = (await walk(dir)).filter(isUsesFile);
    out.push({ label: c.name, dir, files });
  }
  return out;
}

/** @returns {Promise<{ file: string, line: number, ref: string, comment: string }[]>} */
export async function allUses() {
  const out = [];
  for (const f of await sourceFiles()) {
    if (f.endsWith(".jinja")) continue; // covered by the rendered combos below
    for (const u of scanYaml(await readFile(f, "utf8")))
      out.push({ file: relative(ROOT, f), ...u });
  }
  // generated ci.yml.jinja pins come from this file's YAML strings
  const tasks = join(ROOT, "scripts/lib/ci-tasks.mjs");
  for (const u of findUses(await readFile(tasks, "utf8")))
    out.push({ file: relative(ROOT, tasks), ...u });
  for (const r of await renderedFiles())
    for (const f of r.files)
      for (const u of scanYaml(await readFile(f, "utf8")))
        out.push({ file: `rendered:${r.label}/${relative(r.dir, f)}`, ...u });
  return out;
}

export const HOIST_EXEMPT = /^keelstackhq\/hoist\/secrets@0{40}$/;
