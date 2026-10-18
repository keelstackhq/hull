import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { parse as parseToml } from "smol-toml";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { REAL_TEMPLATE, assertInstanceNotes, lineCount, renderCombo } from "./helpers.mjs";
import { assertSameBranches } from "./invariants.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const byPath = (result) => Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
// smol-toml returns null-prototype objects, which deepEqual treats as different from plain ones
const plain = (v) => JSON.parse(JSON.stringify(v));
const PIECES = ["base", "rust-cli:cli"];
const BASE = join(REAL_TEMPLATE, "pieces/base/files");

async function walk(dir, rel = "") {
  const out = [];
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, p)));
    else out.push(p);
  }
  return out;
}

const DEPENDENCIES = {
  clap: "4.6.7",
  clap_complete: "4.6.11",
  clap_mangen: "0.3.3",
  thiserror: "2.0.21",
  serde: "1.0.229",
  serde_json: "1.0.154",
  tracing: "0.1.44",
  "tracing-subscriber": "0.3.23",
};
const DEV_DEPENDENCIES = {
  assert_cmd: "2.2.2",
  predicates: "3.1.4",
  insta: "1.49.0",
  tempfile: "3.27.0",
};

test("piece manifest", async () => {
  const p = (await loadTemplate(REAL_TEMPLATE)).pieces.get("rust-cli");
  assert.ok(p);
  assert.equal(p.multiple, true);
  assert.equal(p.target, "crates/{{ name }}");
  assert.equal(p.vars.name.default, "cli");
  assert.deepEqual(p.requires, ["base"]);
  assert.deepEqual(
    p.post.map((x) => [x.run, x.when]),
    [
      ["cargo generate-lockfile", ["new"]],
      ["cargo update --workspace", ["add"]],
    ],
  );
});

test("classes", async () => {
  const { result } = await renderCombo(PIECES);
  const cls = byPath(result);
  assert.equal(cls["crates/cli/Cargo.toml"], "shared");
  assert.equal(cls["crates/cli/package.json"], "shared");
  for (const f of ["turbo.json", "deny.toml", "AGENTS.md"]) {
    assert.equal(cls[`crates/cli/${f}`], "owned", f);
  }
  for (const f of ["main", "run", "cli", "exit", "error", "output", "log"]) {
    assert.equal(cls[`crates/cli/src/${f}.rs`], "seed", f);
  }
  assert.equal(cls["crates/cli/tests/common/mod.rs"], "seed");
  assert.equal(cls["crates/cli/tests/cli.rs"], "seed");
  assert.equal(cls["crates/cli/CLAUDE.md"], "seed");
});

test("every dependency pinned =x.y.z with the plan's versions", async () => {
  const { dir } = await renderCombo(PIECES);
  const cargo = parseToml(await read(dir, "crates/cli/Cargo.toml"));
  const versions = (table) =>
    Object.fromEntries(
      Object.entries(table).map(([name, spec]) => [
        name,
        (typeof spec === "string" ? spec : spec.version).replace(/^=/, ""),
      ]),
    );
  const pinned = (table) => {
    for (const [name, spec] of Object.entries(table)) {
      const v = typeof spec === "string" ? spec : spec.version;
      assert.match(v, /^=\d+\.\d+\.\d+$/, name);
    }
  };
  pinned(cargo.dependencies);
  pinned(cargo["dev-dependencies"]);
  assert.deepEqual(versions(cargo.dependencies), DEPENDENCIES);
  assert.deepEqual(versions(cargo["dev-dependencies"]), DEV_DEPENDENCIES);
  assert.deepEqual(cargo.dependencies.clap.features, ["derive", "env"]);
  assert.deepEqual(cargo.dependencies.serde.features, ["derive"]);
  assert.deepEqual(cargo.dependencies["tracing-subscriber"].features, ["env-filter", "fmt"]);
  assert.deepEqual(cargo["dev-dependencies"].insta.features, ["json"]);
});

test("Cargo.toml: binary named after the instance, edition 2024, toolchain MSRV, workspace lints", async () => {
  const { dir } = await renderCombo(["base", "rust-cli:mytool"]);
  const cargo = parseToml(await read(dir, "crates/mytool/Cargo.toml"));
  assert.equal(cargo.package.name, "mytool");
  assert.equal(cargo.package.version, "0.0.0");
  assert.equal(cargo.package.edition, "2024");
  assert.equal(cargo.package.publish, false);
  assert.deepEqual(plain(cargo.bin), [{ name: "mytool", path: "src/main.rs" }]);
  assert.deepEqual(plain(cargo.lints), { workspace: true });
  const toolchain = parseToml(await read(dir, "rust-toolchain.toml"));
  assert.equal(cargo.package["rust-version"], toolchain.toolchain.channel);
});

