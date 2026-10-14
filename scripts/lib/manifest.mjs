import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { TemplateError } from "./errors.mjs";

const MERGE = ["json", "yaml", "toml", "text"];
const WHEN = ["new", "add", "update"];
const SPLICE_KEYS = ["format", "name", "min_splice", "base", "vars"];
const PIECE_KEYS = [
  "id",
  "description",
  "multiple",
  "requires",
  "target",
  "vars",
  "files",
  "merge",
  "post",
];
const VAR_KEYS = ["prompt", "default", "pattern"];
const FILES_KEYS = ["owned", "shared", "seed"];
const POST_KEYS = ["run", "when"];

function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new TemplateError(`${where}: unknown key "${k}"`);
  }
}

function stringArray(v, where) {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new TemplateError(`${where}: expected an array of strings`);
  }
  return v;
}

const RESERVED_VARS = new Set([
  "pieces",
  "piece",
  "template",
  "true",
  "false",
  "none",
  "not",
  "and",
  "or",
  "in",
  "is",
]);

function loadVars(raw, where) {
  if (raw === undefined) return {};
  if (!isObject(raw)) throw new TemplateError(`${where}: [vars] must be a table`);
  const vars = {};
  for (const [name, spec] of Object.entries(raw)) {
    const w = `${where}: var "${name}"`;
    if (RESERVED_VARS.has(name.toLowerCase())) throw new TemplateError(`${w} is a reserved name`);
    if (!isObject(spec)) throw new TemplateError(`${w} must be a table`);
    checkKeys(spec, VAR_KEYS, w);
    if (typeof spec.prompt !== "string") throw new TemplateError(`${w} needs a string "prompt"`);
    if (spec.default !== undefined && typeof spec.default !== "string") {
      throw new TemplateError(`${w} "default" must be a string`);
    }
    if (spec.pattern !== undefined) {
      if (typeof spec.pattern !== "string")
        throw new TemplateError(`${w} "pattern" must be a string`);
      let re;
      try {
        re = new RegExp(spec.pattern);
      } catch (e) {
        throw new TemplateError(
          `${w} has an invalid pattern ${JSON.stringify(spec.pattern)}: ${e.message}`,
        );
      }
      if (spec.default !== undefined && !re.test(spec.default)) {
        throw new TemplateError(`${w} default does not match its pattern`);
      }
    }
    vars[name] = { ...spec };
  }
  return vars;
}

async function readToml(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    throw new TemplateError(`cannot read ${path}: ${e.code ?? e.message}`);
  }
  try {
    return parse(text);
  } catch (e) {
    throw new TemplateError(`invalid TOML in ${path}: ${e.message}`);
  }
}

async function loadPiece(dir, dirName) {
  const where = `piece ${dirName}`;
  const raw = await readToml(join(dir, "piece.toml"));
  checkKeys(raw, PIECE_KEYS, where);
  if (raw.id !== dirName) {
    throw new TemplateError(`${where}: id "${raw.id}" does not match its directory "${dirName}"`);
  }
  if (typeof raw.description !== "string")
    throw new TemplateError(`${where}: needs a string "description"`);
  if (raw.multiple !== undefined && typeof raw.multiple !== "boolean") {
    throw new TemplateError(`${where}: "multiple" must be a boolean`);
  }
  if (raw.target !== undefined && typeof raw.target !== "string") {
    throw new TemplateError(`${where}: "target" must be a string`);
  }
  const files = { owned: [], shared: [], seed: [] };
  if (raw.files !== undefined) {
    if (!isObject(raw.files)) throw new TemplateError(`${where}: [files] must be a table`);
    checkKeys(raw.files, FILES_KEYS, `${where} [files]`);
    for (const k of FILES_KEYS) {
      if (raw.files[k] !== undefined) files[k] = stringArray(raw.files[k], `${where} files.${k}`);
    }
  }
  const merge = {};
  if (raw.merge !== undefined) {
    if (!isObject(raw.merge)) throw new TemplateError(`${where}: [merge] must be a table`);
    for (const [glob, strategy] of Object.entries(raw.merge)) {
      if (!MERGE.includes(strategy)) {
        throw new TemplateError(
          `${where}: merge strategy "${strategy}" for "${glob}" is not one of ${MERGE.join("|")}`,
        );
      }
      merge[glob] = strategy;
    }
  }
  const post = [];
  if (raw.post !== undefined) {
    if (!Array.isArray(raw.post))
      throw new TemplateError(`${where}: [[post]] must be an array of tables`);
    for (const p of raw.post) {
      if (!isObject(p)) throw new TemplateError(`${where}: [[post]] entries must be tables`);
      checkKeys(p, POST_KEYS, `${where} [[post]]`);
      if (typeof p.run !== "string")
        throw new TemplateError(`${where}: [[post]] needs a string "run"`);
      const when = p.when === undefined ? [...WHEN] : stringArray(p.when, `${where} post.when`);
      for (const w of when) {
        if (!WHEN.includes(w))
          throw new TemplateError(`${where}: post when "${w}" is not one of ${WHEN.join("|")}`);
      }
      post.push({ run: p.run, when });
    }
  }
  return {
    id: raw.id,
    dir,
    filesDir: join(dir, "files"),
    description: raw.description,
    multiple: raw.multiple ?? false,
    requires: raw.requires === undefined ? [] : stringArray(raw.requires, `${where} requires`),
    ...(raw.target === undefined ? {} : { target: raw.target }),
    vars: loadVars(raw.vars, where),
    files,
    merge,
    post,
  };
}

export async function loadTemplate(dir) {
  const raw = await readToml(join(dir, "splice.toml"));
  checkKeys(raw, SPLICE_KEYS, "splice.toml");
  if (raw.format !== 1) {
    throw new TemplateError(
      `splice.toml: unsupported format ${raw.format}; hull's renderer supports format 1`,
    );
  }
  for (const k of ["name", "min_splice", "base"]) {
    if (typeof raw[k] !== "string") throw new TemplateError(`splice.toml: needs a string "${k}"`);
  }
  const vars = loadVars(raw.vars, "splice.toml");

  const pieces = new Map();
  const piecesDir = join(dir, "pieces");
  let entries;
  try {
    entries = await readdir(piecesDir, { withFileTypes: true });
  } catch {
    throw new TemplateError(`template has no pieces/ directory at ${piecesDir}`);
  }
  for (const e of entries
    .filter((x) => x.isDirectory())
    .sort((a, b) => (a.name < b.name ? -1 : 1))) {
    pieces.set(e.name, await loadPiece(join(piecesDir, e.name), e.name));
  }
  if (!pieces.has(raw.base))
    throw new TemplateError(`splice.toml: base "${raw.base}" is not a piece`);
  for (const p of pieces.values()) {
    for (const r of p.requires) {
      if (!pieces.has(r))
        throw new TemplateError(`piece ${p.id}: requires "${r}" which is not a piece`);
    }
  }
  return {
    dir,
    name: raw.name,
    format: raw.format,
    minSplice: raw.min_splice,
    base: raw.base,
    vars,
    pieces,
  };
}
