import { mkdtemp } from "node:fs/promises";
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
