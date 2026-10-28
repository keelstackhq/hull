import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import picomatch from "picomatch";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { outputPath, overlaps } from "../scripts/lib/ownership.mjs";
import { checkSubset } from "../scripts/lib/subset.mjs";
import { assertSameBranches, elifBranches } from "./invariants.mjs";
import { REAL_TEMPLATE, renderCombo } from "./helpers.mjs";

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function pieceFiles(piece) {
  const rels = (await walk(piece.filesDir)).map((p) => relative(piece.filesDir, p));
  return rels.map((rel) => ({ rel, src: join(piece.filesDir, rel), path: outputPath(rel) }));
}

const t = await loadTemplate(REAL_TEMPLATE);
const jinjaFiles = [];
for (const piece of t.pieces.values()) {
  for (const f of await pieceFiles(piece)) {
    if (f.rel.endsWith(".jinja")) jinjaFiles.push(f.src);
  }
}

test("template loads", () => {
  assert.equal(t.name, "hull");
  assert.equal(t.minSplice, "0.3.0");
  assert.equal(t.base, "base");
  assert.ok(t.pieces.has("base"));
});

test("every files/ path is in at most one class", async () => {
  for (const piece of t.pieces.values()) {
    for (const f of await pieceFiles(piece)) {
      const classes = overlaps(f.path, piece.files);
      assert.ok(classes.length <= 1, `${piece.id}: ${f.path} is in ${classes.join(" and ")}`);
    }
  }
});

test("every [merge] key names a shared file", async () => {
  for (const piece of t.pieces.values()) {
    const paths = (await pieceFiles(piece)).map((f) => f.path);
    const shared = paths.filter((p) => overlaps(p, piece.files).includes("shared"));
    for (const key of Object.keys(piece.merge)) {
      const isMatch = picomatch(key, { dot: true });
      assert.ok(
        shared.some((p) => isMatch(p)),
        `${piece.id}: [merge] "${key}" matches no shared file`,
      );
    }
  }
});

test("every .jinja passes the subset (contract §4 + §9)", async () => {
  for (const src of jinjaFiles) {
    const v = checkSubset(await readFile(src, "utf8"), src);
    assert.deepEqual(v, [], `${src}: ${JSON.stringify(v)}`);
  }
});

test("no .jinja tag contains not/and/or/-%}", async () => {
  for (const src of jinjaFiles) {
    const text = await readFile(src, "utf8");
    for (const m of text.matchAll(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g)) {
      const tag = m[0];
      assert.doesNotMatch(tag, /(^|[\s(])(not|and|or)([\s)]|$)/, `${src}: ${tag}`);
      assert.doesNotMatch(tag, /^\{[{%]-|-[%}]\}$/, `${src}: ${tag}`);
    }
  }
});

test("no {{ in paths under files/", async () => {
  for (const piece of t.pieces.values()) {
    for (const f of await pieceFiles(piece)) {
      assert.ok(!f.rel.includes("{{"), `${piece.id}: ${f.rel}`);
    }
  }
});

test("every multiple piece has target containing {{ name }} and a name var with the name pattern", () => {
  for (const piece of t.pieces.values()) {
    if (!piece.multiple) continue;
    assert.ok(piece.target?.includes("{{ name }}"), `${piece.id}: target ${piece.target}`);
    assert.equal(piece.vars.name?.pattern, "^[a-z][a-z0-9-]*$", `${piece.id}: name pattern`);
  }
});

test("every elif chain marked {# same-branches #} has identical branches", () => {
  for (const src of jinjaFiles) assertSameBranches(src);
});

test("elifBranches returns the branch bodies of a marked chain", () => {
  const src = "{# same-branches #}{% if a %}X{% elif b %}X{% else %}Y{% endif %}";
  assert.deepEqual(elifBranches(src), ["X", "X", "Y"]);
  assert.deepEqual(elifBranches("{% if a %}X{% endif %}"), []);
});

test("elifBranches handles nested ifs", () => {
  const src = "{# same-branches #}{% if a %}{% if c %}1{% endif %}{% elif b %}2{% endif %}";
  assert.deepEqual(elifBranches(src), ["{% if c %}1{% endif %}", "2"]);
});

test("assertSameBranches throws on differing branches", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "hull-inv-"));
  const bad = join(dir, "bad.jinja");
  await writeFile(bad, "{# same-branches #}{% if a %}X{% elif b %}Z{% endif %}");
  assert.throws(() => assertSameBranches(bad), /differ/);
});

test("renderCombo(base) renders the README as seed", async () => {
  const { result } = await renderCombo(["base"]);
  const readme = result.changes.find((c) => c.path === "README.md");
  assert.equal(readme?.class, "seed");
});

test("elifBranches throws when the marker is not followed by an if", () => {
  assert.throws(
    () => elifBranches("{# same-branches #}text{% if a %}X{% elif b %}X{% endif %}"),
    /marker/,
  );
});

test("elifBranches ignores comments inside the chain", () => {
  const src = "{# same-branches #}{% if a %}{# {% if z %} #}X{% elif b %}X{% endif %}";
  assert.deepEqual(elifBranches(src), ["{# {% if z %} #}X", "X"]);
});

test("elifBranches throws on an unclosed chain", () => {
  assert.throws(() => elifBranches("{# same-branches #}{% if a %}X{% elif b %}X"), /unclosed/);
});

test("elifBranches requires at least two branches", () => {
  assert.throws(() => elifBranches("{# same-branches #}{% if a %}X{% endif %}"), /at least 2/);
});

test("nested markers are checked too", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "hull-inv-"));
  const bad = join(dir, "nested.jinja");
  await writeFile(
    bad,
    "{# same-branches #}{% if a %}{# same-branches #}{% if c %}1{% elif d %}2{% endif %}{% elif b %}{# same-branches #}{% if c %}1{% elif d %}2{% endif %}{% endif %}",
  );
  assert.throws(() => assertSameBranches(bad), /differs/);
});

test("elifBranches accepts newline and indent before the if", () => {
  const src = "{# same-branches #}\n  {% if a %}X{% else %}X{% endif %}";
  assert.deepEqual(elifBranches(src), ["X", "X"]);
});

test("an else branch must equal the others", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "hull-inv-"));
  const bad = join(dir, "else.jinja");
  await writeFile(bad, "{# same-branches #}{% if a %}X{% else %}Y{% endif %}");
  assert.throws(() => assertSameBranches(bad), /differs/);
});
