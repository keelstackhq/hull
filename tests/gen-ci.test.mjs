import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GITHUB_CI_PATH, circleciOk, githubCi } from "../scripts/gen-ci.mjs";
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

test("gen-ci --check run through a symlinked checkout still reports drift", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "hull-gen-ci-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const real = join(tmp, "real");
  await cp(fileURLToPath(new URL("../scripts/", import.meta.url)), join(real, "scripts"), {
    recursive: true,
  });
  const yml = join(real, "template/pieces/base/files/.github/workflows/ci.yml");
  await mkdir(dirname(yml), { recursive: true });
  await writeFile(yml, `${githubCi()}# drift\n`);
  await symlink(real, join(tmp, "link"), "dir");
  const r = spawnSync(process.execPath, [join(tmp, "link/scripts/gen-ci.mjs"), "--check"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /out of date/);
});

test("gen-ci --check also reports a drifted .circleci ci-ok.yml", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "hull-gen-ci-ok-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  await cp(fileURLToPath(new URL("../scripts/", import.meta.url)), join(tmp, "scripts"), {
    recursive: true,
  });
  const ok = join(tmp, "template/pieces/circleci/files/.circleci/src/jobs/ci-ok.yml");
  const gh = join(tmp, "template/pieces/base/files/.github/workflows/ci.yml");
  for (const f of [ok, gh]) await mkdir(dirname(f), { recursive: true });
  await writeFile(gh, githubCi());
  await writeFile(ok, `${circleciOk()}# drift\n`);
  const r = spawnSync(process.execPath, [join(tmp, "scripts/gen-ci.mjs"), "--check"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /ci-ok\.yml is out of date/);
});
