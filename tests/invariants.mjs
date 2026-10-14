import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SCAN_RE = /\{#[\s\S]*?#\}|\{%\s*(\w+)[\s\S]*?%\}/g;
const MARKER = "{# same-branches #}";

/**
 * Every chain marked `{# same-branches #}`, as a list of branch bodies each.
 * Throws if a marker is not followed by `{% if`, a chain is unclosed, or it has
 * fewer than two branches. Nested markers are scanned too.
 * @param {string} source
 * @returns {string[][]}
 */
export function chains(source) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(MARKER, from);
    if (at < 0) break;
    from = at + MARKER.length;
    const open = /^\s*\{%\s*if\b[\s\S]*?%\}/.exec(source.slice(from));
    if (!open) throw new Error(`same-branches marker at ${at} is not followed by {% if`);
    const base = from + open[0].length;
    let depth = 1;
    let bodyStart = base;
    const branches = [];
    for (const m of source.slice(base).matchAll(SCAN_RE)) {
      if (m[1] === undefined) continue; // comment
      const abs = base + m.index;
      if (m[1] === "if") depth++;
      else if (m[1] === "endif") depth--;
      if (depth === 0 || (depth === 1 && (m[1] === "elif" || m[1] === "else"))) {
        branches.push(source.slice(bodyStart, abs));
        bodyStart = abs + m[0].length;
        if (depth === 0) break;
      }
    }
    if (depth > 0) throw new Error(`same-branches chain at ${at} is unclosed`);
    if (branches.length < 2) {
      throw new Error(`same-branches chain at ${at} needs at least 2 branches`);
    }
    out.push(branches);
  }
  return out;
}

/**
 * Branch bodies of the first marked chain in `source` (empty if none).
 * @param {string} source
 * @returns {string[]}
 */
export function elifBranches(source) {
  return chains(source)[0] ?? [];
}

/**
 * Every branch of every marked chain, including an `{% else %}` branch, must be
 * byte-identical (spec §4.3.2).
 * @param {string} path
 */
export function assertSameBranches(path) {
  for (const branches of chains(readFileSync(path, "utf8"))) {
    for (const [i, b] of branches.entries()) {
      assert.equal(b, branches[0], `${path}: same-branches branch ${i} differs from branch 0`);
    }
  }
}
