import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { TemplateError, UsageError } from "./errors.mjs";
import { classify, outputPath } from "./ownership.mjs";
import { pathProblem, segmentProblem } from "./segment.mjs";
import { renderString } from "./render-file.mjs";
import { checkSubset, usesRaw } from "./subset.mjs";

function renderChecked(source, context, where, opts = {}) {
  const violations = checkSubset(source, where, opts);
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

const missing = (k) => `missing value for var \`${k}\`; pass --data ${k}=…`;

/** `implicitBase`: listing the base piece is a usage error, as in splice 0.2.0 `new`. */
export function resolveRequest(t, req, { implicitBase = false } = {}) {
  const parsed = req.pieces.map((item) => {
    const i = item.indexOf(":");
    return i === -1 ? { id: item } : { id: item.slice(0, i), explicit: item.slice(i + 1) };
  });
  const listedBase = implicitBase && parsed.find((p) => p.id === t.base);
  if (listedBase) {
    throw new UsageError(
      listedBase.explicit === undefined
        ? `piece \`${t.base}\` is not \`multiple\` and is listed twice`
        : `piece \`${t.base}\` is not \`multiple\`; it cannot be named (\`--piece ${t.base}:${listedBase.explicit}\`)`,
    );
  }
  const requested = [
    {
      id: t.base,
      explicit: parsed.find((p) => p.id === t.base && p.explicit !== undefined)?.explicit,
    },
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
    const userName = explicit ?? (piece.multiple && piece.vars.name ? req.vars.name : undefined);
    const name = piece.multiple ? (userName ?? piece.vars.name?.default ?? id) : id;
    if (segmentProblem(name)) {
      const msg = `invalid instance name ${JSON.stringify(name)} for piece "${id}"`;
      throw new (userName === undefined && piece.multiple ? TemplateError : UsageError)(msg);
    }
    if (list.some((x) => x.name === name)) {
      throw new UsageError(`piece \`${id}\` has two instances named \`${name}\``);
    }
    const inst = { piece, name };
    list.push(inst);
    order.push(inst);
  }

  // Contract rule 9.28: keys are bare var names. `new` accepts the template vars and the vars of
  // the selected pieces; a piece var applies to every selected piece that declares it.
  const known = new Set(Object.keys(t.vars));
  for (const id of seen.keys()) for (const k of Object.keys(t.pieces.get(id).vars)) known.add(k);
  for (const k of Object.keys(req.vars)) {
    if (k.includes(".")) {
      throw new UsageError(`var "${k}": --data keys are bare var names, not <piece>.<var>`);
    }
    if (!known.has(k)) throw new UsageError(`unknown var "${k}"`);
  }

  const base = {};
  for (const [k, spec] of Object.entries(t.vars)) {
    const v = req.vars[k] ?? spec.default;
    if (v === undefined) throw new UsageError(missing(k));
    checkPattern(spec, k, v);
    base[k] = v;
  }

  for (const inst of order) {
    const vars = { ...base };
    if (inst.piece.multiple) vars.name = inst.name;
    for (const [k, spec] of Object.entries(inst.piece.vars)) {
      let v = k === "name" ? inst.name : (req.vars[k] ?? spec.default);
      if (v === undefined) throw new UsageError(missing(k));
      checkPattern(spec, k, v);
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
    if (e.isSymbolicLink()) {
      throw new TemplateError(
        `${join(dir, e.name)} is a symlink; symlinks are not allowed in a template`,
      );
    }
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

const RAW_MIN_SPLICE = [0, 2, 0];

/** True when semver `v` is >= `min` (major.minor.patch); a prerelease sorts below its release. */
function atLeast(v, min) {
  const m = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+.*)?$/.exec(v);
  if (!m) return false;
  for (let i = 0; i < 3; i++) if (Number(m[i + 1]) !== min[i]) return Number(m[i + 1]) > min[i];
  return m[4] === undefined;
}

/**
 * Contract §9.23: a template with a raw block in any `.jinja` file sets min_splice >= 0.2.0.
 * Scans every piece, selected or not.
 */
export async function checkMinSplice(t) {
  if (atLeast(t.minSplice, RAW_MIN_SPLICE)) return;
  for (const piece of t.pieces.values()) {
    for (const rel of await walk(piece.filesDir)) {
      if (!rel.endsWith(".jinja")) continue;
      const src = join(piece.filesDir, rel);
      if (usesRaw(await readFile(src, "utf8"))) {
        throw new TemplateError(
          `${src}: uses {% raw %}, which needs min_splice = "0.2.0" or later (splice.toml has "${t.minSplice}")`,
        );
      }
    }
  }
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
        ? null
        : renderChecked(inst.piece.target, context, `piece ${inst.piece.id}: piece.toml target`, {
            path: true,
          });
    const targetProblem = target === null ? null : pathProblem(target);
    if (targetProblem) {
      throw new TemplateError(
        `piece ${inst.piece.id}: target ${JSON.stringify(target)}: ${targetProblem}`,
      );
    }
    const rels = (await walk(inst.piece.filesDir)).sort();
    for (const rel of rels) {
      const rendered = renderChecked(
        outputPath(rel),
        context,
        `piece ${inst.piece.id}: path ${rel}`,
        { path: true },
      );
      const path = target ? `${target}/${rendered}` : rendered;
      const problem = pathProblem(path);
      if (problem) {
        throw new TemplateError(
          `piece ${inst.piece.id}: output path ${JSON.stringify(path)}: ${problem}`,
        );
      }
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
  // Case-insensitive collisions, including directory prefixes (file "A" vs "a/x").
  const folded = new Map(); // lowercase path -> { path, dir }
  const note = (path, dir) => {
    const key = path.toLowerCase();
    const prev = folded.get(key);
    if (prev && prev.path !== path) {
      throw new TemplateError(
        `case-insensitive path collision: ${JSON.stringify(prev.path)} and ${JSON.stringify(path)}`,
      );
    }
    if (prev && prev.dir !== dir) {
      throw new TemplateError(`${path} is both a file and a directory`);
    }
    folded.set(key, { path, dir });
  };
  for (const e of plan) {
    for (let i = e.path.indexOf("/"); i !== -1; i = e.path.indexOf("/", i + 1)) {
      note(e.path.slice(0, i), true);
    }
  }
  for (const e of plan) note(e.path, false);
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
