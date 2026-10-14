import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { affectedCombos } from "../scripts/affected-combos.mjs";

const combos = [
  { name: "base", pieces: ["base"] },
  { name: "web", pieces: ["base", "preact-app:web"] },
];

test("piece change selects combos with that piece", () =>
  assert.deepEqual(affectedCombos(["template/pieces/preact-app/files/x"], combos), ["web"]));

test("base change selects all", () =>
  assert.deepEqual(affectedCombos(["template/pieces/base/files/a"], combos), ["base", "web"]));

test("renderer, manifest, workflow and root package changes select all", () => {
  for (const f of [
    "scripts/render.mjs",
    "scripts/lib/plan.mjs",
    "scripts/dogfood.mjs",
    "scripts/combos.json",
    "template/splice.toml",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
  ]) {
    assert.deepEqual(affectedCombos([f], combos), ["base", "web"], f);
  }
});

test("docs and tests select none", () =>
  assert.deepEqual(affectedCombos(["docs/a.md", "tests/x.test.mjs", "README.md"], combos), []));

test("other template/ files select all", () =>
  assert.deepEqual(affectedCombos(["template/README.md"], combos), ["base", "web"]));

const cli = fileURLToPath(new URL("../scripts/affected-combos.mjs", import.meta.url));
const names = JSON.parse(
  readFileSync(new URL("../scripts/combos.json", import.meta.url), "utf8"),
).combos.map((c) => c.name);

test("CLI --all prints every combo", () => {
  const out = execFileSync("node", [cli, "--all"], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), names);
});

test("CLI with an unknown base warns and prints every combo", () => {
  const r = spawnSync("node", [cli, "--base", "deadbeef-not-a-ref"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), names);
  assert.match(r.stderr, /warning/);
});
