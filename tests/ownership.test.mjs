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

test("globMatcher implements contract §9.1 exactly, with dotfiles (no picomatch)", async () => {
  const { globMatcher } = await import("../scripts/lib/ownership.mjs");
  const m = (g, p) => globMatcher([g])(p);
  assert.ok(m("src/**", "src/a/b.ts"));
  assert.ok(m("src/**", "src/.hidden/x"));
  assert.ok(m(".claude/agents/*.md", ".claude/agents/x.md"));
  assert.ok(!m(".claude/agents/*.md", ".claude/agents/sub/x.md"));
  assert.ok(m("*/SKILL.md", "ready/SKILL.md"));
  assert.ok(m("**/x.md", "x.md"));
  assert.ok(m("**/x.md", "a/b/x.md"));
  assert.ok(m("a/**/b", "a/b"));
  assert.ok(m("a/**/b", "a/x/y/b"));
  assert.ok(!m("src/**", "srcx/a"));
  assert.ok(!m("a.b", "aXb"), "regex metacharacters are literal");
  assert.ok(m("package.json", "package.json"));
  assert.ok(globMatcher(["x", "y/*"])("y/z"));
  assert.ok(!globMatcher([])("x"));
});

test("hull has no picomatch dependency (its ReDoS advisory has no patched version)", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal({ ...pkg.dependencies, ...pkg.devDependencies }.picomatch, undefined);
});
