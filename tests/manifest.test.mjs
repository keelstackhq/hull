import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TemplateError } from "../scripts/lib/errors.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/template", import.meta.url));

async function mutate(file, fn) {
  const dir = await mkdtemp(join(tmpdir(), "hull-manifest-"));
  await cp(FIXTURE, dir, { recursive: true });
  const path = join(dir, file);
  await writeFile(path, fn(await readFile(path, "utf8")));
  return dir;
}

async function rejectsWith(cls, re, dirPromise) {
  const dir = await dirPromise;
  await assert.rejects(loadTemplate(dir), (e) => {
    assert.ok(e instanceof cls, `expected ${cls.name}, got ${e?.name}: ${e?.message}`);
    assert.match(e.message, re);
    return true;
  });
}

test("loads the fixture template", async () => {
  const t = await loadTemplate(FIXTURE);
  assert.equal(t.format, 1);
  assert.equal(t.base, "base");
  assert.deepEqual([...t.pieces.keys()].sort(), ["app", "base"]);
  assert.equal(t.pieces.get("app").multiple, true);
  assert.equal(t.pieces.get("app").target, "apps/{{ name }}");
  assert.deepEqual(t.pieces.get("base").files, {
    owned: [],
    shared: ["package.json"],
    seed: ["README.md"],
  });
  assert.equal(t.vars.scope.default, "acme");
});

test("rejects unknown format", () =>
  rejectsWith(
    TemplateError,
    /format 2/,
    mutate("splice.toml", (s) => s.replace("format = 1", "format = 2")),
  ));
test("rejects piece id that differs from its directory", () =>
  rejectsWith(
    TemplateError,
    /id "x" .* directory "app"/,
    mutate("pieces/app/piece.toml", (s) => s.replace('id = "app"', 'id = "x"')),
  ));
test("rejects requires naming a missing piece", () =>
  rejectsWith(
    TemplateError,
    /requires "nope"/,
    mutate("pieces/app/piece.toml", (s) => s.replace('["base"]', '["nope"]')),
  ));
test("rejects an unknown key in piece.toml", () =>
  rejectsWith(
    TemplateError,
    /unknown key "mutiple"/,
    mutate("pieces/app/piece.toml", (s) => s.replace("multiple", "mutiple")),
  ));
test("rejects a merge strategy outside json|yaml|toml|text", () =>
  rejectsWith(
    TemplateError,
    /merge strategy "xml"/,
    mutate("pieces/base/piece.toml", (s) => s.replace('"json"', '"xml"')),
  ));
test("rejects an invalid var pattern regex", () =>
  rejectsWith(
    TemplateError,
    /invalid pattern/,
    mutate("splice.toml", (s) => s.replace("^[a-z0-9-]+$", "([")),
  ));
test("rejects base naming a missing piece", () =>
  rejectsWith(
    TemplateError,
    /base "ghost"/,
    mutate("splice.toml", (s) => s.replace('base = "base"', 'base = "ghost"')),
  ));
test("rejects post.when outside new|add|update", () =>
  rejectsWith(
    TemplateError,
    /when "remove"/,
    mutate("pieces/base/piece.toml", (s) => s + '\n[[post]]\nrun = "true"\nwhen = ["remove"]\n'),
  ));

for (const name of [
  "pieces",
  "piece",
  "template",
  "true",
  "None",
  "NOT",
  "and",
  "or",
  "in",
  "is",
]) {
  test(`reserved or invalid var name "${name}" → TemplateError`, () =>
    rejectsWith(
      TemplateError,
      /reserved|identifier/,
      mutate("splice.toml", (s) => `${s}\n[vars.${name}]\nprompt = "x"\ndefault = "y"\n`),
    ));
}
