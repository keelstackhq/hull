import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

const TEMPLATES = ["template", "template-rust"];
const piece = (t) => fileURLToPath(new URL(`../${t}/pieces/base/`, import.meta.url));

for (const t of TEMPLATES) {
  test(`${t}: scripts/ci-extra.sh is a seed no-op bash script`, async () => {
    const toml = parse(await readFile(`${piece(t)}piece.toml`, "utf8"));
    assert.ok(toml.files.seed.includes("scripts/ci-extra.sh"));
    for (const cls of ["owned", "shared"])
      assert.ok(!(toml.files[cls] ?? []).includes("scripts/ci-extra.sh"));
    const file = `${piece(t)}files/scripts/ci-extra.sh`;
    const text = await readFile(file, "utf8");
    assert.match(text, /^#!\/usr\/bin\/env bash\n/);
    assert.match(text, /^set -euo pipefail$/m);
    assert.match(text, /CI/);
    const r = spawnSync("bash", [file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
  });

  test(`${t}: AGENTS.md.jinja names scripts/ci-extra.sh`, async () => {
    const text = await readFile(`${piece(t)}files/AGENTS.md.jinja`, "utf8");
    assert.match(text, /scripts\/ci-extra\.sh/);
  });
}
