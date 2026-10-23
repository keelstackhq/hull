/** @typedef {{ name: string, pieces: string[], template?: string, vars?: Record<string, string>, scheduled?: boolean }} Combo */

/** The template directory of a combo, relative to the hull root (default `template`). */
export const comboTemplate = (combo) => combo.template ?? "template";

/** A combo's own `vars` replace the top-level ones (a template-rust combo has none). */
export const comboVars = (combo, vars = {}) => combo.vars ?? vars;

/** True when the combo renders a pure Rust repo (spec §15). */
export const isRustTemplate = (combo) => comboTemplate(combo) === "template-rust";
