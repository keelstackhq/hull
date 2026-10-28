import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import YAML from "yaml";
import { structuralProblems } from "../scripts/circleci-check.mjs";
import {
  RUST_CIRCLECI_OK_PATH,
  RUST_GITHUB_CI_PATH,
  rustCircleciOk,
  rustGithubCi,
} from "../scripts/gen-ci.mjs";
import { RUST_CI_PLAN, RUST_CI_STEPS } from "../scripts/lib/ci-tasks.mjs";
import { loadCombos } from "../scripts/lib/combos.mjs";
import { renderNew } from "../scripts/render.mjs";

const RUST = fileURLToPath(new URL("../template-rust", import.meta.url));
const PIECE = join(RUST, "pieces/circleci");
const FILES = join(PIECE, "files/.circleci");
const read = (p) => readFile(join(FILES, p), "utf8");
const stepLine = /^ *# step: .*\n/gm;
const ids = (text) => [...text.matchAll(/^ *# step: (\S+)$/gm)].map((m) => m[1]);
const planIds = RUST_CI_PLAN.map((s) => s.id);

const github = await readFile(RUST_GITHUB_CI_PATH, "utf8");
const ciOk = await read("src/jobs/ci-ok.yml");
const rendered = await (async () => {
  const out = join(await mkdtemp(join(tmpdir(), "hull-rust-circleci-")), "out");
  const result = await renderNew({
    template: RUST,
    out,
    pieces: ["base", "circleci", "rust-cli:cli"],
    vars: {},
  });
  return { out, result };
})();

test("RUST_CI_PLAN: step ids in both generated files equal the plan, in order", () => {
  assert.deepEqual(ids(github), planIds);
  assert.deepEqual(ids(ciOk), planIds);
  assert.deepEqual(planIds, [
    "timer",
    "checkout",
    "agents-index",
    "docs-only",
    "rust-toolchain",
    "rust-cache",
    "rust-tools",
    "fmt",
    "clippy",
    "deny",
    "nextest",
    "doc-tests",
    "duration",
  ]);
});

test("gen-ci writes the checked-in template-rust files", () => {
  assert.equal(github, rustGithubCi());
  assert.equal(ciOk, rustCircleciOk());
  assert.ok(RUST_CIRCLECI_OK_PATH.endsWith(".circleci/src/jobs/ci-ok.yml"));
  const r = spawnSync("node", [
    fileURLToPath(new URL("../scripts/gen-ci.mjs", import.meta.url)),
    "--check",
  ]);
  assert.equal(r.status, 0, String(r.stderr));
});

test("template-rust ci.yml without '# step:' lines is byte-identical to the previous file", async () => {
  const before = await readFile(new URL("./fixtures/rust-ci.yml.before", import.meta.url), "utf8");
  assert.equal(github.replace(stepLine, ""), before);
});

test("run commands in both providers equal RUST_CI_STEPS", () => {
  const gh = YAML.parse(github)
    .jobs.ci.steps.map((s) => s.run)
    .filter((r) => r?.startsWith("cargo "));
  assert.deepEqual(gh, [...RUST_CI_STEPS]);
  const cc = YAML.parse(ciOk)
    .steps.map((s) => s.run?.command)
    .filter((c) => c?.startsWith("cargo "));
  assert.deepEqual(cc, [...RUST_CI_STEPS]);
});

test("docs-only early exit is present in both providers", () => {
  assert.match(github, /node \.github\/scripts\/docs-only\.mjs >> "\$GITHUB_OUTPUT"/);
  assert.match(ciOk, /node \.github\/scripts\/docs-only\.mjs > /);
  assert.match(ciOk, /grep -qx "skip=true" .*circleci-agent step halt/);
  assert.match(ciOk, /BASE/);
  assert.match(ciOk, /scm-base\.sh/);
  assert.ok(existsSync(join(rendered.out, ".github/scripts/docs-only.mjs")));
});

test("cache: save only on main, restore skipped on main, no ~/.cargo/bin, keyed on .rust-cache-key", () => {
  const steps = YAML.parse(ciOk).steps;
  const whens = steps.filter((s) => s.when);
  const saves = whens.filter((s) => s.when.steps.some((x) => x.save_cache));
  const restores = whens.filter((s) => s.when.steps.some((x) => x.restore_cache));
  assert.equal(saves.length, 1);
  assert.equal(restores.length, 1);
  assert.deepEqual(saves[0].when.condition, { equal: ["main", "<< pipeline.git.branch >>"] });
  assert.deepEqual(restores[0].when.condition, {
    not: { equal: ["main", "<< pipeline.git.branch >>"] },
  });
  const save = saves[0].when.steps[0].save_cache;
  assert.equal(save.key, 'rust-v2-{{ checksum ".rust-cache-key" }}');
  assert.deepEqual(save.paths, ["~/.cargo/registry", "target"]);
  assert.deepEqual(restores[0].when.steps[0].restore_cache.keys, [save.key]);
  assert.doesNotMatch(ciOk, /\.cargo\/bin"?\]|paths:.*\.cargo\/bin/);
  assert.match(ciOk, /echo skip > \.rust-cache-key/);
  assert.match(ciOk, /Cargo\.lock rust-toolchain\.toml/);
  assert.match(ciOk, /\$HOME\/\.hull-tools/);
  assert.match(ciOk, /echo "[^"]*budget: 75 s typical PR, 30 s docs-only/);
});

test("every downloaded binary is pinned and checked with sha256sum -c ... || exit 1", async () => {
  for (const [name, text] of [
    ["config.yml", await read("config.yml")],
    ["ci-ok.yml", ciOk],
  ]) {
    const lines = text.split("\n");
    const downloads = lines.filter((l) => /\bcurl\b.*-o /.test(l));
    const checks = lines.filter((l) => /sha256sum -c - \|\| exit 1/.test(l));
    assert.ok(downloads.length >= 1, name);
    assert.equal(checks.length, downloads.length, name);
    // each download is checked on the next line, against the file it wrote
    lines.forEach((l, i) => {
      const out = l.match(/\bcurl\b.*-o ("[^"]+"|\S+)/)?.[1];
      if (out) assert.ok(lines[i + 1].includes(`  ${out.replaceAll('"', "")}"`), `${name}: ${out}`);
    });
  }
  assert.equal([...ciOk.matchAll(/\bcurl\b/g)].length, 3); // rustup, nextest, cargo-deny
  assert.match(ciOk, /rustup\/archive\/\d+\.\d+\.\d+\//);
  assert.match(ciOk, /cargo-nextest-0\.9\.148/);
  assert.match(ciOk, /cargo-deny-0\.20\.2/);
  assert.match(
    await read("src/executors/rust.yml"),
    /image: cimg\/node:[\d.]+@sha256:[0-9a-f]{64}/,
  );
  assert.match(await read("config.yml"), /image: cimg\/base:[\d.]+@sha256:[0-9a-f]{64}/);
});

test("workflow: ci-ok on every branch, scheduled pipelines skipped, no filters", async () => {
  const wf = YAML.parse(await read("src/workflows/ci.yml"));
  assert.deepEqual(wf.jobs, ["ci-ok"]);
  assert.deepEqual(wf.when, {
    not: { equal: ["scheduled_pipeline", "<< pipeline.trigger_source >>"] },
  });
  assert.doesNotMatch(await read("src/workflows/ci.yml"), /filters|branches/);
  assert.equal(YAML.parse(ciOk).executor, "rust");
});

test("setup config and scm-base.sh are byte-identical to template's circleci piece", async () => {
  const main = fileURLToPath(
    new URL("../template/pieces/circleci/files/.circleci/", import.meta.url),
  );
  for (const f of ["scripts/scm-base.sh", "config.yml", "src/@config.yml"])
    assert.equal(await read(f), await readFile(join(main, f), "utf8"), f);
  assert.equal(YAML.parse(await read("config.yml")).setup, true);
});

test("piece requires base and owns exactly its paths (no glob)", async () => {
  const t = parseToml(await readFile(join(PIECE, "piece.toml"), "utf8"));
  assert.deepEqual(t.requires, ["base"]);
  assert.ok(t.files.owned.every((p) => !p.includes("*")));
  assert.deepEqual(t.files.owned.toSorted(), [
    ".circleci/config.yml",
    ".circleci/scripts/scm-base.sh",
    ".circleci/src/@config.yml",
    ".circleci/src/executors/rust.yml",
    ".circleci/src/jobs/ci-ok.yml",
    ".circleci/src/workflows/ci.yml",
  ]);
  for (const p of t.files.owned)
    assert.equal(rendered.result.changes.find((c) => c.path === p)?.class, "owned", p);
});

test("rust-circleci combo renders GitHub and CircleCI files and packs well formed", async () => {
  const c = loadCombos().combos.find((x) => x.name === "rust-circleci");
  assert.deepEqual(c, {
    name: "rust-circleci",
    template: "template-rust",
    pieces: ["base", "circleci", "rust-cli:cli"],
    vars: {},
  });
  assert.equal(await readFile(join(rendered.out, ".github/workflows/ci.yml"), "utf8"), github);
  assert.equal(await readFile(join(rendered.out, ".circleci/src/jobs/ci-ok.yml"), "utf8"), ciOk);
  assert.match(await readFile(join(rendered.out, ".gitignore"), "utf8"), /^\.rust-cache-key$/m);
  const packed = [
    "version: 2.1",
    "executors:\n  rust: " + JSON.stringify(YAML.parse(await read("src/executors/rust.yml"))),
    "jobs:\n  ci-ok: " + JSON.stringify(YAML.parse(ciOk)),
    "workflows:\n  ci: " + JSON.stringify(YAML.parse(await read("src/workflows/ci.yml"))),
  ].join("\n");
  assert.deepEqual(structuralProblems(packed), []);
});