test("no openssl/openssl-sys/native-tls in Cargo.toml dependency tables, src/** or tests/**; deny.toml bans all three", async () => {
  const { dir } = await renderCombo(PIECES);
  const banned = ["openssl", "openssl-sys", "native-tls"];
  const cargo = parseToml(await read(dir, "crates/cli/Cargo.toml"));
  for (const table of ["dependencies", "dev-dependencies", "build-dependencies"]) {
    const keys = Object.keys(cargo[table] ?? {});
    for (const b of banned) assert.ok(!keys.includes(b), `${table} has ${b}`);
  }
  for (const rel of (await walk(dir, "crates/cli")).filter((p) => p.endsWith(".rs"))) {
    const text = await read(dir, rel);
    for (const b of banned) assert.ok(!text.includes(b), `${rel} mentions ${b}`);
  }
  const deny = parseToml(await read(dir, "crates/cli/deny.toml"));
  assert.deepEqual(
    deny.bans.deny.map((d) => d.crate),
    banned,
  );
});

test("deny.toml: licenses allow-list, private crates ignored, crates.io-only sources", async () => {
  const { dir } = await renderCombo(PIECES);
  const deny = parseToml(await read(dir, "crates/cli/deny.toml"));
  assert.deepEqual(deny.licenses.allow, [
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "Unicode-3.0",
    "Zlib",
  ]);
  assert.deepEqual(plain(deny.licenses.private), { ignore: true });
  assert.deepEqual(plain(deny.sources), {
    "unknown-registry": "deny",
    "unknown-git": "deny",
    "allow-registry": ["https://github.com/rust-lang/crates.io-index"],
  });
  assert.equal(deny.advisories.yanked, "deny"); // advisories are checked only in release.yml
});

test("package name ends in -crate; build is cargo build -p <name> --locked (debug); scripts use -p and --locked", async () => {
  const { dir } = await renderCombo(PIECES, { scope: "acme" });
  const pkg = JSON.parse(await read(dir, "crates/cli/package.json"));
  assert.equal(pkg.name, "@acme/cli-crate");
  assert.equal(pkg.private, true);
  assert.equal(pkg.version, "0.0.0");
  assert.deepEqual(pkg.hull, { release: "rust-cli" });
  const s = pkg.scripts;
  assert.equal(s.build, "cargo build -p cli --locked");
  assert.equal(s.typecheck, "cargo check -p cli --all-targets --locked");
  assert.equal(s.test, "cargo nextest run -p cli --locked");
  assert.equal(s["format:check"], "cargo fmt -p cli --check");
  for (const task of CI_TASKS) assert.ok(s[task], task);
  for (const [k, v] of Object.entries(s)) {
    assert.ok(!v.includes("--workspace"), k);
    assert.ok(!/vp run/.test(v), k);
    assert.ok(!v.includes("--release"), k);
    assert.match(v, /-p cli/, k);
  }
});

test("lint runs clippy -D warnings then cargo deny … check … bans licenses sources", async () => {
  const { dir } = await renderCombo(PIECES);
  const pkg = JSON.parse(await read(dir, "crates/cli/package.json"));
  assert.equal(
    pkg.scripts.lint,
    "cargo clippy -p cli --all-targets --locked -- -D warnings && cargo deny --manifest-path Cargo.toml --config deny.toml check bans licenses sources",
  );
});

test("turbo inputs include tests/**, deny.toml, $TURBO_ROOT$/Cargo.lock, $TURBO_ROOT$/rust-toolchain.toml; build outputs target/debug/<name>", async () => {
  const { dir } = await renderCombo(["base", "rust-cli:mytool"]);
  const t = JSON.parse(await read(dir, "crates/mytool/turbo.json"));
  assert.deepEqual(t.extends, ["//"]);
  assert.deepEqual(t.tasks.build.outputs, ["$TURBO_ROOT$/target/debug/mytool"]);
  const roots = [
    "$TURBO_ROOT$/Cargo.toml",
    "$TURBO_ROOT$/Cargo.lock",
    "$TURBO_ROOT$/rust-toolchain.toml",
  ];
  for (const task of ["build", "lint", "typecheck", "test"]) {
    for (const i of ["src/**", "Cargo.toml", ...roots]) {
      assert.ok(t.tasks[task].inputs.includes(i), `${task} ${i}`);
    }
  }
  for (const task of ["lint", "typecheck", "test", "format:check"]) {
    assert.ok(t.tasks[task].inputs.includes("tests/**"), task);
  }
  assert.ok(t.tasks.lint.inputs.includes("deny.toml"));
  assert.deepEqual(t.tasks["format:check"].inputs, [
    "src/**",
    "tests/**",
    "Cargo.toml",
    "$TURBO_ROOT$/rust-toolchain.toml",
  ]);
});

