import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { REAL_TEMPLATE, lineCount, renderCombo } from "./helpers.mjs";
import { assertSameBranches } from "./invariants.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const byPath = (result) => Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
const piece = (r) => r.result.changes.filter((c) => c.action !== "skip").map((c) => c.path);

test("piece manifest", async () => {
  const p = (await loadTemplate(REAL_TEMPLATE)).pieces.get("rust-tool");
  assert.ok(p);
  assert.equal(p.multiple, true);
  assert.equal(p.target, "crates/{{ name }}");
  assert.equal(p.vars.name.default, "tool");
  assert.deepEqual(p.requires, ["base"]);
  assert.deepEqual(
    p.post.map((x) => [x.run, x.when]),
    [
      ["cargo generate-lockfile", ["new"]],
      ["cargo update --workspace", ["add"]],
    ],
  );
});

test("root Cargo.toml only with a Rust piece; branches identical", async () => {
  const root = join(REAL_TEMPLATE, "pieces/base/files");
  assertSameBranches(join(root, "Cargo.toml.jinja"));
  const without = await renderCombo(["base"]);
  for (const f of ["Cargo.toml", "rust-toolchain.toml", ".github/scripts/rust-affected.mjs"]) {
    assert.ok(!piece(without).includes(f), f);
  }
  const withRust = await renderCombo(["base", "rust-tool:tool"]);
  const cls = byPath(withRust.result);
  assert.equal(cls["Cargo.toml"], "owned");
  assert.equal(cls["rust-toolchain.toml"], "owned");
  const cargo = await read(withRust.dir, "Cargo.toml");
  assert.match(cargo, /resolver = "3"/);
  // a glob that matches nothing is a hard cargo error, so members list only the present kinds
  assert.match(cargo, /members = \[\n {2}"crates\/\*",\n\]/);
  assert.match(cargo, /lto = "thin"/);
  const tc = await read(withRust.dir, "rust-toolchain.toml");
  assert.match(tc, /channel = "stable"/);
  assert.match(tc, /clippy/);
  assert.match(tc, /rustfmt/);
});

test("crate classes", async () => {
  const { result } = await renderCombo(["base", "rust-tool:tool"]);
  const cls = byPath(result);
  assert.equal(cls["crates/tool/Cargo.toml"], "shared");
  assert.equal(cls["crates/tool/package.json"], "shared");
  assert.equal(cls["crates/tool/turbo.json"], "owned");
  assert.equal(cls["crates/tool/CLAUDE.md"], "owned");
  assert.equal(cls["crates/tool/src/main.rs"], "seed");
});

