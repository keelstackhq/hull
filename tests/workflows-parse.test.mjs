import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderNew } from "../scripts/render.mjs";
import { CI_PLAN, RUST_CI_PLAN } from "../scripts/lib/ci-tasks.mjs";

// Client feedback 2026-11-18: a workflow with an unquoted ` : ` never parsed and GitHub skipped it
// silently for a day. Generated CI parses every workflow in a fast step before `affected`.
const SCRIPT = fileURLToPath(
  new URL("../template/pieces/base/files/.github/scripts/workflows.mjs", import.meta.url),
);
const { YAML_INTEGRITY, YAML_VERSION, integrity, problems, untar } = await import(SCRIPT);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
// hull's own devDependency, the same version the script pins
const YAML_DIR = join(dirname(createRequire(import.meta.url).resolve("yaml")), "..");
const yaml = await import("yaml");

const repo = (files) => {
  const d = mkdtempSync(join(tmpdir(), "wf-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(d, ".github/workflows"), { recursive: true });
    writeFileSync(join(d, ".github/workflows", name), text);
  }
  return d;
};
const GOOD =
  "on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";

test("an unquoted ` : ` in a workflow is a problem; a valid workflow is not", () => {
  const d = repo({
    "ok.yml": GOOD,
    "bad.yaml": GOOD.replace("- run: echo hi", "- name: Deploy : prod\n        run: echo hi"),
    "dup.yml": GOOD.replace("jobs:", "on: pull_request\njobs:"),
    "notes.md": "not: a: workflow",
  });
  const p = problems(yaml, d);
  assert.equal(p.length, 2, p.join("\n"));
  assert.match(p[0], /^\.github\/workflows\/bad\.yaml: /);
  assert.match(p[1], /^\.github\/workflows\/dup\.yml: .*[Uu]nique/);
  assert.deepEqual(problems(yaml, repo({ "ok.yml": GOOD })), []);
  assert.deepEqual(problems(yaml, mkdtempSync(join(tmpdir(), "wf-none-"))), []);
});

test("the script exits 1 on a bad workflow and names it; 0 when all parse", () => {
  const run = (d) =>
    spawnSync("node", [SCRIPT], {
      cwd: d,
      encoding: "utf8",
      env: { ...process.env, HULL_YAML_DIR: YAML_DIR },
    });
  const bad = run(repo({ "ci.yml": "name: a : b\non: push\n" }));
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stdout + bad.stderr, /\.github\/workflows\/ci\.yml/);
  const ok = run(repo({ "ci.yml": GOOD }));
  assert.equal(ok.status, 0, ok.stderr);
});

test("the pinned yaml tarball integrity equals hull's lockfile entry for that version", () => {
  const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
  const m = new RegExp(
    `^  yaml@${YAML_VERSION.replaceAll(".", "\\.")}:\\n    resolution: \\{integrity: (\\S+)\\}`,
    "m",
  ).exec(lock);
  assert.ok(m, `pnpm-lock.yaml has no yaml@${YAML_VERSION}`);
  assert.equal(YAML_INTEGRITY, m[1]);
  assert.equal(
    integrity(Buffer.from("abc")),
    "sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==",
  );
});

test("untar unpacks a registry-style tarball and never writes outside the target", async () => {
  const src = await mkdtemp(join(tmpdir(), "wf-tar-"));
  mkdirSync(join(src, "package/dist"), { recursive: true });
  writeFileSync(join(src, "package/dist/index.js"), "exports.x = 1;\n");
  writeFileSync(join(src, "package/package.json"), "{}\n");
  const tar = spawnSync("tar", ["-cf", "-", "-C", src, "package"]).stdout;
  const out = await mkdtemp(join(tmpdir(), "wf-out-"));
  untar(tar, out);
  assert.equal(readFileSync(join(out, "package/dist/index.js"), "utf8"), "exports.x = 1;\n");
});

test("CI plans run the workflows step before affected/docs-only, on both providers", () => {
  for (const [name, plan, gate] of [
    ["CI_PLAN", CI_PLAN, "affected"],
    ["RUST_CI_PLAN", RUST_CI_PLAN, "docs-only"],
  ]) {
    const ids = plan.map((s) => s.id);
    const i = ids.indexOf("workflows");
    assert.ok(i > 0 && i < ids.indexOf(gate), `${name}: ${ids.join(",")}`);
    const step = plan[i];
    assert.match(step.github, /run: node \.github\/scripts\/workflows\.mjs\n/);
    assert.doesNotMatch(step.github, /if:/, "never skipped: a workflow-only change is docs-like");
    assert.match(step.circleci, /command: node \.github\/scripts\/workflows\.mjs\n/);
  }
});

for (const t of ["template", "template-rust"]) {
  test(`${t}: base renders workflows.mjs (owned, same bytes) and every rendered workflow parses`, async () => {
    const out = join(await mkdtemp(join(tmpdir(), "wf-render-")), "out");
    const { changes } = await renderNew({
      template: join(ROOT, t),
      out,
      pieces: [],
      vars: {},
    });
    const c = changes.find((x) => x.path === ".github/scripts/workflows.mjs");
    assert.equal(c?.class, "owned");
    assert.equal(readFileSync(join(out, c.path), "utf8"), readFileSync(SCRIPT, "utf8"));
    assert.deepEqual(problems(yaml, out), []);
    assert.match(readFileSync(join(out, ".github/workflows/ci.yml"), "utf8"), /workflows\.mjs/);
  });
}

test("a failed download fails the step; a pax entry in the tarball fails loudly", async () => {
  const d = repo({ "ci.yml": "name: a : b\non: push\n" });
  const { HULL_YAML_DIR: _drop, ...env } = process.env;
  const r = spawnSync("node", [SCRIPT], {
    cwd: d,
    encoding: "utf8",
    env: { ...env, HULL_YAML_URL: "http://127.0.0.1:9/yaml.tgz" },
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /::error::workflows: could not download yaml/);
  const src = await mkdtemp(join(tmpdir(), "wf-pax-"));
  mkdirSync(join(src, "package"), { recursive: true });
  writeFileSync(join(src, "package/x.js"), "1\n");
  const tar = spawnSync("tar", ["--format=pax", "-cf", "-", "-C", src, "package"]).stdout;
  assert.throws(() => untar(tar, src), /unsupported entry type x/);
});