test("no Rust source contains {{, {% or {#", async () => {
  const { dir } = await renderCombo(PIECES);
  const files = (await walk(join(REAL_TEMPLATE, "pieces/rust-cli/files"))).filter((p) =>
    p.endsWith(".rs"),
  );
  assert.equal(files.length, 9);
  for (const rel of files) {
    const raw = await readFile(join(REAL_TEMPLATE, "pieces/rust-cli/files", rel), "utf8");
    assert.doesNotMatch(raw, /\{\{|\{%|\{#/, rel);
    assert.ok(!rel.endsWith(".jinja"), rel);
  }
  assert.ok((await walk(dir, "crates/cli/src")).length === 7);
});

test("base with rust-cli: root Cargo.toml members crates/*, toolchain 1.99.1 + clippy + rustfmt, rust-affected rendered", async () => {
  const { dir, result } = await renderCombo(PIECES);
  const cargo = await read(dir, "Cargo.toml");
  assert.match(cargo, /members = \[\n {2}"crates\/\*",\n\]/);
  assert.match(cargo, /unsafe_code = "forbid"/);
  assert.equal(
    await read(dir, "rust-toolchain.toml"),
    '[toolchain]\nchannel = "1.99.1"\ncomponents = ["clippy", "rustfmt"]\n',
  );
  assert.equal(byPath(result)[".github/scripts/rust-affected.mjs"], "owned");
  const both = await renderCombo(["base", "rust-cli:cli", "preact-app:web", "tauri-app:desktop"]);
  assert.match(
    await read(both.dir, "Cargo.toml"),
    /members = \[\n {2}"crates\/\*",\n {2}"apps\/\*\/src-tauri",\n\]/,
  );
  assert.match(await read(both.dir, "rust-toolchain.toml"), /channel = "1\.99\.1"/);
});

const TURBO_LINE = '  "globalDependencies": ["vite.config.ts", "tsconfig.base.json"],\n';
const TURBO_BLOCK =
  '  "globalDependencies": [\n    "vite.config.ts",\n    "tsconfig.base.json",\n    "Cargo.toml",\n    "Cargo.lock",\n    "rust-toolchain.toml"\n  ],\n';

test("turbo.json globalDependencies for none / rust-cli / rust-tool / both", async () => {
  const cases = [
    [["base"], TURBO_LINE, ["vite.config.ts", "tsconfig.base.json"]],
    [PIECES, TURBO_BLOCK, null],
    [["base", "rust-tool:tool"], TURBO_BLOCK, null],
    [["base", "rust-cli:cli", "rust-tool:tool"], TURBO_BLOCK, null],
  ];
  for (const [pieces, raw, exact] of cases) {
    const { dir } = await renderCombo(pieces);
    const text = await read(dir, "turbo.json");
    assert.ok(
      text.includes(`"$schema": "https://turbo.build/schema.json",\n${raw}  "tasks": {`),
      pieces.join(),
    );
    assert.deepEqual(
      JSON.parse(text).globalDependencies,
      exact ?? [
        "vite.config.ts",
        "tsconfig.base.json",
        "Cargo.toml",
        "Cargo.lock",
        "rust-toolchain.toml",
      ],
      pieces.join(),
    );
  }
});

test("rust-tool without rust-cli renders Cargo.toml, rust-toolchain.toml, rust-affected.mjs byte-identical to before", async () => {
  const { dir } = await renderCombo(["base", "rust-tool:tool"]);
  assert.equal(
    await read(dir, "Cargo.toml"),
    '[workspace]\nresolver = "3"\nmembers = [\n  "crates/*",\n]\n\n[workspace.lints.rust]\nunsafe_code = "forbid"\n\n[workspace.lints.clippy]\nall = { level = "warn", priority = -1 }\n\n[profile.release]\nlto = "thin"\n',
  );
  assert.equal(
    await read(dir, "rust-toolchain.toml"),
    '[toolchain]\nchannel = "stable"\ncomponents = ["clippy", "rustfmt"]\n',
  );
  // sha256 of the file rendered at 5ea2f12, before the rust-cli branch existed
  const sha = createHash("sha256")
    .update(await read(dir, ".github/scripts/rust-affected.mjs"))
    .digest("hex");
  assert.equal(sha, "150e7c559d512a5456c8feaf3db3dc0ee20477467c7c7aabdc6d7cc25cb8dbee");
  const tauri = await renderCombo(["base", "preact-app:web", "tauri-app:desktop"]);
  assert.equal(
    await read(tauri.dir, "Cargo.toml"),
    '[workspace]\nresolver = "3"\nmembers = [\n  "apps/*/src-tauri",\n]\n\n[workspace.lints.rust]\nunsafe_code = "forbid"\n\n[workspace.lints.clippy]\nall = { level = "warn", priority = -1 }\n\n[profile.release]\nlto = "thin"\n',
  );
  assert.equal(
    await read(tauri.dir, "rust-toolchain.toml"),
    '[toolchain]\nchannel = "stable"\ncomponents = ["rustfmt"]\n',
  );
});

test("same-branches invariant holds for every touched base file", () => {
  for (const f of [
    "Cargo.toml.jinja",
    "rust-toolchain.toml.jinja",
    "turbo.json.jinja",
    ".github/scripts/rust-affected.mjs.jinja",
    "AGENTS.md.jinja",
  ]) {
    assertSameBranches(join(BASE, f));
  }
});

test("renovate preset groups clap and tracing and tracks the cargo-deny pin", async () => {
  const preset = JSON.parse(await readFile(new URL("../renovate/default.json", import.meta.url)));
  const group = (name) => preset.packageRules.find((r) => r.groupName === name);
  assert.deepEqual(group("clap").matchPackageNames, ["clap", "clap_*"]);
  assert.deepEqual(group("tracing").matchPackageNames, ["tracing", "tracing-*"]);
  const mgr = preset.customManagers.find((m) => m.depNameTemplate === "cargo-deny");
  assert.equal(mgr.customType, "regex");
  assert.equal(mgr.datasourceTemplate, "crate");
  assert.deepEqual(mgr.managerFilePatterns, ["/^\\.github/workflows/.*\\.ya?ml$/"]);
  const ci = await readFile(join(BASE, ".github/workflows/ci.yml"), "utf8");
  const m = new RegExp(mgr.matchStrings[0]).exec(ci);
  assert.equal(m?.groups?.currentValue, "0.20.2");
});

test("per-instance notes: AGENTS.md owned within 20 lines, CLAUDE.md seed", async () => {
  const { agents } = await assertInstanceNotes(PIECES, "crates/cli");
  assert.match(agents, /^# /);
  assert.match(agents, /common::cli\(\)/);
  assert.match(agents, /cargo insta review/);
  assert.match(agents, /rustls/);
});

test("root AGENTS.md lists rust-cli crates; AGENTS + CLAUDE stay within 80 lines", async () => {
  const { dir } = await renderCombo(PIECES);
  const t = await read(dir, "AGENTS.md");
  assert.match(t, /- `crates\/\*` \(rust-cli\)[^\n]*`crates\/<name>\/AGENTS\.md`/);
  assert.ok(lineCount(t) <= 60);
  assert.ok(lineCount(t) + lineCount(await read(dir, "CLAUDE.md")) <= 80);
});

test("add-piece skill lists rust-cli", async () => {
  const { dir } = await renderCombo(["base"]);
  assert.match(
    await read(dir, ".claude/skills/add-piece/SKILL.md"),
    /\(preact-app, ui-storybook, astro-site, hono-worker, rust-tool, rust-cli, tauri-app, ts-lib, npm-cli, docs\)/,
  );
});

test("ci.yml installs the toolchain pinned in rust-toolchain.toml, never @stable, and keys the cache on it", async () => {
  const { dir } = await renderCombo(PIECES);
  const raw = await read(dir, ".github/workflows/ci.yml");
  assert.doesNotMatch(raw, /rust-toolchain@stable/);
  const steps = YAML.parse(raw).jobs.ci.steps;
  const toolchain = steps.find((s) => s.id === "toolchain");
  assert.equal(toolchain.run, "rustup toolchain install");
  assert.match(toolchain.if, /steps\.rust\.outputs\.rust == 'true'/);
  const cache = steps.find((s) => s.uses?.startsWith("Swatinem/rust-cache@"));
  assert.ok(steps.indexOf(toolchain) < steps.indexOf(cache));
  assert.equal(cache.with.key, "${{ hashFiles('rust-toolchain.toml') }}");
});
