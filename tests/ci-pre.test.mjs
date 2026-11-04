import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { CI_PLAN, RUST_CI_PLAN } from "../scripts/lib/ci-tasks.mjs";

const TEMPLATES = ["template", "template-rust"];
const piece = (t) => fileURLToPath(new URL(`../${t}/pieces/base/`, import.meta.url));
const HOOK = "bash scripts/ci-pre.sh";
const GUARD = "[ -f scripts/ci-pre.sh ]";

for (const t of TEMPLATES) {
  test(`${t}: scripts/ci-pre.sh is a seed no-op bash script`, async () => {
    const toml = parse(await readFile(`${piece(t)}piece.toml`, "utf8"));
    assert.ok(toml.files.seed.includes("scripts/ci-pre.sh"));
    for (const cls of ["owned", "shared"])
      assert.ok(!(toml.files[cls] ?? []).includes("scripts/ci-pre.sh"));
    const file = `${piece(t)}files/scripts/ci-pre.sh`;
    const text = await readFile(file, "utf8");
    assert.match(text, /^#!\/usr\/bin\/env bash\n/);
    assert.match(text, /^set -euo pipefail$/m);
    const r = spawnSync("bash", [file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
  });
}

test("ci-pre runs after the affected check and before any install or build, guarded, on both providers", () => {
  for (const [plan, gate] of [
    [CI_PLAN, "affected"],
    [RUST_CI_PLAN, "docs-only"],
  ]) {
    const ids = plan.map((s) => s.id);
    assert.equal(ids.indexOf("ci-pre"), ids.indexOf(gate) + 1);
    assert.ok(ids.indexOf("ci-pre") < ids.indexOf("rust-toolchain"));
    const step = plan.find((s) => s.id === "ci-pre");
    for (const body of [step.github, step.circleci]) {
      assert.ok(body.includes(HOOK) && body.includes(GUARD), body);
    }
  }
  assert.ok(
    CI_PLAN.map((s) => s.id).indexOf("ci-pre") < CI_PLAN.findIndex((s) => s.id === "install"),
  );
});

test("template-rust root Cargo.toml trims dev debug info to line tables", async () => {
  const toml = parse(await readFile(`${piece("template-rust")}files/Cargo.toml`, "utf8"));
  assert.equal(toml.profile.dev.debug, "line-tables-only");
});
