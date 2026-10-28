import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { loadCombos } from "../scripts/lib/combos.mjs";
import { affectedCombos } from "../scripts/affected-combos.mjs";

test("loadCombos returns exactly the combos hull CI renders, sorted by name", () => {
  const { vars, combos } = loadCombos();
  assert.deepEqual(vars, { scope: "hullci" });
  assert.deepEqual(combos, [
    { name: "base", pieces: ["base"] },
    { name: "cli", pieces: ["base", "rust-cli:cli", "npm-cli:cli"] },
    {
      name: "desktop",
      pieces: ["base", "preact-app:web", "tauri-app:desktop"],
      scheduled: true,
    },
    { name: "docs", pieces: ["base", "docs"] },
    { name: "lib", pieces: ["base", "ts-lib:lib"] },
    { name: "rust", template: "template-rust", pieces: ["base", "rust-cli:cli"], vars: {} },
    {
      name: "rust-circleci",
      template: "template-rust",
      pieces: ["base", "circleci", "rust-cli:cli"],
      vars: {},
    },
    {
      name: "rust-circleci-only",
      template: "template-rust",
      pieces: ["base", "circleci", "circleci-only", "rust-cli:cli"],
      vars: {},
    },
    { name: "site", pieces: ["base", "astro-site:site", "rust-tool:tool"] },
    { name: "web", pieces: ["base", "preact-app:web", "ui-storybook", "hono-worker:api"] },
    { name: "web-circleci", pieces: ["base", "circleci", "preact-app:web", "hono-worker:api"] },
    {
      name: "web-circleci-only",
      pieces: ["base", "circleci", "circleci-only", "preact-app:web", "hono-worker:api"],
    },
    {
      name: "web-secrets",
      pieces: ["base", "preact-app:web", "hono-worker:api", "secrets"],
      vars: { scope: "hullci", context_prefix: "hullci" },
    },
  ]);
});

async function fragments(files) {
  const dir = await mkdtemp(join(tmpdir(), "hull-combos-"));
  await writeFile(join(dir, "_vars.json"), "{}");
  for (const [f, body] of Object.entries(files))
    await writeFile(join(dir, f), JSON.stringify(body));
  return { dir, url: pathToFileURL(dir + "/") };
}

test("a file whose name differs from its file name throws", async (t) => {
  const { dir, url } = await fragments({ "a.json": { name: "b", pieces: ["base"] } });
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.throws(() => loadCombos(url), /a\.json.*"b"/);
});

test("two files claiming the same name throw (names stay unique)", async (t) => {
  const { dir, url } = await fragments({
    "a.json": { name: "a", pieces: ["base"] },
    "b.json": { name: "a", pieces: ["base"] },
  });
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.throws(() => loadCombos(url), /b\.json.*"a"/);
});

test("an entry that is not a .json file throws instead of being skipped", async (t) => {
  for (const make of [
    (dir) => writeFile(join(dir, "web.jsonc"), "{}"),
    (dir) => mkdir(join(dir, "x.json")),
  ]) {
    const { dir, url } = await fragments({ "a.json": { name: "a", pieces: ["base"] } });
    t.after(() => rm(dir, { recursive: true, force: true }));
    await make(dir);
    assert.throws(() => loadCombos(url), /not a combo fragment/);
  }
});

test("dotfiles such as .DS_Store are ignored", async (t) => {
  const { dir, url } = await fragments({ "a.json": { name: "a", pieces: ["base"] } });
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, ".DS_Store"), "");
  assert.deepEqual(
    loadCombos(url).combos.map((c) => c.name),
    ["a"],
  );
});

test("any change under scripts/combos/ selects every non-scheduled combo", () => {
  const { combos } = loadCombos();
  const all = combos.filter((c) => !c.scheduled).map((c) => c.name);
  for (const f of [
    "scripts/combos/web.json",
    "scripts/combos/_vars.json",
    "scripts/combos/new.json",
  ])
    assert.deepEqual(affectedCombos([f], combos), all);
});
