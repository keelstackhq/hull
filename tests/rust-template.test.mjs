import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { RUST_CI_STEPS } from "../scripts/lib/ci-tasks.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { outputPath, overlaps } from "../scripts/lib/ownership.mjs";
import { checkSubset } from "../scripts/lib/subset.mjs";
import { renderNew } from "../scripts/render.mjs";
import { lineCount } from "./helpers.mjs";

const RUST = fileURLToPath(new URL("../template-rust", import.meta.url));
const HULL = fileURLToPath(new URL("../template", import.meta.url));
const BASE = join(RUST, "pieces/base/files");
const t = await loadTemplate(RUST);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function render(pieces) {
  const dir = join(await mkdtemp(join(tmpdir(), "hull-rust-")), "out");
  const result = await renderNew({ template: RUST, out: dir, pieces, vars: {} });
  return { dir, result };
}

const { docsOnly, pendingMod, indexMod } = {
  docsOnly: await import(join(BASE, ".github/scripts/docs-only.mjs")),
  pendingMod: await import(join(BASE, ".github/scripts/release-pending.mjs")),
  indexMod: await import(join(BASE, "scripts/agents-index.mjs")),
};

test("template-rust manifest: format 1, hull-rust, base, min_splice 0.2.0, no vars", () => {
  assert.equal(t.name, "hull-rust");
  assert.equal(t.base, "base");
  assert.equal(t.minSplice, "0.2.0");
  assert.deepEqual(Object.keys(t.vars ?? {}), []);
  assert.deepEqual([...t.pieces.keys()].sort(), ["base", "rust-cli"]);
});

test("template-rust invariants: one class per path, subset, no {{ in paths", async () => {
  for (const piece of t.pieces.values()) {
    for (const src of await walk(piece.filesDir)) {
      const rel = relative(piece.filesDir, src);
      assert.ok(!rel.includes("{{"), `${piece.id}: ${rel}`);
      const classes = overlaps(outputPath(rel), piece.files);
      assert.ok(classes.length <= 1, `${piece.id}: ${rel} is in ${classes.join(" and ")}`);
      if (rel.endsWith(".jinja")) {
        assert.deepEqual(checkSubset(await readFile(src, "utf8"), src), [], src);
      }
    }
  }
});

test("rendered rust combo: no Node toolchain files, a cargo workspace with crates/common", async () => {
  const { dir, result } = await render(["base", "rust-cli:cli"]);
  for (const f of ["package.json", "pnpm-workspace.yaml", "turbo.json", ".node-version"]) {
    assert.ok(!existsSync(join(dir, f)), f);
  }
  const cls = Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
  assert.equal(cls["Cargo.toml"], "shared");
  assert.equal(cls["crates/common/src/lib.rs"], "seed");
  assert.equal(cls["crates/cli/Cargo.toml"], "shared");
  assert.equal(cls["crates/cli/hoist.toml"], "seed");
  assert.equal(cls["AGENTS.md"], "seed");
  assert.equal(cls["CLAUDE.md"], "owned");
  assert.ok(!existsSync(join(dir, "crates/cli/deny.toml")), "deny.toml lives at the root only");
  const ws = await readFile(join(dir, "Cargo.toml"), "utf8");
  assert.match(ws, /members = \["crates\/\*"\]/);
  assert.match(ws, /rust-version = "1\.99\.1"/);
  const tc = await readFile(join(dir, "rust-toolchain.toml"), "utf8");
  assert.match(tc, /channel = "1\.99\.1"/);
});

test("AGENTS.md <= 60 and CLAUDE.md <= 20 lines, for base and the rust combo", async () => {
  for (const pieces of [["base"], ["base", "rust-cli:cli"]]) {
    const { dir } = await render(pieces);
    const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
    const claude = await readFile(join(dir, "CLAUDE.md"), "utf8");
    assert.ok(lineCount(agents) <= 60, `${pieces} AGENTS.md ${lineCount(agents)}`);
    assert.ok(lineCount(claude) <= 20, `${pieces} CLAUDE.md ${lineCount(claude)}`);
    assert.ok(!/\n\n\n/.test(agents + claude), `${pieces}: triple newline`);
    assert.equal(/rust-cli/.test(agents), pieces.length > 1, `${pieces}: rust-cli bullet`);
  }
});

