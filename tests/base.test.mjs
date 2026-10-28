import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { comboVars, isRustTemplate, loadCombos } from "../scripts/lib/combos.mjs";
import { renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");

test("CI_TASKS is the fixed task list", () => {
  assert.deepEqual([...CI_TASKS], ["lint", "format:check", "typecheck", "test", "build"]);
});

test("base renders the expected classes", async () => {
  const { result } = await renderCombo(["base"]);
  const cls = Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
  assert.equal(cls["package.json"], "shared");
  assert.equal(cls["pnpm-workspace.yaml"], "shared");
  assert.equal(cls["turbo.json"], "shared");
  assert.equal(cls["packages/shared/package.json"], "shared");
  assert.equal(cls["vite.config.ts"], "owned");
  assert.equal(cls["tsconfig.base.json"], "owned");
  assert.equal(cls["packages/shared/src/index.ts"], "seed");
  assert.equal(cls["packages/shared/src/index.test.ts"], "seed");
  assert.equal(cls["docs/agents/project.md"], "seed");
  assert.equal(cls["README.md"], "seed");
});

test("catalog pins exact versions from the spec", async () => {
  const { dir } = await renderCombo(["base"]);
  const ws = YAML.parse(await read(dir, "pnpm-workspace.yaml"));
  assert.equal(ws.catalog["vite-plus"], "1.1.0");
  assert.equal(ws.catalog.turbo, "2.11.8");
  assert.equal(ws.catalog.typescript, "7.0.2");
  assert.equal(ws.catalog["@types/node"], "24.19.2");
  assert.equal(ws.overrides.vite, "npm:@voidzero-dev/vite-plus-core@1.1.0");
  for (const [k, v] of Object.entries(ws.catalog)) assert.match(v, /^\d+\.\d+\.\d+$/, k);
  assert.deepEqual(ws.packages, ["apps/*", "packages/*", "crates/*"]);
  assert.equal(ws.minimumReleaseAge, 4320);
  // Young pins go here as exact name@version entries (never ranges), dropped once 3 days old.
  for (const e of ws.minimumReleaseAgeExclude ?? []) assert.match(e, /^.+@\d+\.\d+\.\d+$/, e);
  assert.deepEqual(ws.minimumReleaseAgeExclude, ["@keelstackhq/docspack@0.1.1"]);
  assert.deepEqual(ws.allowBuilds, { esbuild: true, workerd: true, sharp: true });
  assert.equal(ws.peerDependencyRules.allowedVersions["storybook>vite-plus"], "1");
  assert.equal(ws.peerDependencyRules.allowedVersions.vite, "1");
});

test("vite override matches the vite-plus pin", async () => {
  const { dir } = await renderCombo(["base"]);
  const ws = YAML.parse(await read(dir, "pnpm-workspace.yaml"));
  assert.equal(ws.overrides.vite, `npm:@voidzero-dev/vite-plus-core@${ws.catalog["vite-plus"]}`);
});

test("ci script uses CI_TASKS with --affected", async () => {
  const { dir } = await renderCombo(["base"]);
  const pkg = JSON.parse(await read(dir, "package.json"));
  assert.equal(pkg.scripts.ci, `turbo run ${CI_TASKS.join(" ")} --affected`);
  assert.equal(pkg.scripts.check, "turbo run lint format:check typecheck test");
  assert.equal(pkg.packageManager, "pnpm@12.11.2");
  assert.equal(pkg.devDependencies.docspack, undefined);
});

test("docs piece adds docspack to root devDependencies", async () => {
  const { renderString } = await import("../scripts/lib/render-file.mjs");
  const src = await readFile(
    join(import.meta.dirname, "..", "template/pieces/base/files/package.json.jinja"),
    "utf8",
  );
  const ctx = (pieces) => ({ scope: "acme", pieces, template: { name: "hull", version: "0" } });
  const withDocs = JSON.parse(renderString(src, ctx(["base", "docs"])));
  assert.equal(withDocs.devDependencies.docspack, "catalog:");
  const without = JSON.parse(renderString(src, ctx(["base"])));
  assert.equal(without.devDependencies.docspack, undefined);
});

test("turbo.json hashes root config files into every task", async () => {
  const { dir } = await renderCombo(["base"]);
  const turbo = JSON.parse(await read(dir, "turbo.json"));
  assert.ok(turbo.globalDependencies.includes("vite.config.ts"));
  assert.ok(turbo.globalDependencies.includes("tsconfig.base.json"));
});

test("root format:check covers root files via a root turbo task", async () => {
  const { dir } = await renderCombo(["base"]);
  const turbo = JSON.parse(await read(dir, "turbo.json"));
  assert.ok(turbo.tasks["//#format:check"]);
  const pkg = JSON.parse(await read(dir, "package.json"));
  assert.match(pkg.scripts["format:check"], /^vp fmt --check /);
  assert.equal(pkg.scripts.ci, `turbo run ${CI_TASKS.join(" ")} --affected`);
});

test("turbo.json defines every CI task and no vp run", async () => {
  const { dir } = await renderCombo(["base"]);
  const turbo = JSON.parse(await read(dir, "turbo.json"));
  for (const t of CI_TASKS) assert.ok(turbo.tasks[t], t);
  assert.deepEqual(turbo.tasks.build.dependsOn, ["^build"]);
  assert.equal(turbo.tasks.dev.persistent, true);
  assert.equal(turbo.tasks.dev.cache, false);
  for (const rel of ["package.json", "packages/shared/package.json", "turbo.json"]) {
    assert.doesNotMatch(await read(dir, rel), /vp run/, rel);
  }
});

test("package.json name is the scope", async () => {
  const { dir } = await renderCombo(["base"], { scope: "zeta" });
  assert.equal(JSON.parse(await read(dir, "package.json")).name, "zeta");
  const shared = JSON.parse(await read(dir, "packages/shared/package.json"));
  assert.equal(shared.name, "@zeta/shared");
  for (const t of CI_TASKS) assert.ok(shared.scripts[t], t);
});

test("base post: install on new, lockfile-only refresh on update, then agents-index", async () => {
  const { loadTemplate } = await import("../scripts/lib/manifest.mjs");
  const { REAL_TEMPLATE } = await import("./helpers.mjs");
  const base = (await loadTemplate(REAL_TEMPLATE)).pieces.get("base");
  assert.deepEqual(base.post, [
    { run: "pnpm install --no-frozen-lockfile", when: ["new"] },
    // a catalog bump arrives via the pnpm-workspace.yaml merge; the bot's PR needs a matching lockfile
    { run: "pnpm install --lockfile-only --ignore-scripts", when: ["update"] },
    { run: "node scripts/agents-index.mjs", when: ["new", "add", "update"] },
  ]);
});

test("base owns splice.yml, rendered in every template combo incl. circleci-only", async () => {
  const { vars, combos } = loadCombos();
  const ts = combos.filter((c) => !isRustTemplate(c));
  assert.ok(ts.some((c) => c.name === "web-circleci-only"));
  const root = new URL("..", import.meta.url).pathname;
  const want = await read(root, "template/pieces/base/files/.github/workflows/splice.yml");
  for (const c of ts) {
    const { dir, result } = await renderCombo(c.pieces, comboVars(c, vars));
    const ch = result.changes.find((x) => x.path === ".github/workflows/splice.yml");
    assert.equal(ch?.class, "owned", c.name);
    assert.equal(await read(dir, ".github/workflows/splice.yml"), want, c.name);
  }
});
