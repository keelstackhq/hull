#!/usr/bin/env node
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { TemplateError, UsageError } from "./lib/errors.mjs";
import { loadTemplate } from "./lib/manifest.mjs";
import { buildPlan, resolveRequest } from "./lib/plan.mjs";
import { renderString } from "./lib/render-file.mjs";
import { checkSubset } from "./lib/subset.mjs";

/**
 * @typedef {{ path: string, action: "create" | "skip", class: string }} Change
 * @typedef {{ ok: boolean, command: "new", changes: Change[], messages: string[] }} Result
 */

async function assertEmptyOut(out) {
  try {
    const entries = await readdir(out);
    if (entries.length > 0) throw new UsageError(`--out ${out} is not empty`);
  } catch (e) {
    if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
    if (e.code === "ENOTDIR") throw new UsageError(`--out ${out} is not a directory`);
  }
}

/** Warn when instances of different pieces share a name (they collapse to one package name). */
function nameClashes(instances) {
  const byName = new Map();
  for (const { piece, name } of instances) {
    if (!piece.multiple) continue;
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(piece.id);
  }
  return [...byName]
    .filter(([, ids]) => ids.size > 1)
    .map(
      ([name, ids]) =>
        `warning: instance name "${name}" is used by ${[...ids].join(" and ")}; their packages share one name, rename one`,
    );
}

/**
 * @param {{ template: string, out: string, pieces: string[], vars: Record<string,string>, templateVersion?: string }} opts
 * @returns {Promise<Result>}
 */
export async function renderNew(opts) {
  const out = resolve(opts.out);
  await assertEmptyOut(out);
  const t = await loadTemplate(resolve(opts.template));
  const instances = resolveRequest(t, { pieces: opts.pieces, vars: opts.vars ?? {} });
  const plan = await buildPlan(t, instances, {
    templateVersion: opts.templateVersion ?? "0.0.0-dev",
  });

  const sources = new Map();
  for (const entry of plan) {
    const buf = await readFile(entry.src);
    sources.set(entry, buf);
    if (!entry.render) continue;
    const violations = checkSubset(buf.toString("utf8"), entry.src);
    if (violations.length > 0) {
      throw new TemplateError(
        violations.map((v) => `${v.file}:${v.line}: ${v.tag}: ${v.reason}`).join("\n"),
      );
    }
  }

  const writes = [];
  const changes = [];
  for (const entry of plan) {
    let data = sources.get(entry);
    if (entry.render) {
      let text;
      try {
        text = renderString(data.toString("utf8"), entry.context);
      } catch (e) {
        throw new TemplateError(`${entry.src}: ${e.message}`);
      }
      if (/^[ \t\r\n]*$/.test(text)) {
        changes.push({ path: entry.path, action: "skip", class: entry.class });
        continue;
      }
      data = Buffer.from(text, "utf8");
    }
    writes.push({ path: entry.path, data });
    changes.push({ path: entry.path, action: "create", class: entry.class });
  }

  const createdParent = await mkdir(dirname(out), { recursive: true });
  const stage = await mkdtemp(join(dirname(out), ".hull-render-"));
  try {
    for (const w of writes) {
      const dest = join(stage, w.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, w.data);
    }
    await chmod(stage, 0o777 & ~process.umask());
    try {
      await rename(stage, out);
    } catch (e) {
      if (e.code !== "ENOTEMPTY" && e.code !== "EEXIST" && e.code !== "EPERM") throw e;
      await rmdir(out);
      await rename(stage, out);
    }
  } catch (e) {
    await rm(stage, { recursive: true, force: true });
    if (createdParent) await rm(createdParent, { recursive: true, force: true });
    throw e;
  }
  return { ok: true, command: "new", changes, messages: nameClashes(instances) };
}

function parseData(items) {
  const vars = {};
  for (const item of items) {
    const i = item.indexOf("=");
    if (i < 1) throw new UsageError(`--data expects key=value, got "${item}"`);
    vars[item.slice(0, i)] = item.slice(i + 1);
  }
  return vars;
}

/** @param {string[]} argv @returns {Promise<number>} exit code */
export async function main(argv) {
  let json = argv.includes("--json");
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
          template: { type: "string" },
          out: { type: "string" },
          piece: { type: "string", multiple: true },
          data: { type: "string", multiple: true },
          "template-version": { type: "string" },
          json: { type: "boolean" },
        },
      });
    } catch (e) {
      throw new UsageError(e.message);
    }
    const { values, positionals } = parsed;
    json = values.json === true;
    if (positionals[0] !== "new" || positionals.length !== 1) {
      throw new UsageError(
        "usage: render.mjs new --template <dir> --out <dir> [--piece id[:name]]...",
      );
    }
    if (!values.template || !values.out) throw new UsageError("--template and --out are required");
    const result = await renderNew({
      template: values.template,
      out: values.out,
      pieces: values.piece ?? [],
      vars: parseData(values.data ?? []),
      templateVersion: values["template-version"],
    });
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else for (const c of result.changes) process.stdout.write(`${c.action} ${c.path}\n`);
    return 0;
  } catch (e) {
    const code = e.exitCode ?? 3;
    const message = e.exitCode ? e.message : `internal error: ${e.message ?? String(e)}`;
    if (!e.exitCode && e.stack) process.stderr.write(`${e.stack}\n`);
    if (json) {
      const result = { ok: false, command: "new", changes: [], messages: [message] };
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stderr.write(`error: ${message}\n`);
    }
    return code;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
