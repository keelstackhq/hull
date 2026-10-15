import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkSingleVite } from "../scripts/check-single-vite.mjs";

const fx = (name) =>
  readFile(fileURLToPath(new URL(`./fixtures/lockfiles/${name}.yaml`, import.meta.url)), "utf8");
const CLI = fileURLToPath(new URL("../scripts/check-single-vite.mjs", import.meta.url));
const doc = (keys) =>
  `lockfileVersion: '9.0'\n\npackages:\n\n${keys.map((k) => `  '${k}':\n    resolution: {integrity: x}\n`).join("\n")}`;

test("single core, no vite → ok", async () =>
  assert.deepEqual(checkSingleVite(await fx("single")), {
    ok: true,
    coreVersions: ["1.1.0"],
    viteEntries: [],
  }));

test("a real vite entry → not ok", async () => {
  const r = checkSingleVite(await fx("duplicate"));
  assert.equal(r.ok, false);
  assert.deepEqual(r.viteEntries, ["vite@8.3.3"]);
});

test("two core versions → not ok", () => {
  const r = checkSingleVite(
    doc(["@voidzero-dev/vite-plus-core@1.1.0", "@voidzero-dev/vite-plus-core@1.2.0"]),
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.coreVersions, ["1.1.0", "1.2.0"]);
});

test("peer-suffixed keys count once", () => {
  const r = checkSingleVite(
    doc([
      "@voidzero-dev/vite-plus-core@1.1.0",
      "@voidzero-dev/vite-plus-core@1.1.0(@types/node@24.0.0)",
      "@voidzero-dev/vite-plus-core@1.1.0(@types/node@25.0.0)(typescript@7.0.2)",
    ]),
  );
  assert.deepEqual(r, { ok: true, coreVersions: ["1.1.0"], viteEntries: [] });
});

test("no core at all → not ok", () => assert.equal(checkSingleVite(doc(["foo@1.0.0"])).ok, false));

test("CLI exits 1 naming offending keys, 0 when clean", async () => {
  const dir = await mkdtemp(join(tmpdir(), "single-vite-"));
  await writeFile(join(dir, "pnpm-lock.yaml"), await fx("duplicate"));
  const bad = spawnSync("node", [CLI, dir], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /vite@8\.3\.3/);
  await writeFile(join(dir, "pnpm-lock.yaml"), await fx("single"));
  assert.match(execFileSync("node", [CLI, dir], { encoding: "utf8" }), /ok/);
});

const CORE_KEY = "@voidzero-dev/vite-plus-core@1.1.0";

test("npm: alias to real vite is a vite entry", () => {
  const r = checkSingleVite(doc([CORE_KEY, "vite@npm:vite@8.3.3"]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.viteEntries, ["vite@npm:vite@8.3.3"]);
});

test("npm: alias to a second core version counts as core", () => {
  const r = checkSingleVite(doc([CORE_KEY, "vite@npm:@voidzero-dev/vite-plus-core@1.2.0"]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.coreVersions, ["1.1.0", "1.2.0"]);
  assert.deepEqual(r.viteEntries, []);
});

test("similarly named packages do not count", () => {
  const r = checkSingleVite(
    doc([
      CORE_KEY,
      "@scope/vite@1.0.0",
      "vite-plus@1.1.0",
      "vite-node@3.0.0",
      "@vitejs/plugin-x@1.0.0",
    ]),
  );
  assert.deepEqual(r, { ok: true, coreVersions: ["1.1.0"], viteEntries: [] });
});

test("CLI exits 2 on missing arg or missing lockfile", async () => {
  const noArg = spawnSync("node", [CLI], { encoding: "utf8" });
  assert.equal(noArg.status, 2);
  assert.match(noArg.stderr, /usage/);
  const dir = await mkdtemp(join(tmpdir(), "single-vite-"));
  const missing = spawnSync("node", [CLI, dir], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /pnpm-lock\.yaml/);
});
