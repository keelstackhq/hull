import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { TemplateError, UsageError } from "./errors.mjs";
import { classify, outputPath } from "./ownership.mjs";
import { renderString } from "./render-file.mjs";
import { checkSubset } from "./subset.mjs";

function renderChecked(source, context, where) {
  const violations = checkSubset(source, where);
  if (violations.length > 0) {
    throw new TemplateError(
      violations.map((v) => `${v.file}:${v.line}: ${v.tag}: ${v.reason}`).join("\n"),
    );
  }
  try {
    return renderString(source, context);
  } catch (e) {
    throw new TemplateError(`${where}: ${e.message}`);
  }
}

function checkPattern(spec, name, value) {
  if (spec?.pattern !== undefined && !new RegExp(spec.pattern).test(value)) {
    throw new UsageError(`var "${name}" = ${JSON.stringify(value)} does not match ${spec.pattern}`);
  }
}

export function resolveRequest(t, req) {
  const parsed = req.pieces.map((item) => {
    const i = item.indexOf(":");
    return i === -1 ? { id: item } : { id: item.slice(0, i), explicit: item.slice(i + 1) };
  });
  const requested = [
    ...(parsed.some((p) => p.id === t.base) ? [] : [{ id: t.base }]),
    ...parsed.filter((p) => p.id === t.base),
    ...parsed.filter((p) => p.id !== t.base),
  ];
  const seen = new Map(); // id -> instances
  const order = [];
  for (const { id, explicit } of requested) {
    const piece = t.pieces.get(id);
    if (!piece) throw new UsageError(`unknown piece "${id}"`);
    if (explicit !== undefined && !piece.multiple) {
      throw new UsageError(`piece "${id}" is not multiple and cannot be named`);
    }
    if (!seen.has(id)) seen.set(id, []);
    const list = seen.get(id);
    if (list.length > 0 && !piece.multiple) {
      throw new UsageError(`piece "${id}" can only be added once`);
    }
    const name = piece.multiple
      ? (explicit ?? req.vars[`${id}.name`] ?? piece.vars.name?.default ?? id)
      : id;
    if (name === "" || /[/\\]|\.\./.test(name)) {
      throw new UsageError(`invalid instance name ${JSON.stringify(name)} for piece "${id}"`);
    }
    if (list.some((x) => x.name === name)) {
      throw new UsageError(`piece "${id}" already has an instance named "${name}"`);
    }
    const inst = { piece, name };
    list.push(inst);
    order.push(inst);
  }

  const known = new Set(Object.keys(t.vars));
  for (const piece of t.pieces.values()) {
    for (const k of Object.keys(piece.vars)) known.add(`${piece.id}.${k}`);
  }
  for (const k of Object.keys(req.vars)) {
    if (!known.has(k)) throw new UsageError(`unknown var "${k}"`);
    if (k.includes(".") && !seen.has(k.slice(0, k.indexOf(".")))) {
      throw new UsageError(`var "${k}" targets a piece that is not selected`);
    }
  }

  const base = {};
  for (const [k, spec] of Object.entries(t.vars)) {
    const v = req.vars[k] ?? spec.default;
    if (v === undefined) throw new UsageError(`var "${k}" is required`);
    checkPattern(spec, k, v);
    base[k] = v;
  }

  for (const inst of order) {
    const vars = { ...base };
    if (inst.piece.multiple) vars.name = inst.name;
    for (const [k, spec] of Object.entries(inst.piece.vars)) {
      let v = k === "name" ? inst.name : (req.vars[`${inst.piece.id}.${k}`] ?? spec.default);
      if (v === undefined) throw new UsageError(`var "${inst.piece.id}.${k}" is required`);
      checkPattern(spec, `${inst.piece.id}.${k}`, v);
      vars[k] = v;
    }
    inst.vars = vars;
  }

  for (const inst of order) {
    for (const r of inst.piece.requires) {
      if (!seen.has(r)) {
        throw new UsageError(`piece "${inst.piece.id}" requires "${r}", which is not selected`);
      }
    }
  }
  return order;
}

async function walk(dir, prefix = "") {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const out = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

export async function buildPlan(t, instances, opts) {
  const pieces = [...new Set(instances.map((i) => i.piece.id))];
  const plan = [];
  const owners = new Map();
  for (const inst of instances) {
    const context = {
      ...inst.vars,
      pieces,
      piece: { id: inst.piece.id, name: inst.name },
      template: { name: t.name, version: opts.templateVersion },
    };
    const target =
      inst.piece.target === undefined
        ? ""
        : renderChecked(inst.piece.target, context, `piece ${inst.piece.id}: piece.toml target`);
    const rels = (await walk(inst.piece.filesDir)).sort();
    for (const rel of rels) {
      const rendered = renderChecked(
        outputPath(rel),
        context,
        `piece ${inst.piece.id}: path ${rel}`,
      );
      const path = target ? posix.join(target, rendered) : rendered;
      const label = `${inst.piece.id}:${inst.name}`;
      if (owners.has(path)) {
        throw new TemplateError(`${path} is written by both ${owners.get(path)} and ${label}`);
      }
      owners.set(path, label);
      plan.push({
        src: join(inst.piece.filesDir, rel),
        path,
        class: classify(rendered, inst.piece.files),
        render: rel.endsWith(".jinja"),
        context,
      });
    }
  }
  const all = new Set(plan.map((e) => e.path));
  for (const e of plan) {
    for (let i = e.path.indexOf("/"); i !== -1; i = e.path.indexOf("/", i + 1)) {
      const parent = e.path.slice(0, i);
      if (all.has(parent)) {
        throw new TemplateError(`${parent} is a file but ${e.path} needs it to be a directory`);
      }
    }
  }
  return plan;
}