test("RUST_CI_STEPS parity: ci.yml, AGENTS.md, verify skill and the index list the same steps", async () => {
  const wf = YAML.parse(await readFile(join(BASE, ".github/workflows/ci.yml"), "utf8"));
  const cargoRuns = wf.jobs.ci.steps.map((s) => s.run).filter((r) => r?.startsWith("cargo "));
  assert.deepEqual(cargoRuns, [...RUST_CI_STEPS]);
  const agents = await readFile(join(BASE, "AGENTS.md.jinja"), "utf8");
  const verify = await readFile(join(BASE, ".claude/skills/verify/SKILL.md"), "utf8");
  for (const s of RUST_CI_STEPS) {
    assert.ok(agents.includes(`${s}\n`), `AGENTS.md lacks ${s}`);
    assert.ok(verify.includes(`${s}\n`), `verify lacks ${s}`);
  }
  assert.deepEqual(
    indexMod.COMMANDS.map(([, c]) => c).filter((c) => c.startsWith("cargo ")),
    [...RUST_CI_STEPS],
  );
});

test("ci.yml: one job + ci-ok, every later step checks skip, no Node setup, no path filters", async () => {
  const wf = YAML.parse(await readFile(join(BASE, ".github/workflows/ci.yml"), "utf8"));
  assert.deepEqual(Object.keys(wf.jobs), ["ci", "ci-ok"]);
  assert.deepEqual(Object.keys(wf.on).sort(), ["merge_group", "pull_request", "push"]);
  assert.equal(wf.on.pull_request, null);
  const steps = wf.jobs.ci.steps;
  const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"));
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.equal(checkout.with.filter, "blob:none");
  assert.ok(!steps.some((s) => /setup-node|pnpm|hoard/.test(s.uses ?? "")));
  const i = steps.findIndex((s) => s.id === "affected");
  assert.ok(i > 0);
  for (const s of steps.slice(i + 1)) {
    if (s.name === "Job duration") continue;
    assert.match(s.if ?? "", /steps\.affected\.outputs\.skip != 'true'/, s.name ?? s.uses);
  }
  const tools = steps.find((s) => s.uses?.startsWith("taiki-e/install-action")).with.tool;
  assert.equal(tools, "cargo-nextest@0.9.148,cargo-deny@0.20.2");
  assert.equal(wf.jobs["ci-ok"].needs[0], "ci");
  assert.equal(wf.jobs["ci-ok"].if, "always()");
});

test("docs-only: only root markdown, docs/, .claude/ and LICENSE skip; crates/ never", () => {
  const { decide, isDoc } = docsOnly;
  assert.equal(decide(["README.md", "docs/a.md", ".claude/loop.md", "LICENSE-MIT"]), true);
  assert.equal(decide(["README.md", "crates/cli/README.md"]), false);
  assert.equal(decide(["CHANGELOG.md", "Cargo.toml"]), false);
  assert.equal(decide([]), false);
  assert.equal(decide(null), false);
  assert.equal(isDoc(".github/workflows/ci.yml"), false);
  assert.equal(isDoc("deny.toml"), false);
});

test("docs-only CLI: unknown base runs everything; a docs commit skips", async () => {
  const repo = await mkdtemp(join(tmpdir(), "hull-docs-only-"));
  const git = (...a) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
  const script = join(BASE, ".github/scripts/docs-only.mjs");
  const run = (base) =>
    execFileSync("node", [script], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, BASE: base },
    });
  git("init", "-q");
  await writeFile(join(repo, "Cargo.toml"), "[workspace]\n");
  git("add", "-A");
  git("commit", "-qm", "a");
  const base = git("rev-parse", "HEAD");
  await writeFile(join(repo, "README.md"), "# x\n");
  git("add", "-A");
  git("commit", "-qm", "b");
  assert.equal(run(base), "skip=true\n");
  assert.equal(run(""), "skip=false\n");
  assert.equal(run("0000000000000000000000000000000000000000"), "skip=false\n");
  assert.equal(run("deadbeef"), "skip=false\n");
  await writeFile(join(repo, "Cargo.toml"), '[workspace]\nresolver = "3"\n');
  git("commit", "-qam", "c");
  assert.equal(run(base), "skip=false\n");
});

