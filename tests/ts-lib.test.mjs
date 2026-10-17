import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { REAL_TEMPLATE, assertInstanceNotes, renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const byPath = (result) => Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
const PIECES = ["base", "ts-lib:lib"];

test("piece manifest", async () => {
  const piece = (await loadTemplate(REAL_TEMPLATE)).pieces.get("ts-lib");
  assert.ok(piece);
  assert.equal(piece.multiple, true);
  assert.equal(piece.target, "packages/{{ name }}");
  assert.equal(piece.vars.name.default, "lib");
  assert.deepEqual(piece.requires, ["base"]);
});

test("renders at packages/lib with classes", async () => {
  const { result } = await renderCombo(PIECES);
  const cls = byPath(result);
  assert.equal(cls["packages/lib/package.json"], "shared");
  assert.equal(cls["packages/lib/vite.config.ts"], "owned");
  assert.equal(cls["packages/lib/tsconfig.json"], "owned");
  assert.equal(cls["packages/lib/AGENTS.md"], "owned");
  assert.equal(cls["packages/lib/src/index.ts"], "seed");
  assert.equal(cls["packages/lib/src/index.test.ts"], "seed");
  assert.equal(cls["packages/lib/README.md"], "seed");
  assert.equal(cls["packages/lib/CLAUDE.md"], "seed");
});

test("package.json: name, exports, publish settings, release marker", async () => {
  const { dir } = await renderCombo(["base", "ts-lib:kit"], { scope: "acme" });
  const pkg = JSON.parse(await read(dir, "packages/kit/package.json"));
  assert.equal(pkg.name, "@acme/kit");
  assert.equal(pkg.type, "module");
  assert.deepEqual(Object.keys(pkg.exports["."]), ["types", "default"]);
  assert.equal(pkg.exports["."].types, "./dist/index.d.mts");
  assert.equal(pkg.exports["."].default, "./dist/index.mjs");
  assert.equal(pkg.exports["./package.json"], "./package.json");
  assert.deepEqual(pkg.files, ["dist"]);
  assert.equal(pkg.sideEffects, false);
  assert.deepEqual(pkg.publishConfig, { access: "public", provenance: true });
  assert.equal(pkg.hull.release, "ts-lib");
  assert.equal(pkg.private, undefined);
});

test("scripts cover CI_TASKS; build runs publint and attw; no vp run", async () => {
  const { dir } = await renderCombo(PIECES);
  const pkg = JSON.parse(await read(dir, "packages/lib/package.json"));
  for (const task of CI_TASKS) assert.ok(pkg.scripts[task], task);
  assert.equal(pkg.scripts.build, "vp pack && publint && attw --pack . --profile esm-only");
  assert.equal(pkg.scripts.test, "vp test run");
  for (const [k, v] of Object.entries(pkg.scripts)) assert.ok(!/vp run/.test(v), k);
  for (const k of ["publint", "@arethetypeswrong/cli", "vite-plus", "typescript"])
    assert.equal(pkg.devDependencies[k], "catalog:", k);
});

test("tsconfig enables isolatedDeclarations; vite.config.ts packs ESM with dts", async () => {
  const { dir } = await renderCombo(PIECES);
  const ts = JSON.parse(await read(dir, "packages/lib/tsconfig.json"));
  assert.equal(ts.compilerOptions.isolatedDeclarations, true);
  const vite = await read(dir, "packages/lib/vite.config.ts");
  assert.match(vite, /format: \["esm"\]/);
  assert.match(vite, /dts: true/);
});

test("catalog pins publint and attw", async () => {
  const { dir } = await renderCombo(["base"]);
  const ws = YAML.parse(await read(dir, "pnpm-workspace.yaml"));
  assert.equal(ws.catalog.publint, "0.3.25");
  assert.equal(ws.catalog["@arethetypeswrong/cli"], "0.18.5");
});

test("root AGENTS.md lists ts-lib packages", async () => {
  const { dir } = await renderCombo(PIECES);
  assert.match(
    await read(dir, "AGENTS.md"),
    /- `packages\/\*` \(ts-lib\)[^\n]*`packages\/<name>\/AGENTS\.md`/,
  );
});

test("per-instance notes: AGENTS.md owned within 20 lines, CLAUDE.md seed", async () => {
  const { agents } = await assertInstanceNotes(PIECES, "packages/lib");
  assert.match(agents, /publint/);
});

test("repository is omitted by default and rendered when given", async () => {
  const bare = JSON.parse(await read((await renderCombo(PIECES)).dir, "packages/lib/package.json"));
  assert.equal(bare.repository, undefined);
  const { dir } = await renderCombo(PIECES, { "ts-lib.repository": "https://github.com/acme/lib" });
  const pkg = JSON.parse(await read(dir, "packages/lib/package.json"));
  assert.deepEqual(pkg.repository, { type: "git", url: "git+https://github.com/acme/lib.git" });
});

test("entries live in the seed pack.entries.ts; vite.config.ts imports them", async () => {
  const { dir, result } = await renderCombo(PIECES);
  assert.equal(byPath(result)["packages/lib/pack.entries.ts"], "seed");
  assert.match(await read(dir, "packages/lib/pack.entries.ts"), /\["src\/index\.ts"\]/);
  const vite = await read(dir, "packages/lib/vite.config.ts");
  assert.match(vite, /import \{ entries \} from "\.\/pack\.entries"/);
  assert.match(vite, /entry: entries/);
  const agents = await read(dir, "packages/lib/AGENTS.md");
  assert.match(agents, /`pack\.entries\.ts`/);
  assert.match(agents, /`repository`/);
});

test("repository var pattern: https://github.com/<owner>/<repo> only, no .git, quotes or backslashes", async () => {
  const p = (await loadTemplate(REAL_TEMPLATE)).pieces.get("ts-lib");
  const re = new RegExp(p.vars.repository.pattern);
  for (const ok of ["", "https://github.com/acme/lib", "https://github.com/a.b_c-d/e.f-g_h"])
    assert.equal(re.test(ok), true, ok);
  for (const bad of [
    "https://github.com/acme/lib.git/",
    'https://github.com/acme/li"b',
    "https://github.com/acme/li\\b",
    "https://github.com/acme/lib/extra",
    "http://github.com/acme/lib",
    "https://github.com/acme",
    "https://github.com/acme/lib x",
  ])
    assert.equal(re.test(bad), false, bad);
  await assert.rejects(renderCombo(PIECES, { "ts-lib.repository": 'https://github.com/a/b"c' }));
});
