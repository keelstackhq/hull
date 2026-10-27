import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GITHUB_CI_PATH, githubCi } from "../scripts/gen-ci.mjs";
import { CI_PLAN } from "../scripts/lib/ci-tasks.mjs";

const genCi = fileURLToPath(new URL("../scripts/gen-ci.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/ci.yml.before", import.meta.url));
const stepLine = /^ *# step: .*\n/gm;

test("gen-ci --check passes on the checked-in ci.yml", () => {
  const r = spawnSync("node", [genCi, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("generated ci.yml without '# step:' lines is byte-identical to the previous file", async () => {
  const before = await readFile(fixture, "utf8");
  assert.equal(githubCi().replace(stepLine, ""), before);
  assert.equal((await readFile(GITHUB_CI_PATH, "utf8")).replace(stepLine, ""), before);
});

test("step ids in ci.yml equal CI_PLAN ids in order", async () => {
  const yml = await readFile(GITHUB_CI_PATH, "utf8");
  const ids = [...yml.matchAll(/^ *# step: (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(
    ids,
    CI_PLAN.map((s) => s.id),
  );
  assert.deepEqual(ids, [
    "timer",
    "checkout",
    "agents-index",
    "affected",
    "setup-pnpm-node",
    "install",
    "turbo-cache",
    "rust-affected",
    "rust-toolchain",
    "rust-cache",
    "rust-tools",
    "run-affected",
    "duration",
  ]);
});
