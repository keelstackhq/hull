import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { REAL_TEMPLATE, lineCount, renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const byPath = (result) => Object.fromEntries(result.changes.map((c) => [c.path, c.class]));

test("piece manifest", async () => {
  const piece = (await loadTemplate(REAL_TEMPLATE)).pieces.get("ui-storybook");
  assert.ok(piece);
  assert.equal(piece.multiple, false);
  assert.equal(piece.target, "packages/ui");
  assert.deepEqual(piece.requires, ["base"]);
});

test("renders at packages/ui with classes", async () => {
  const { result } = await renderCombo(["base", "ui-storybook"]);
  const cls = byPath(result);
  assert.equal(cls["packages/ui/package.json"], "shared");
  assert.equal(cls["packages/ui/.storybook/main.ts"], "owned");
  assert.equal(cls["packages/ui/.storybook/preview.ts"], "seed");
  assert.equal(cls["packages/ui/src/button.stories.tsx"], "seed");
  assert.equal(cls["packages/ui/src/button.tsx"], "seed");
  assert.equal(cls["packages/ui/vite.config.ts"], "owned");
  assert.equal(cls["packages/ui/src/button.test.tsx"], "seed");
  assert.equal(cls["packages/ui/src/index.ts"], "seed");
  assert.equal(cls["packages/ui/tsconfig.json"], "owned");
  assert.equal(cls["packages/ui/CLAUDE.md"], "owned");
});

test("main.ts names the Preact framework", async () => {
  const { dir } = await renderCombo(["base", "ui-storybook"]);
  assert.match(await read(dir, "packages/ui/.storybook/main.ts"), /@storybook\/preact-vite/);
});

test("package name, scripts and catalog deps", async () => {
  const { dir } = await renderCombo(["base", "ui-storybook"], { scope: "acme" });
  const pkg = JSON.parse(await read(dir, "packages/ui/package.json"));
  assert.equal(pkg.name, "@acme/ui");
  for (const task of CI_TASKS) assert.ok(pkg.scripts[task], task);
  for (const [k, v] of Object.entries(pkg.scripts)) assert.ok(!/vp run/.test(v), k);
  assert.equal(pkg.scripts.build, "vp pack");
  assert.equal(pkg.scripts.test, "vp test run");
  assert.equal(pkg.scripts["storybook:build"], "storybook build");
  assert.equal(pkg.scripts.storybook, "storybook dev -p 6006");
  for (const v of Object.values({ ...pkg.dependencies, ...pkg.devDependencies }))
    assert.equal(v, "catalog:");
});

test("exports, files and peer dependencies", async () => {
  const { dir } = await renderCombo(["base", "ui-storybook"]);
  const pkg = JSON.parse(await read(dir, "packages/ui/package.json"));
  assert.equal(pkg.exports["."].default, "./dist/index.mjs");
  assert.equal(pkg.exports["."].types, "./dist/index.d.mts");
  assert.deepEqual(pkg.files, ["dist"]);
  for (const k of ["preact", "@cascivo/react", "@cascivo/themes", "@preact/signals-react"]) {
    assert.equal(pkg.peerDependencies[k], "catalog:", k);
    assert.equal(pkg.devDependencies[k], "catalog:", k);
    assert.ok(!(k in (pkg.dependencies ?? {})), k);
  }
});

test("vite.config.ts uses deps.neverBundle, not the deprecated external", async () => {
  const { dir } = await renderCombo(["base", "ui-storybook"]);
  const text = await read(dir, "packages/ui/vite.config.ts");
  assert.match(text, /neverBundle/);
  assert.ok(!/\bexternal\b/.test(text.replace(/\/\/.*$/gm, "")));
});

test("storybook:build is off the PR path and cached by turbo", async () => {
  assert.ok(!CI_TASKS.includes("storybook:build"));
  const { dir } = await renderCombo(["base"]);
  const turbo = JSON.parse(await read(dir, "turbo.json"));
  assert.deepEqual(turbo.tasks["storybook:build"].outputs, ["storybook-static/**"]);
});

test("root AGENTS.md mentions packages/ui; AGENTS + CLAUDE stay ≤ 80 lines", async () => {
  const { dir } = await renderCombo(["base", "ui-storybook"]);
  const text = await read(dir, "AGENTS.md");
  assert.match(text, /packages\/ui/);
  assert.match(text, /`packages\/ui\/AGENTS\.md`/);
  assert.ok(lineCount(text) + lineCount(await read(dir, "CLAUDE.md")) <= 80);
  assert.ok(!/ui-storybook/.test(await read((await renderCombo(["base"])).dir, "AGENTS.md")));
});