test("release-pending: hoist's package rules and tag format", async () => {
  const root = await mkdtemp(join(tmpdir(), "hull-rel-"));
  const put = async (rel, text) => {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), text);
  };
  await put("Cargo.toml", '[workspace]\nresolver = "3"\nmembers = ["crates/*"]\n');
  await put(
    "crates/common/Cargo.toml",
    '[package]\nname = "common"\nversion = "0.0.0"\npublish = false\n',
  );
  await put(
    "crates/cli/Cargo.toml",
    '[package]\nname = "cli"\nversion = "1.2.0" # x\n\n[dependencies]\nversion = "9"\n',
  );
  await put("crates/nover/Cargo.toml", '[package]\nname = "nover"\n');
  await put(
    "crates/empty/Cargo.toml",
    '[package]\nname = "empty"\nversion = "1.0.0"\npublish = []\n',
  );
  const pkgs = pendingMod.packages(root);
  assert.deepEqual(pkgs, [{ name: "cli", version: "1.2.0", tag: "cli@1.2.0" }]);
  await put("hoist.toml", '[github]\nx = 1\n\n[release]\ntag_format = "{name}-v{version}"\n');
  assert.equal(pendingMod.packages(root)[0].tag, "cli-v1.2.0");

  const tags = { "cli@1.2.0": "aaa" };
  const p = [{ name: "cli", version: "1.2.0", tag: "cli@1.2.0" }];
  const sha = (tag) => tags[tag] ?? null;
  assert.deepEqual(pendingMod.pending(p, sha, "bbb"), [], "tag on an earlier commit: released");
  assert.deepEqual(pendingMod.pending(p, sha, "aaa"), p, "tag on HEAD: a re-run");
  assert.deepEqual(
    pendingMod.pending(p, () => null, "aaa"),
    p,
    "no tag: pending",
  );
});

test("release-pending: multi-line arrays, workspace versions, single quotes, exclude", async () => {
  const root = await mkdtemp(join(tmpdir(), "hull-rel2-"));
  const put = async (rel, text) => {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), text);
  };
  await put(
    "Cargo.toml",
    '[workspace]\nmembers = [\n  "crates/*", # globbed\n  "tools/x",\n  "missing",\n]\nexclude = ["crates/skip"]\n\n[workspace.package]\nversion = "2.0.0"\n',
  );
  await put("crates/a/Cargo.toml", "[package]\nname = 'a'\nversion.workspace = true\n");
  await put(
    "crates/b/Cargo.toml",
    '[package]\nname = "b"\nversion = "1.0.0"\npublish = [\n  "crates-io",\n]\n',
  );
  await put("crates/skip/Cargo.toml", '[package]\nname = "skip"\nversion = "1.0.0"\n');
  await put("crates/notacrate/README.md", "# no manifest\n");
  await put("tools/x/Cargo.toml", '[package]\nname = "x"\nversion = "0.1.0"\n');
  assert.deepEqual(pendingMod.memberDirs(root), ["crates/a", "crates/b", "tools/x"]);
  assert.deepEqual(
    pendingMod.packages(root).map((p) => p.tag),
    ["a@2.0.0", "b@1.0.0", "x@0.1.0"],
  );
});

test("release.yml: detect fails on a script error (pipefail); manual runs never publish", async () => {
  const wf = YAML.parse(await readFile(join(BASE, ".github/workflows/release.yml"), "utf8"));
  const detect = wf.jobs.detect.steps.find((s) => s.id === "detect");
  assert.equal(detect.shell, "bash");
  assert.match(detect.run, /set -o pipefail/);
  for (const j of ["publish", "prepare"]) {
    assert.match(wf.jobs[j].if, /github\.event_name == 'push'/, j);
  }
});

