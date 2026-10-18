import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderNew } from "../scripts/render.mjs";

export const REAL_TEMPLATE = fileURLToPath(new URL("../template", import.meta.url));

/**
 * Render the real template into a fresh temp dir.
 * @param {string[]} pieces
 * @param {Record<string, string>} [vars]
 */
export async function renderCombo(pieces, vars = {}) {
  const dir = join(await mkdtemp(join(tmpdir(), "hull-combo-")), "out");
  const result = await renderNew({ template: REAL_TEMPLATE, out: dir, pieces, vars });
  return { dir, result };
}

/** Line count like `wc -l`: a file ending in a newline counts its lines. */
export const lineCount = (text) => text.split("\n").length - 1;

/**
 * Render pieces and assert the per-instance notes convention: `<target>/AGENTS.md` is owned and at
 * most 20 lines; `<target>/CLAUDE.md` is the seed `@AGENTS.md`.
 * @param {string[]} pieces
 * @param {string} target
 * @param {Record<string, string>} [vars]
 */
export async function assertInstanceNotes(pieces, target, vars = {}) {
  const { dir, result } = await renderCombo(pieces, vars);
  const cls = Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
  const agents = await readFile(join(dir, target, "AGENTS.md"), "utf8");
  assert.ok(lineCount(agents) <= 20, `${target}/AGENTS.md has ${lineCount(agents)} lines`);
  assert.equal(cls[`${target}/AGENTS.md`], "owned");
  assert.equal(await readFile(join(dir, target, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.equal(cls[`${target}/CLAUDE.md`], "seed");
  return { dir, agents };
}
