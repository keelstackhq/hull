import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TemplateError, UsageError } from "../scripts/lib/errors.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { buildPlan, resolveRequest } from "../scripts/lib/plan.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/template", import.meta.url));
const t = await loadTemplate(FIXTURE);
const req = (pieces, vars = {}) => resolveRequest(t, { pieces, vars });

test("base first, deduped, defaults applied", () => {
  const i = req(["app", "base"]);
  assert.deepEqual(
    i.map((x) => [x.piece.id, x.name]),
    [
      ["base", "base"],
      ["app", "web"],
    ],
  );
  assert.equal(i[1].vars.scope, "acme");
  assert.equal(i[1].vars.name, "web");
});
test("base is added when not requested", () =>
  assert.deepEqual(
    req(["app"]).map((x) => x.piece.id),
    ["base", "app"],
  ));
test("id:name sets the name var", () => {
  const i = req(["app:admin"]);
  assert.equal(i[1].name, "admin");
  assert.equal(i[1].vars.name, "admin");
});
test("two instances of a multiple piece", () =>
  assert.deepEqual(
    req(["app:a", "app:b"]).map((x) => x.name),
    ["base", "a", "b"],
  ));
test("template var overrides default", () =>
  assert.equal(req(["app"], { scope: "x" })[1].vars.scope, "x"));
test("piece var via <id>.<key>", () =>
  assert.equal(req(["app"], { "app.name": "site" })[1].name, "site"));
test("unknown piece → UsageError", () =>
  assert.throws(
    () => req(["ghost"]),
    (e) => e instanceof UsageError && /ghost/.test(e.message),
  ));
test("non-multiple twice → UsageError", () =>
  assert.throws(() => req(["base", "base"]), UsageError));
test("name on a non-multiple piece → UsageError", () =>
  assert.throws(() => req(["base:x"]), UsageError));
test("duplicate instance name → UsageError", () =>
  assert.throws(() => req(["app:a", "app:a"]), UsageError));
test("var failing pattern → UsageError /scope/", () =>
  assert.throws(
    () => req(["app"], { scope: "Bad Scope" }),
    (e) => e instanceof UsageError && /scope/.test(e.message),
  ));
test("instance name failing pattern → UsageError", () =>
  assert.throws(() => req(["app:Bad"]), UsageError));
test("unknown var → UsageError", () =>
  assert.throws(
    () => req(["app"], { nope: "1" }),
    (e) => e instanceof UsageError && /nope/.test(e.message),
  ));
test("missing requires → UsageError", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hull-plan-"));
  await cp(FIXTURE, dir, { recursive: true });
  const p = join(dir, "pieces/app/piece.toml");
  await writeFile(p, (await readFile(p, "utf8")).replace('["base"]', '["base", "other"]'));
  await cp(join(dir, "pieces/base"), join(dir, "pieces/other"), { recursive: true });
  const o = join(dir, "pieces/other/piece.toml");
  await writeFile(o, (await readFile(o, "utf8")).replace('id = "base"', 'id = "other"'));
  const t2 = await loadTemplate(dir);
  assert.throws(
    () => resolveRequest(t2, { pieces: ["app"], vars: {} }),
    (e) => e instanceof UsageError && /other/.test(e.message),
  );
});
test("plan applies target and context", async () => {
  const p = await buildPlan(t, req(["app:admin"], { scope: "x" }), {
    templateVersion: "0.0.0-dev",
  });
  const f = p.find((f) => f.path === "apps/admin/src/main.ts");
  assert.equal(f.class, "seed");
  assert.equal(f.render, false);
  assert.deepEqual(f.context.pieces, ["base", "app"]);
  assert.deepEqual(f.context.piece, { id: "app", name: "admin" });
  assert.deepEqual(f.context.template, { name: "fixture", version: "0.0.0-dev" });
  assert.equal(f.context.scope, "x");
  const pkg = p.find((f) => f.path === "package.json");
  assert.equal(pkg.class, "shared");
  assert.equal(pkg.render, true);
  assert.ok(pkg.src.endsWith("package.json.jinja"));
  assert.equal(p.find((f) => f.path === "apps/admin/config.json").class, "owned");
});
test("pieces list is unique ids even with several instances", async () => {
  const p = await buildPlan(t, req(["app:a", "app:b"]), { templateVersion: "0.0.0-dev" });
  assert.deepEqual(p[0].context.pieces, ["base", "app"]);
});
test("two instances writing the same path → TemplateError", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hull-plan-"));
  await cp(FIXTURE, dir, { recursive: true });
  const pt = join(dir, "pieces/app/piece.toml");
  await writeFile(pt, (await readFile(pt, "utf8")).replace(/^target = .*\n/m, ""));
  const t2 = await loadTemplate(dir);
  await assert.rejects(
    buildPlan(t2, resolveRequest(t2, { pieces: ["app:a", "app:b"], vars: {} }), {
      templateVersion: "0.0.0-dev",
    }),
    (e) => e instanceof TemplateError && /config\.json.*app:a.*app:b/.test(e.message),
  );
});
test("name var is set even when the piece declares none", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hull-plan-"));
  await cp(FIXTURE, dir, { recursive: true });
  const pt = join(dir, "pieces/app/piece.toml");
  await writeFile(pt, (await readFile(pt, "utf8")).replace(/^\[vars\]\nname = .*\n/m, ""));
  const t2 = await loadTemplate(dir);
  const i = resolveRequest(t2, { pieces: ["app:x"], vars: {} });
  assert.equal(i[1].vars.name, "x");
});
const noPattern = await mkdtemp(join(tmpdir(), "hull-plan-"));
await cp(FIXTURE, noPattern, { recursive: true });
{
  const pt = join(noPattern, "pieces/app/piece.toml");
  await writeFile(pt, (await readFile(pt, "utf8")).replace(/^\[vars\]\nname = .*\n/m, ""));
}
const tNoPattern = await loadTemplate(noPattern);
for (const bad of ["", "a/b", "a\\b", "..", "a..b"]) {
  test(`unsafe instance name ${JSON.stringify(bad)} → UsageError`, () =>
    assert.throws(
      () => resolveRequest(tNoPattern, { pieces: [`app:${bad}`], vars: {} }),
      UsageError,
    ));
}
test("unreadable files dir (not ENOENT) is rethrown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hull-plan-"));
  await cp(FIXTURE, dir, { recursive: true });
  await rm(join(dir, "pieces/app/files"), { recursive: true });
  await writeFile(join(dir, "pieces/app/files"), "x");
  const t2 = await loadTemplate(dir);
  await assert.rejects(
    buildPlan(t2, resolveRequest(t2, { pieces: ["app"], vars: {} }), { templateVersion: "0" }),
    (e) => e.code === "ENOTDIR",
  );
});
