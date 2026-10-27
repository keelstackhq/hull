import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { REAL_TEMPLATE, assertInstanceNotes, lineCount, renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const byPath = (result) => Object.fromEntries(result.changes.map((c) => [c.path, c.class]));

test("piece manifest", async () => {
  const piece = (await loadTemplate(REAL_TEMPLATE)).pieces.get("astro-site");
  assert.ok(piece);
  assert.equal(piece.multiple, true);
  assert.equal(piece.target, "apps/{{ name }}");
  assert.equal(piece.vars.name.default, "site");
  assert.deepEqual(piece.requires, ["base"]);
});

test("renders at apps/<name> with classes", async () => {
  const { result } = await renderCombo(["base", "astro-site:docs-site"]);
  const cls = byPath(result);
  assert.equal(cls["apps/docs-site/package.json"], "shared");
  assert.equal(cls["apps/docs-site/wrangler.jsonc"], "shared");
  assert.equal(cls["apps/docs-site/astro.config.mjs"], "owned");
  assert.equal(cls["apps/docs-site/tsconfig.json"], "owned");
  assert.equal(cls["apps/docs-site/AGENTS.md"], "owned");
  assert.equal(cls["apps/docs-site/CLAUDE.md"], "seed");
  assert.equal(cls["apps/docs-site/src/pages/index.astro"], "seed");
  assert.equal(cls["apps/docs-site/src/components/hello.tsx"], "seed");
  assert.equal(cls["apps/docs-site/src/components/hello.test.tsx"], "seed");
});

test("scripts, name and catalog deps", async () => {
  const { dir } = await renderCombo(["base", "astro-site:site"], { scope: "acme" });
  const pkg = JSON.parse(await read(dir, "apps/site/package.json"));
  assert.equal(pkg.name, "@acme/site");
  for (const task of CI_TASKS) assert.ok(pkg.scripts[task], task);
  for (const [k, v] of Object.entries(pkg.scripts)) assert.ok(!/vp run/.test(v), k);
  assert.equal(pkg.scripts.build, "astro build");
  assert.equal(pkg.scripts.typecheck, "tsc --noEmit");
  assert.equal(pkg.scripts.dev, "astro dev");
  assert.equal(pkg.scripts["deploy:preview"], undefined);
  assert.match(pkg.scripts["format:check"], /^vp fmt --check/);
  assert.equal(pkg.scripts["format:check"], "vp fmt --check");
  assert.equal(pkg.scripts.test, "vp test run");
  for (const v of Object.values({ ...pkg.dependencies, ...pkg.devDependencies }))
    assert.equal(v, "catalog:");
});

test("root vite.config.ts keeps package.json key order (scope-dependent sort position)", async () => {
  const { dir } = await renderCombo(["base"]);
  assert.match(await read(dir, "vite.config.ts"), /sortPackageJson: false/);
});

test("root vite.config.ts makes fmt skip .astro files", async () => {
  const { dir } = await renderCombo(["base", "astro-site:site"]);
  assert.match(await read(dir, "vite.config.ts"), /"\*\*\/\*\.astro"/);
});

test("astro.config.mjs uses the Preact integration and static output", async () => {
  const { dir } = await renderCombo(["base", "astro-site:site"]);
  const text = await read(dir, "apps/site/astro.config.mjs");
  assert.match(text, /@astrojs\/preact/);
  assert.match(text, /output: "static"/);
});

test("piece AGENTS.md documents the .astro tooling limits", async () => {
  const { dir } = await renderCombo(["base", "astro-site:site"]);
  const text = await read(dir, "apps/site/AGENTS.md");
  assert.match(text, /oxlint does not lint `\.astro`/);
  assert.match(text, /oxfmt `\.astro` support is experimental/);
});

test("root AGENTS.md mentions astro-site; AGENTS + CLAUDE stay ≤ 80 lines", async () => {
  const { dir } = await renderCombo(["base", "astro-site:site"]);
  const text = await read(dir, "AGENTS.md");
  assert.match(text, /astro-site/);
  assert.match(text, /`apps\/<name>\/AGENTS\.md`/);
  assert.ok(lineCount(text) + lineCount(await read(dir, "CLAUDE.md")) <= 80);
  assert.ok(!/astro-site/.test(await read((await renderCombo(["base"])).dir, "AGENTS.md")));
});

test("per-instance notes: AGENTS.md owned within 20 lines, CLAUDE.md seed", async () => {
  const { agents } = await assertInstanceNotes(["base", "astro-site:site"], "apps/site");
  assert.match(agents, /^# /);
});
