import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { affectedCombos } from "../scripts/affected-combos.mjs";
import { loadCombos } from "../scripts/lib/combos.mjs";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { REAL_TEMPLATE, assertInstanceNotes, lineCount, renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const byPath = (result) => Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
const written = (r) => r.result.changes.filter((c) => c.action !== "skip").map((c) => c.path);
const sha = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const PIECES = ["base", "preact-app:web", "tauri-app:desktop"];
const combos = loadCombos();

test("piece manifest", async () => {
  const p = (await loadTemplate(REAL_TEMPLATE)).pieces.get("tauri-app");
  assert.ok(p);
  assert.deepEqual(p.requires, ["base", "preact-app"]);
  assert.equal(p.target, "apps/{{ name }}");
  assert.equal(p.vars.name.default, "desktop");
  assert.equal(p.vars.frontend.default, "web");
});

test("classes", async () => {
  const { result } = await renderCombo(PIECES);
  const cls = byPath(result);
  const t = "apps/desktop/src-tauri";
  assert.equal(cls["apps/desktop/package.json"], "shared");
  assert.equal(cls[`${t}/Cargo.toml`], "shared");
  assert.equal(cls[`${t}/tauri.conf.json`], "shared");
  assert.equal(cls[`${t}/build.rs`], "owned");
  assert.equal(cls[`${t}/src/main.rs`], "seed");
  assert.equal(cls[`${t}/src/lib.rs`], "seed");
  assert.equal(cls[`${t}/capabilities/default.json`], "seed");
  assert.equal(cls[`${t}/icons/icon.png`], "owned");
});

test("tauri.conf.json wires the frontend instance (spec 6.7)", async () => {
  const { dir } = await renderCombo(["base", "preact-app:admin", "tauri-app:desktop"], {
    scope: "acme",
    frontend: "admin",
  });
  const conf = JSON.parse(await read(dir, "apps/desktop/src-tauri/tauri.conf.json"));
  assert.equal(conf.build.beforeDevCommand, "pnpm --filter @acme/admin dev");
  assert.equal(conf.build.beforeBuildCommand, "pnpm --filter @acme/admin build");
  assert.equal(conf.build.frontendDist, "../../admin/dist");
  assert.equal(conf.build.devUrl, "http://localhost:5173");
  assert.deepEqual(conf.bundle.targets, ["deb"]);
  assert.match(conf.identifier, /^[A-Za-z0-9.-]+$/);
});

test("icons are copied byte for byte", async () => {
  const { dir } = await renderCombo(PIECES);
  const src = join(REAL_TEMPLATE, "pieces/tauri-app/files/src-tauri/icons");
  const names = await readdir(src);
  for (const n of [
    "32x32.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.icns",
    "icon.ico",
    "icon.png",
  ])
    assert.ok(names.includes(n), n);
  for (const n of names) {
    assert.equal(
      await sha(join(src, n)),
      await sha(join(dir, "apps/desktop/src-tauri/icons", n)),
      n,
    );
  }
});

test("package scripts: no lint/test/build/typecheck on the PR path", async () => {
  const { dir } = await renderCombo(PIECES, { scope: "acme" });
  const pkg = JSON.parse(await read(dir, "apps/desktop/package.json"));
  assert.equal(pkg.name, "@acme/desktop");
  assert.deepEqual(pkg.scripts, {
    tauri: "tauri",
    "build:desktop": "tauri build",
    "format:check": "cargo fmt --manifest-path src-tauri/Cargo.toml --check",
  });
  for (const t of CI_TASKS.filter((x) => x !== "format:check")) assert.ok(!pkg.scripts[t], t);
  assert.equal(pkg.devDependencies["@tauri-apps/cli"], "catalog:");
});

test("src-tauri crate is a workspace member and not named like -p scripts", async () => {
  const { dir } = await renderCombo(PIECES);
  const cargo = await read(dir, "apps/desktop/src-tauri/Cargo.toml");
  assert.match(cargo, /name = "desktop"/);
  assert.match(cargo, /tauri-build/);
  const root = await read(dir, "Cargo.toml");
  assert.match(root, /members = \[\n {2}"apps\/\*\/src-tauri",\n\]/);
  const both = await renderCombo([...PIECES, "rust-tool:tool"]);
  assert.match(
    await read(both.dir, "Cargo.toml"),
    /members = \[\n {2}"crates\/\*",\n {2}"apps\/\*\/src-tauri",\n\]/,
  );
  const tc = await read(dir, "rust-toolchain.toml");
  assert.match(tc, /components = \["rustfmt"\]/);
  assert.ok(!tc.includes("clippy"), "tauri-only needs no clippy");
  const bothTc = await read(both.dir, "rust-toolchain.toml");
  assert.match(bothTc, /components = \["clippy", "rustfmt"\]/);
  assert.match(cargo, /tauri = \{ version = "2\.12\.4"/);
  assert.match(cargo, /tauri-build = \{ version = "2\.7\.3"/);
});

test("desktop.yml exists only with tauri-app and needs no GitHub expressions", async () => {
  const src = await readFile(
    join(REAL_TEMPLATE, "pieces/base/files/.github/workflows/desktop.yml.jinja"),
    "utf8",
  );
  assert.ok(!src.includes("${{"), "a .jinja file cannot contain ${{");
  const without = await renderCombo(["base", "preact-app:web"]);
  assert.ok(!written(without).includes(".github/workflows/desktop.yml"));
  const { dir, result } = await renderCombo(PIECES);
  assert.equal(byPath(result)[".github/workflows/desktop.yml"], "owned");
  const wf = YAML.parse(await read(dir, ".github/workflows/desktop.yml"));
  assert.ok("workflow_dispatch" in wf.on);
  assert.ok(wf.on.schedule[0].cron);
  const steps = wf.jobs.desktop.steps;
  const apt = steps.map((s) => s.run ?? "").find((r) => r.includes("apt-get"));
  for (const p of ["libwebkit2gtk-4.1-dev", "libappindicator3-dev", "librsvg2-dev", "patchelf"])
    assert.match(apt, new RegExp(p));
  assert.ok(steps.some((s) => (s.uses ?? "").startsWith("dtolnay/rust-toolchain@")));
  assert.equal(steps.at(-1).run, "pnpm turbo run build:desktop");
  assert.equal(wf.permissions.contents, "read");
});

test("tauri-only repos get no Rust CI steps and no rust-affected script", async () => {
  const { dir, result } = await renderCombo(PIECES);
  assert.ok(!written({ result }).includes(".github/scripts/rust-affected.mjs"));
  const ci = await read(dir, ".github/workflows/ci.yml");
  assert.ok(!ci.includes("build:desktop"));
});

test("base AGENTS.md lists tauri-app; AGENTS + CLAUDE stay within 80 lines", async () => {
  const { dir } = await renderCombo(PIECES);
  const t = await read(dir, "AGENTS.md");
  assert.match(t, /\(tauri-app\)/);
  assert.match(t, /`apps\/<name>\/AGENTS\.md`/);
  assert.ok(lineCount(t) + lineCount(await read(dir, "CLAUDE.md")) <= 80);
  const doc = await read(dir, "apps/desktop/AGENTS.md");
  assert.match(doc, /webkit2gtk/);
  assert.match(doc, /bundle\.targets/);
});

test("desktop combo is scheduled and never selected by affected-combos", () => {
  const desktop = combos.combos.find((c) => c.name === "desktop");
  assert.deepEqual(desktop.pieces, PIECES);
  assert.equal(desktop.scheduled, true);
  const everything = [
    "template/pieces/tauri-app/files/x",
    "template/pieces/base/files/x",
    "scripts/render.mjs",
    "template/splice.toml",
    ".github/workflows/desktop.yml",
  ];
  for (const f of everything) assert.ok(!affectedCombos([f], combos.combos).includes("desktop"), f);
  assert.deepEqual(affectedCombos(everything, combos.combos).includes("web"), true);
});

test("hull desktop.yml derives its pieces from the scripts/combos/ fragments", async () => {
  const wf = YAML.parse(
    await readFile(new URL("../.github/workflows/desktop.yml", import.meta.url), "utf8"),
  );
  assert.ok("workflow_dispatch" in wf.on);
  assert.ok(wf.on.schedule[0].cron);
  const runs = wf.jobs.desktop.steps.map((s) => s.run ?? "").join("\n");
  assert.match(runs, /loadCombos/);
  assert.match(runs, /name === "desktop"/);
  assert.ok(!runs.includes("--piece tauri-app"), "pieces are not repeated");
  for (const p of ["libwebkit2gtk-4.1-dev", "libappindicator3-dev", "librsvg2-dev", "patchelf"])
    assert.match(runs, new RegExp(p));
  assert.match(runs, /pnpm turbo run build:desktop/);
});

test("renovate tauri group covers the npm and cargo packages", async () => {
  const p = JSON.parse(
    await readFile(new URL("../renovate/default.json", import.meta.url), "utf8"),
  );
  const rule = p.packageRules.find((r) => r.groupName === "tauri");
  for (const n of ["@tauri-apps/**", "tauri", "tauri-build"])
    assert.ok(rule.matchPackageNames.includes(n), n);
  assert.deepEqual(rule.matchManagers, ["npm", "cargo"]);
});

test("per-instance notes: AGENTS.md owned within 20 lines, CLAUDE.md seed", async () => {
  const { agents } = await assertInstanceNotes(
    ["base", "preact-app:web", "tauri-app:desktop"],
    "apps/desktop",
  );
  assert.match(agents, /^# /);
});
