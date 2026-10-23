import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { snapshotTemplate, spliceNewArgs } from "../scripts/lib/splice.mjs";
import { renderNew } from "../scripts/render.mjs";
import { comboTemplate, comboVars } from "../scripts/lib/combos.mjs";

const BIN = process.env.SPLICE_BIN;
const skip = BIN ? false : "SPLICE_BIN is unset (hull CI sets it; see scripts/lib/splice.mjs)";
const TEMPLATE = fileURLToPath(new URL("../template", import.meta.url));
const COMBOS = new URL("../scripts/combos.json", import.meta.url);

/** relative path → sha256 and exec bit, without `.splice/` and `.git/` (splice runs `git init`). */
async function tree(dir) {
  const out = {};
  for (const rel of (await readdir(dir, { recursive: true })).sort()) {
    if (/^\.(splice|git)(\/|$)/.test(rel)) continue;
    const s = await stat(join(dir, rel));
    if (!s.isFile()) continue;
    const hash = createHash("sha256")
      .update(await readFile(join(dir, rel)))
      .digest("hex");
    out[rel] = `${hash} ${s.mode & 0o111 ? "x" : "-"}`;
  }
  return out;
}

const splice = (args) => spawnSync(BIN, args, { encoding: "utf8" });

test("splice and the dev renderer produce identical trees for every combo", { skip }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-parity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { vars, combos } = JSON.parse(await readFile(COMBOS, "utf8"));
  const sources = new Map();
  for (const c of combos) {
    const template = fileURLToPath(new URL(`../${comboTemplate(c)}`, import.meta.url));
    if (!sources.has(template)) sources.set(template, await snapshotTemplate(template, root));
    const s = join(root, "splice", c.name);
    const r = splice(
      spliceNewArgs(sources.get(template), s, c.pieces, comboVars(c, vars), ["--no-post"]),
    );
    assert.equal(r.status, 0, `${c.name}: ${r.stdout}${r.stderr}`);
    const lock = parse(await readFile(join(s, ".splice/lock.toml"), "utf8"));
    const d = join(root, "dev", c.name);
    await renderNew({
      template,
      out: d,
      pieces: c.pieces,
      vars: comboVars(c, vars),
      templateVersion: lock.template.version,
    });
    assert.deepEqual(await tree(s), await tree(d), c.name);
  }
});

test("splice --json matches the contract shape (§8)", { skip }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hull-json-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await snapshotTemplate(TEMPLATE, root);
  const r = splice(
    spliceNewArgs(source, join(root, "out"), ["base"], { scope: "x" }, ["--no-post"]),
  );
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out).sort(), ["changes", "command", "messages", "ok"]);
  assert.equal(out.ok, true);
  assert.equal(out.command, "new");
  assert.ok(out.messages.every((m) => typeof m === "string"));
  assert.ok(out.changes.length > 0);
  for (const c of out.changes) {
    assert.deepEqual(Object.keys(c).sort(), ["action", "class", "path"]);
    assert.ok(["create", "update", "merge", "conflict", "delete", "skip"].includes(c.action));
    assert.ok(["owned", "shared", "seed"].includes(c.class), c.class);
  }
});
