import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("../template/pieces/circleci/files/.circleci/scripts/scm-base.sh", import.meta.url),
);

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

// main: c1 - c2 ; feature branches off c1
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "hull-scm-base-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "commit", "-q", "--allow-empty", "-m", "c1");
  const c1 = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "-b", "feature");
  git(dir, "commit", "-q", "--allow-empty", "-m", "f1");
  git(dir, "checkout", "-q", "main");
  git(dir, "commit", "-q", "--allow-empty", "-m", "c2");
  git(dir, "update-ref", "refs/remotes/origin/main", "main");
  git(dir, "checkout", "-q", "feature");
  return { dir, c1, c2: git(dir, "rev-parse", "main") };
}

const scmBase = (cwd, branch, ...args) =>
  execFileSync("sh", [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CIRCLE_BRANCH: branch },
  }).trim();

test("merge queue branch prints the sha after pr-<n>-", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const { dir } = repo();
  assert.equal(scmBase(dir, `gh-readonly-queue/main/pr-12-${sha}`, "ignored"), sha);
});

test("default branch prints the pipeline base revision argument", () => {
  const { dir } = repo();
  assert.equal(scmBase(dir, "main", "abc123"), "abc123");
  assert.throws(() => scmBase(dir, "main", "abc$(id)"));
});

test("default branch without a base revision compares with the parent commit", () => {
  const { dir, c1 } = repo();
  git(dir, "checkout", "-q", "main");
  assert.equal(scmBase(dir, "main"), c1);
  assert.equal(scmBase(dir, "main", ""), c1);
});

test("a merge queue branch whose suffix is not a 40-hex sha fails without echoing it", () => {
  const { dir } = repo();
  for (const suffix of ["", "deadbeef", "$(id)", "0123456789ABCDEF0123456789abcdef01234567"]) {
    let err;
    try {
      scmBase(dir, `gh-readonly-queue/main/pr-12-${suffix}`);
    } catch (e) {
      err = e;
    }
    assert.ok(err, `accepted suffix ${JSON.stringify(suffix)}`);
    if (suffix) assert.ok(!String(err.stderr).includes(suffix));
  }
});

test("odd feature branch names never reach git arguments", () => {
  const { dir, c1 } = repo();
  for (const branch of ["-x", "a b", "--upload-pack=x"]) assert.equal(scmBase(dir, branch), c1);
});

test("feature branch without origin/main fails", () => {
  const { dir } = repo();
  git(dir, "update-ref", "-d", "refs/remotes/origin/main");
  assert.throws(() => scmBase(dir, "feature"));
});

test("feature branch prints git merge-base with origin/main", () => {
  const { dir, c1 } = repo();
  assert.equal(scmBase(dir, "feature", "ignored"), c1);
});
