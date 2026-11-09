import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const FILES = [
  "scripts/lib/ci-tasks.mjs",
  "template/pieces/circleci/files/.circleci/src/jobs/ci-ok.yml",
  "template/pieces/base/files/.github/workflows/ci.yml.jinja",
];

test("every TURBO_VERSION equals the catalog turbo; every TURBO_SHA256 comment names that version", async () => {
  const ws = parseYaml(await read("template/pieces/base/files/pnpm-workspace.yaml"));
  const want = ws.catalog.turbo;
  for (const f of FILES) {
    const text = await read(f);
    const versions = [...text.matchAll(/TURBO_VERSION: (\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    assert.ok(versions.length > 0, f);
    for (const v of versions) assert.equal(v, want, `${f}: TURBO_VERSION`);
    for (const m of text.matchAll(/sha256 of the registry tarball linux-64-(\d+\.\d+\.\d+)\.tgz/g))
      assert.equal(m[1], want, `${f}: TURBO_SHA256 comment names another version`);
    if (/TURBO_SHA256:/.test(text))
      assert.match(text, /sha256 of the registry tarball linux-64-/, `${f}: sha256 comment`);
  }
});
