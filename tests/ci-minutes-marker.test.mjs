import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILES = [
  "template/pieces/base/files/.github/workflows/release.yml",
  "template-rust/pieces/base/files/.github/workflows/release.yml",
  "template/pieces/secrets/files/.github/workflows/deploy.yml.jinja",
];

for (const file of FILES) {
  test(`${file}: concurrency has a ci-minutes allow marker right above it`, () => {
    const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
    const i = lines.findIndex((l) => l.startsWith("concurrency:"));
    assert.ok(i > 0, "concurrency: line exists");
    assert.match(lines[i - 1], /^# ci-minutes: allow concurrency \S/);
  });
}
