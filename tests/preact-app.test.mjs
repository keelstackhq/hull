import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { REAL_TEMPLATE, renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const byPath = (result) => Object.fromEntries(result.changes.map((c) => [c.path, c.class]));

test("piece manifest", async () => {
  const piece = (await loadTemplate(REAL_TEMPLATE)).pieces.get("preact-app");
  assert.ok(piece);
  assert.equal(piece.multiple, true);
  assert.equal(piece.target, "apps/{{ name }}");
  assert.equal(piece.vars.name.default, "web");
  assert.deepEqual(piece.requires, ["base"]);
});

test("renders at apps/<name> with classes", async () => {
  const { result } = await renderCombo(["base", "preact-app:admin"]);
  const cls = byPath(result);
  assert.equal(cls["apps/admin/package.json"], "shared");
  assert.equal(cls["apps/admin/vite.config.ts"], "owned");
  assert.equal(cls["apps/admin/src/app.tsx"], "seed");
  assert.equal(cls["apps/admin/wrangler.jsonc"], "shared");
});

test("package name and CI scripts", async () => {
  const { dir } = await renderCombo(["base", "preact-app:admin"], { scope: "acme" });
  const pkg = JSON.parse(await read(dir, "apps/admin/package.json"));
  assert.equal(pkg.name, "@acme/admin");
  for (const task of CI_TASKS) assert.ok(pkg.scripts[task], task);
  for (const [k, v] of Object.entries(pkg.scripts)) assert.ok(!/vp run/.test(v), k);
  assert.equal(pkg.scripts.build, "vp build");
  assert.equal(
    pkg.scripts["deploy:preview"],
    "wrangler versions upload --preview-alias pr-$PR_NUMBER",
  );
  for (const v of Object.values({ ...pkg.dependencies, ...pkg.devDependencies }))
    assert.equal(v, "catalog:");
});

test("react and react-dom are dev-only; dev server pinned for tauri", async () => {
  const { dir } = await renderCombo(["base", "preact-app:admin"]);
  const pkg = JSON.parse(await read(dir, "apps/admin/package.json"));
  for (const k of ["react", "react-dom"]) {
    assert.ok(pkg.devDependencies[k], k);
    assert.ok(!(k in pkg.dependencies), k);
  }
  assert.equal(pkg.scripts.dev, "vp dev");
  const vite = await read(dir, "apps/admin/vite.config.ts");
  assert.match(vite, /port: 5173/);
  assert.match(vite, /strictPort: true/);
});

test("workspace catalog pins the cascivo Preact path", async () => {
  const { dir } = await renderCombo(["base", "preact-app"]);
  const ws = YAML.parse(await read(dir, "pnpm-workspace.yaml"));
  for (const k of [
    "@cascivo/react",
    "@cascivo/themes",
    "@preact/signals-react",
    "react",
    "react-dom",
  ])
    assert.match(ws.catalog[k], /^\d+\.\d+\.\d+$/, k);
  const ts = JSON.parse(await read(dir, "apps/web/tsconfig.json"));
  assert.deepEqual(ts.compilerOptions.paths.react, ["./node_modules/preact/compat"]);
});

test("preact-app depends on the UI package only when ui-storybook is present", async () => {
  const withUi = await renderCombo(["base", "preact-app", "ui-storybook"], { scope: "acme" });
  const pkg = JSON.parse(await read(withUi.dir, "apps/web/package.json"));
  assert.equal(pkg.dependencies["@acme/ui"], "workspace:*");
  assert.match(await read(withUi.dir, "apps/web/CLAUDE.md"), /@acme\/ui/);
  const without = await renderCombo(["base", "preact-app"], { scope: "acme" });
  const pkg2 = JSON.parse(await read(without.dir, "apps/web/package.json"));
  assert.equal(pkg2.dependencies["@acme/ui"], undefined);
  assert.ok(!/@acme\/ui/.test(await read(without.dir, "apps/web/CLAUDE.md")));
});

test("wrangler.jsonc serves dist as an SPA with observability", async () => {
  const { dir } = await renderCombo(["base", "preact-app:admin"]);
  const text = (await read(dir, "apps/admin/wrangler.jsonc"))
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  const w = JSON.parse(text);
  assert.equal(w.name, "admin");
  assert.equal(w.assets.directory, "./dist");
  assert.equal(w.assets.not_found_handling, "single-page-application");
  assert.equal(w.observability.enabled, true);
  assert.equal(w.compatibility_date, "2026-10-01");
});

test("root CLAUDE.md mentions apps when preact-app is present and stays ≤ 80 lines", async () => {
  const withApp = (await renderCombo(["base", "preact-app"])).dir;
  const text = await read(withApp, "CLAUDE.md");
  assert.match(text, /apps\/\*/);
  assert.match(text, /preact-app/);
  assert.ok(text.split("\n").length <= 80);
  const without = await read((await renderCombo(["base"])).dir, "CLAUDE.md");
  assert.ok(!/preact-app/.test(without));
});
