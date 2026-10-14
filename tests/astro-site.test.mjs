import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { REAL_TEMPLATE, renderCombo } from "./helpers.mjs";

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
  assert.equal(cls["apps/docs-site/CLAUDE.md"], "owned");
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
  assert.ok(pkg.scripts["deploy:preview"]);
  assert.match(pkg.scripts["format:check"], /^vp fmt --check/);
  assert.ok(pkg.scripts["format:check"].includes("'!**/*.astro'"));
  for (const v of Object.values({ ...pkg.dependencies, ...pkg.devDependencies }))
    assert.equal(v, "catalog:");
});

test("astro.config.mjs uses the Preact integration and static output", async () => {
  const { dir } = await renderCombo(["base", "astro-site:site"]);
  const text = await read(dir, "apps/site/astro.config.mjs");
  assert.match(text, /@astrojs\/preact/);
  assert.match(text, /output: "static"/);
});

test("piece CLAUDE.md documents the .astro tooling limits", async () => {
  const { dir } = await renderCombo(["base", "astro-site:site"]);
  const text = await read(dir, "apps/site/CLAUDE.md");
  assert.match(text, /oxlint does not lint `\.astro`/);
  assert.match(text, /oxfmt `\.astro` support is experimental/);
});

test("root CLAUDE.md mentions astro-site and stays ≤ 80 lines", async () => {
  const text = await read((await renderCombo(["base", "astro-site:site"])).dir, "CLAUDE.md");
  assert.match(text, /astro-site/);
  assert.ok(text.split("\n").length <= 80);
  assert.ok(!/astro-site/.test(await read((await renderCombo(["base"])).dir, "CLAUDE.md")));
});
