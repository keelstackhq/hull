import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { REAL_TEMPLATE, assertInstanceNotes, renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const byPath = (result) => Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
const PIECES = ["base", "rust-cli:cli", "npm-cli:cli"];
const FILES = join(REAL_TEMPLATE, "pieces/npm-cli/files");

test("piece manifest", async () => {
  const p = (await loadTemplate(REAL_TEMPLATE)).pieces.get("npm-cli");
  assert.ok(p);
  assert.equal(p.multiple, true);
  assert.equal(p.target, "packages/{{ name }}");
  assert.equal(p.vars.name.default, "cli");
  assert.equal(p.vars.crate.default, "cli");
  assert.equal(p.vars.name.pattern, "^[a-z][a-z0-9-]*$");
  assert.equal(p.vars.crate.pattern, "^[a-z][a-z0-9-]*$");
  assert.deepEqual(p.requires, ["base"]);
});

test("classes", async () => {
  const { result } = await renderCombo(PIECES);
  const cls = byPath(result);
  const t = "packages/cli";
  assert.equal(cls[`${t}/package.json`], "shared");
  for (const f of [
    "turbo.json",
    "tsconfig.json",
    "vite.config.ts",
    "bin/launcher.js",
    "scripts/stage.mjs",
    "test/launcher.test.js",
    "test/stage.test.js",
    "test/version-sync.test.js",
    "AGENTS.md",
  ])
    assert.equal(cls[`${t}/${f}`], "owned", f);
  assert.equal(cls[`${t}/README.md`], "seed");
  assert.equal(cls[`${t}/CLAUDE.md`], "seed");
});

test("package.json: no publish-time metadata, four scripts, bin and crate wiring", async () => {
  const { dir } = await renderCombo(["base", "rust-cli:mytool", "npm-cli:mynpm"], {
    scope: "acme",
    "npm-cli.crate": "mytool",
  });
  const pkg = JSON.parse(await read(dir, "packages/mynpm/package.json"));
  assert.equal(pkg.name, "@acme/mynpm");
  assert.equal(pkg.version, "0.0.0");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.bin, { mytool: "bin/launcher.js" });
  assert.deepEqual(pkg.files, ["bin"]);
  assert.equal(pkg.publishConfig.provenance, true);
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.hull.release, "npm-cli");
  assert.equal(pkg.devDependencies["@acme/mytool-crate"], "workspace:*");
  assert.equal(pkg.optionalDependencies, undefined);
  assert.equal(pkg.repository, undefined);
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.equal(pkg.scripts.preinstall, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ["lint", "format:check", "typecheck", "test"]);
  assert.equal(pkg.scripts.test, "vp test run");
  assert.match(
    pkg.scripts.typecheck,
    /^node --check bin\/launcher\.js && node --check scripts\/stage\.mjs/,
  );
  for (const [k, v] of Object.entries(pkg.scripts)) assert.ok(!/vp run/.test(v), k);
});

test("turbo.json: test and typecheck do not build the crate", async () => {
  const { dir } = await renderCombo(PIECES);
  const turbo = JSON.parse(await read(dir, "packages/cli/turbo.json"));
  assert.deepEqual(turbo.extends, ["//"]);
  assert.deepEqual(turbo.tasks.test.dependsOn, []);
  assert.deepEqual(turbo.tasks.typecheck.dependsOn, []);
});

test("tsconfig checks the JavaScript sources (editors; typecheck is node --check)", async () => {
  const { dir } = await renderCombo(PIECES);
  const ts = JSON.parse(await read(dir, "packages/cli/tsconfig.json"));
  assert.equal(ts.extends, "../../tsconfig.base.json");
  assert.equal(ts.compilerOptions.allowJs, true);
  assert.equal(ts.compilerOptions.checkJs, true);
  assert.deepEqual(ts.include, ["bin", "scripts", "test"]);
});

test("AGENTS.md and README.md say a rust-cli instance is needed", async () => {
  const { dir } = await renderCombo(["base", "rust-cli:mytool", "npm-cli:cli"], {
    "npm-cli.crate": "mytool",
  });
  const re = /needs a rust-cli instance named `mytool`/;
  assert.match(await read(dir, "packages/cli/AGENTS.md"), re);
  assert.match(await read(dir, "packages/cli/README.md"), re);
});

test("launcher: plain JS with ts-check, no network, no install hooks", async () => {
  const names = await readdir(join(FILES, "bin"));
  assert.deepEqual(names, ["launcher.js"]);
  const src = await readFile(join(FILES, "bin/launcher.js"), "utf8");
  assert.match(src, /^#!\/usr\/bin\/env node\n\/\/ @ts-check\n/);
  assert.match(src, /createRequire\(import\.meta\.url\)/);
  assert.match(src, /stdio: "inherit"/);
  assert.equal(/https:|fetch\(|postinstall/.test(src), false);
});

test("stage.mjs exports TARGETS with the five platforms (single source)", async () => {
  const { TARGETS } = await import(join(FILES, "scripts/stage.mjs"));
  assert.deepEqual(TARGETS, {
    "linux-x64": "x86_64-unknown-linux-musl",
    "linux-arm64": "aarch64-unknown-linux-musl",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
  });
});

test("root AGENTS.md lists npm-cli packages", async () => {
  const { dir } = await renderCombo(PIECES);
  assert.match(
    await read(dir, "AGENTS.md"),
    /- `packages\/\*` \(npm-cli\)[^\n]*`packages\/<name>\/AGENTS\.md`/,
  );
});

test("per-instance notes: AGENTS.md owned within 20 lines, CLAUDE.md seed", async () => {
  const { agents } = await assertInstanceNotes(PIECES, "packages/cli");
  assert.match(agents, /postinstall/);
  assert.match(agents, /`version`/);
});