test("crate Cargo.toml", async () => {
  const { dir } = await renderCombo(["base", "rust-tool:tool"]);
  const t = await read(dir, "crates/tool/Cargo.toml");
  assert.match(t, /name = "tool"/);
  assert.match(t, /edition = "2024"/);
  assert.match(t, /\[lints\]\nworkspace = true/);
  assert.match(await read(dir, "crates/tool/src/main.rs"), /#\[test\]/);
});

test("scripts call cargo with -p and never --workspace", async () => {
  const { dir } = await renderCombo(["base", "rust-tool:tool"], { scope: "acme" });
  const pkg = JSON.parse(await read(dir, "crates/tool/package.json"));
  const s = pkg.scripts;
  assert.equal(pkg.name, "@acme/tool");
  assert.equal(s.build, "cargo build --release -p tool");
  assert.equal(s.test, "cargo nextest run -p tool");
  assert.equal(s.lint, "cargo clippy -p tool --all-targets -- -D warnings");
  assert.equal(s["format:check"], "cargo fmt -p tool --check");
  for (const task of CI_TASKS) assert.ok(s[task], task);
  assert.ok(!Object.values(s).some((v) => v.includes("--workspace")));
  assert.ok(!Object.values(s).some((v) => /vp run/.test(v)));
});

test("turbo outputs point at target/release/<name>", async () => {
  const { dir } = await renderCombo(["base", "rust-tool:tool"]);
  const t = JSON.parse(await read(dir, "crates/tool/turbo.json"));
  assert.deepEqual(t.extends, ["//"]);
  assert.deepEqual(t.tasks.build.outputs, ["$TURBO_ROOT$/target/release/tool"]);
  assert.ok(t.tasks.build.inputs.includes("src/**"));
  assert.ok(t.tasks.build.inputs.includes("$TURBO_ROOT$/Cargo.lock"));
});

test("two instances render two crates and one workspace", async () => {
  const { dir, result } = await renderCombo(["base", "rust-tool:a", "rust-tool:b"]);
  const paths = piece({ result });
  assert.equal(paths.filter((p) => p === "Cargo.toml").length, 1);
  for (const n of ["a", "b"]) {
    assert.ok(paths.includes(`crates/${n}/Cargo.toml`));
    const t = JSON.parse(await read(dir, `crates/${n}/turbo.json`));
    assert.deepEqual(t.tasks.build.outputs, [`$TURBO_ROOT$/target/release/${n}`]);
    const pkg = JSON.parse(await read(dir, `crates/${n}/package.json`));
    assert.match(pkg.scripts.test, new RegExp(`-p ${n}$`));
  }
});

test("rust steps are guarded by the decision step, which only runs when rust-affected.mjs exists", async () => {
  const { dir, result } = await renderCombo(["base", "rust-tool:tool"]);
  const wf = YAML.parse(await read(dir, ".github/workflows/ci.yml"));
  const steps = wf.jobs.ci.steps;
  const decision = steps.find((s) => s.id === "rust");
  assert.ok(decision);
  assert.match(decision.if, /hashFiles\('\.github\/scripts\/rust-affected\.mjs'\) != ''/);
  assert.match(decision.run, /turbo query affected --packages/);
  assert.match(decision.run, /node \.github\/scripts\/rust-affected\.mjs/);
  assert.match(decision.run, /rust=true/);
  const rustSteps = steps.filter((s) => /^(dtolnay|Swatinem|taiki-e)\//.test(s.uses ?? ""));
  assert.deepEqual(
    rustSteps.map((s) => s.uses.split("@")[0]),
    ["dtolnay/rust-toolchain", "Swatinem/rust-cache", "taiki-e/install-action"],
  );
  for (const s of rustSteps) assert.match(s.if, /steps\.rust\.outputs\.rust == 'true'/, s.uses);
  assert.equal(rustSteps[2].with.tool, "cargo-nextest");
  const idx = (s) => steps.indexOf(s);
  assert.ok(idx(decision) < idx(rustSteps[0]));
  assert.ok(idx(rustSteps.at(-1)) < steps.length - 2);
  assert.match(steps.at(-2).run, /^pnpm turbo run /);
  assert.equal(byPath(result)[".github/scripts/rust-affected.mjs"], "owned");
  // the decision script is owned and rendered only with rust-tool (plain ci.yml is shared by all combos)
  const base = await renderCombo(["base"]);
  assert.ok(!piece(base).includes(".github/scripts/rust-affected.mjs"));
});

test("rust decision: affected packages with Cargo.toml → true", async () => {
  const { dir } = await renderCombo(["base", "rust-tool:tool"]);
  const { decide } = await import(join(dir, ".github/scripts/rust-affected.mjs"));
  const pkgs = (...items) => ({ data: { affectedPackages: { items } } });
  const has = (p) => p === "crates/tool";
  const ts = pkgs({ name: "@x/shared", path: "packages/shared" });
  const rust = pkgs({ name: "@x/tool", path: "crates/tool" });
  assert.equal(decide(ts, [], has), false);
  assert.equal(decide(pkgs(), [], has), false);
  assert.equal(decide(rust, [], has), true);
  assert.equal(
    decide(pkgs({ name: "//", path: "" }), ["CLAUDE.md"], () => true),
    false,
  );
  assert.equal(
    decide(pkgs({ name: "//", path: "" }), ["Cargo.lock"], () => false),
    true,
  );
  assert.equal(decide({}, [], has), false);
});

test("rust-affected.mjs end to end: reads stdin JSON, prints rust=", async () => {
  const { dir } = await renderCombo(["base", "rust-tool:tool"]);
  const git = (...a) =>
    execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", ...a], {
      cwd: dir,
      encoding: "utf8",
    });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const run = (json) =>
    execFileSync("node", [".github/scripts/rust-affected.mjs"], {
      cwd: dir,
      input: json,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, TURBO_SCM_BASE: "HEAD", TURBO_SCM_HEAD: "HEAD" },
    }).trim();
  const pkgs = (...items) => JSON.stringify({ data: { affectedPackages: { items } } });
  assert.equal(run(pkgs({ name: "@x/shared", path: "packages/shared" })), "rust=false");
  assert.equal(run(pkgs({ name: "@hullci/tool", path: "crates/tool" })), "rust=true");
  assert.equal(run("not json"), "rust=true");
});

test("base AGENTS.md lists rust-tool; AGENTS + CLAUDE stay within 80 lines", async () => {
  const { dir } = await renderCombo(["base", "rust-tool:tool"]);
  const t = await read(dir, "AGENTS.md");
  assert.match(t, /\(rust-tool\)/);
  assert.match(t, /`crates\/<name>\/AGENTS\.md`/);
  assert.ok(lineCount(t) + lineCount(await read(dir, "CLAUDE.md")) <= 80);
});

test("site combo includes rust-tool", async () => {
  const combos = JSON.parse(await readFile(new URL("../scripts/combos.json", import.meta.url)));
  assert.ok(combos.combos.find((c) => c.name === "site").pieces.includes("rust-tool:tool"));
});

test("root Cargo files are turbo globalDependencies only with a Rust piece", async () => {
  const root = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"];
  const rust = JSON.parse(
    await read((await renderCombo(["base", "rust-tool:tool"])).dir, "turbo.json"),
  );
  for (const f of root) assert.ok(rust.globalDependencies.includes(f), f);
  const plain = JSON.parse(await read((await renderCombo(["base"])).dir, "turbo.json"));
  for (const f of root) assert.ok(!plain.globalDependencies.includes(f), f);
  assert.ok(plain.globalDependencies.includes("vite.config.ts"));
});
