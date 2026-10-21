// Contract conformance corpus, copied byte-for-byte from keelstackhq/splice
// `tests/fixtures/subset/` (splice renders the same triples with MiniJinja in
// `tests/conformance.rs`). Any difference between the two renderers is a contract bug.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { renderString } from "../scripts/lib/render-file.mjs";

const DIR = new URL("./fixtures/conformance/", import.meta.url);
const CASES = [
  "var",
  "filters",
  "if-elif-else",
  "in-pieces",
  "for-pieces",
  "comment",
  "dotted",
  "trailing-newline",
  "no-trailing-newline",
  "blank-lines-around-blocks",
  "unicode",
  "section-fragment",
  "raw-braces",
  "raw-final-newline",
  "raw-line-edges",
  "raw-tags",
];
const read = (name) => readFileSync(new URL(name, DIR), "utf8");

test("corpus has every case and nothing else", () => {
  const found = readdirSync(DIR)
    .filter((n) => n.endsWith(".jinja"))
    .map((n) => n.slice(0, -".jinja".length))
    .sort();
  assert.deepEqual(found, [...CASES].sort());
});

for (const name of CASES) {
  test(`corpus case ${name} renders exactly`, () => {
    const ctx = JSON.parse(read(`${name}.ctx.json`));
    assert.equal(renderString(read(`${name}.jinja`), ctx), read(`${name}.out`));
  });
}
