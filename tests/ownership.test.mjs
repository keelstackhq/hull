import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, mergeStrategy, outputPath, overlaps } from "../scripts/lib/ownership.mjs";

const none = { owned: [], shared: [], seed: [] };

test("outputPath strips .jinja", () =>
  assert.equal(outputPath("a/package.json.jinja"), "a/package.json"));
test("classify order and default", () => {
  const f = { owned: ["vite.config.ts"], shared: ["package.json"], seed: ["src/**"] };
  assert.equal(classify("src/a/b.ts", f), "seed");
  assert.equal(classify("package.json", f), "shared");
  assert.equal(classify("other.txt", f), "owned");
});
test("* stays in one segment, ** crosses (contract §9.1)", () => {
  assert.equal(classify("src/a.ts", { ...none, seed: ["src/*"] }), "seed");
  assert.equal(classify("src/a/b.ts", { ...none, seed: ["src/*"] }), "owned");
  assert.equal(classify("src/a/b.ts", { ...none, seed: ["src/**"] }), "seed");
});
test("globs match the path without .jinja", () =>
  assert.equal(
    classify(outputPath("package.json.jinja"), { ...none, shared: ["package.json"] }),
    "shared",
  ));
test("dotfiles match", () =>
  assert.equal(classify(".github/ci.yml", { ...none, seed: ["**"] }), "seed"));
test("owned wins over seed when both match", () =>
  assert.equal(
    classify("src/x.ts", { owned: ["src/x.ts"], shared: [], seed: ["src/**"] }),
    "owned",
  ));
test("overlaps lists both classes", () =>
  assert.deepEqual(overlaps("src/x.ts", { owned: ["src/x.ts"], shared: [], seed: ["src/**"] }), [
    "owned",
    "seed",
  ]));
test("mergeStrategy matches globs, defaults to text", () => {
  const m = { "package.json": "json", "**/*.yaml": "yaml" };
  assert.equal(mergeStrategy("package.json", m), "json");
  assert.equal(mergeStrategy("a/b/c.yaml", m), "yaml");
  assert.equal(mergeStrategy("x.txt", m), "text");
});
