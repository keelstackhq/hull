import { readdirSync, readFileSync } from "node:fs";

/** @typedef {{ name: string, pieces: string[], template?: string, vars?: Record<string, string>, scheduled?: boolean }} Combo */

/** The template directory of a combo, relative to the hull root (default `template`). */
export const comboTemplate = (combo) => combo.template ?? "template";

/** A combo's own `vars` replace the top-level ones (a template-rust combo has none). */
export const comboVars = (combo, vars = {}) => combo.vars ?? vars;

/** True when the combo renders a pure Rust repo (spec §15). */
export const isRustTemplate = (combo) => comboTemplate(combo) === "template-rust";

const COMBOS_DIR = new URL("../combos/", import.meta.url);

/**
 * Load the combo fragments: `scripts/combos/<name>.json` (one combo each) and `_vars.json` (vars
 * shared by all combos). A fragment's `name` must equal its file name, which keeps names unique.
 * Any other entry in the directory, except dotfiles, is an error.
 * @param {URL} [dir] directory URL ending in `/`
 * @returns {{ vars: Record<string, string>, combos: Combo[] }} combos sorted by name
 */
export function loadCombos(dir = COMBOS_DIR) {
  const vars = JSON.parse(readFileSync(new URL("_vars.json", dir), "utf8"));
  const combos = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = entry.name;
    if (file === "_vars.json" || file.startsWith(".")) continue; // .DS_Store and the like
    if (!entry.isFile() || !file.endsWith(".json"))
      throw new Error(`scripts/combos/${file} is not a combo fragment (<name>.json)`);
    const combo = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    // name = file name, and file names in one directory are unique, so names are unique too.
    if (combo.name !== file.slice(0, -".json".length))
      throw new Error(`combo file ${file} declares name "${combo.name}"`);
    combos.push(combo);
  }
  combos.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { vars, combos };
}