test("release.yml: gated by vars.HOIST_RELEASE, hoist pinned, publish in env release with OIDC", async () => {
  const raw = await readFile(join(BASE, ".github/workflows/release.yml"), "utf8");
  const wf = YAML.parse(raw);
  assert.deepEqual(wf.permissions, { contents: "read" });
  assert.match(wf.env.HOIST_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(wf.jobs.publish.environment, "release");
  assert.deepEqual(wf.jobs.publish.permissions, { contents: "write", "id-token": "write" });
  for (const j of ["advisories", "build", "publish"]) {
    assert.match(wf.jobs[j].if, /needs\.detect\.outputs\.enabled == 'true'/, j);
  }
  assert.match(wf.jobs.publish.if, /github\.ref == 'refs\/heads\/main'/);
  assert.match(raw, /vars\.HOIST_RELEASE/);
  assert.doesNotMatch(raw, /NPM_TOKEN|CARGO_REGISTRY_TOKEN/);
  const targets = wf.jobs.build.strategy.matrix.include.map((m) => m.target);
  assert.equal(targets.length, 5);
});

test("agents index (Rust): lists crates with lib/bin targets, deterministic, within budget", async () => {
  const { dir } = await render(["base", "rust-cli:cli"]);
  const a = indexMod.buildIndex(dir);
  assert.equal(indexMod.buildIndex(dir), a);
  assert.match(a, /\|crates\/cli\|cli\|bin\n/);
  assert.match(a, /\|crates\/common\|common\|lib\n/);
  assert.match(a, /\|crates\/cli\/AGENTS\.md\|Rust CLI\n/);
  assert.doesNotMatch(a, /pnpm|turbo/);
  assert.ok(Buffer.byteLength(a) <= indexMod.BUDGET);
});

test("shared with template/: guard.mjs, statusline.sh and rust-cli src/tests are byte-identical", async () => {
  for (const rel of [".claude/hooks/guard.mjs", ".claude/statusline.sh", ".claude/loop.md"]) {
    assert.equal(
      await readFile(join(BASE, rel), "utf8"),
      await readFile(join(HULL, "pieces/base/files", rel), "utf8"),
      rel,
    );
  }
  const ours = join(RUST, "pieces/rust-cli/files");
  const theirs = join(HULL, "pieces/rust-cli/files");
  for (const sub of ["src", "tests"]) {
    const a = (await walk(join(ours, sub))).map((p) => relative(ours, p)).sort();
    const b = (await walk(join(theirs, sub))).map((p) => relative(theirs, p)).sort();
    assert.deepEqual(a, b, sub);
    for (const rel of a) {
      assert.equal(
        await readFile(join(ours, rel), "utf8"),
        await readFile(join(theirs, rel), "utf8"),
        rel,
      );
    }
  }
  const policy = (s) =>
    s
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n");
  assert.equal(
    policy(await readFile(join(BASE, "deny.toml"), "utf8")),
    policy(await readFile(join(theirs, "deny.toml"), "utf8")),
    "deny.toml policy",
  );
});

test("README names the rigging and decisions channel adds (D-004); no bosun paths are taken", async () => {
  const readme = await readFile(join(BASE, "README.md"), "utf8");
  assert.match(readme, /splice channel add gh:keelstackhq\/hull\/\/rigging --piece claude/);
  assert.match(
    readme,
    /splice channel add gh:keelstackhq\/decisions\/\/channel --track main --piece import-project/,
  );
  for (const piece of t.pieces.values()) {
    for (const src of await walk(piece.filesDir)) {
      const rel = relative(piece.filesDir, src);
      assert.doesNotMatch(
        rel,
        /^(governance|\.bosun)\/|^\.github\/workflows\/(risk|verdict|main-open|main-health)\.yml$/,
        rel,
      );
    }
  }
});
