import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { loadTemplate } from "../scripts/lib/manifest.mjs";
import { REAL_TEMPLATE, assertInstanceNotes, lineCount, renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const byPath = (result) => Object.fromEntries(result.changes.map((c) => [c.path, c.class]));

test("piece manifest", async () => {
  const piece = (await loadTemplate(REAL_TEMPLATE)).pieces.get("hono-worker");
  assert.ok(piece);
  assert.equal(piece.multiple, true);
  assert.equal(piece.target, "apps/{{ name }}");
  assert.equal(piece.vars.name.default, "api");
  assert.deepEqual(piece.requires, ["base"]);
});

test("renders at apps/<name> with classes", async () => {
  const { result } = await renderCombo(["base", "hono-worker:edge"]);
  const cls = byPath(result);
  assert.equal(cls["apps/edge/package.json"], "shared");
  assert.equal(cls["apps/edge/wrangler.jsonc"], "shared");
  assert.equal(cls["apps/edge/tsconfig.json"], "owned");
  assert.equal(cls["apps/edge/AGENTS.md"], "owned");
  assert.equal(cls["apps/edge/CLAUDE.md"], "seed");
  assert.equal(cls["apps/edge/src/hull/logging.ts"], "owned");
  assert.equal(cls["apps/edge/src/hull/sentry.ts"], "owned");
  assert.equal(cls["apps/edge/src/hull/logging.test.ts"], "owned");
  assert.equal(cls["apps/edge/src/index.ts"], "seed");
  assert.equal(cls["apps/edge/src/index.test.ts"], "seed");
});

test("wrangler.jsonc carries the contract values", async () => {
  const { dir } = await renderCombo(["base", "hono-worker:api"]);
  const text = await read(dir, "apps/api/wrangler.jsonc");
  assert.match(text, /"main": "src\/index\.ts"/);
  assert.match(text, /"compatibility_date": "2026-10-01"/);
  assert.match(text, /"compatibility_flags": \["nodejs_compat"\]/);
  assert.match(text, /"observability": \{[^}]*"enabled": true/);
  assert.match(text, /"LOG_LEVEL": "info"/);
  assert.match(text, /"SENTRY_DSN": ""/);
  assert.match(
    text,
    /verify against https:\/\/developers\.cloudflare\.com\/workers\/observability\/exporting-opentelemetry-data\//,
  );
});

test("scripts, name and catalog deps", async () => {
  const { dir } = await renderCombo(["base", "hono-worker:api"], { scope: "acme" });
  const pkg = JSON.parse(await read(dir, "apps/api/package.json"));
  assert.equal(pkg.name, "@acme/api");
  for (const task of CI_TASKS) assert.ok(pkg.scripts[task], task);
  for (const [k, v] of Object.entries(pkg.scripts)) assert.ok(!/vp run/.test(v), k);
  assert.equal(pkg.scripts.build, "wrangler deploy --dry-run --outdir dist");
  assert.equal(pkg.scripts.typecheck, "tsc --noEmit");
  assert.equal(pkg.scripts.dev, "wrangler dev");
  assert.equal(pkg.scripts.deploy, "wrangler deploy");
  assert.equal(pkg.scripts.test, "vp test run");
  assert.equal(pkg.scripts["deploy:preview"], undefined);
  for (const v of Object.values({ ...pkg.dependencies, ...pkg.devDependencies }))
    assert.equal(v, "catalog:");
  assert.ok(pkg.dependencies.hono);
  assert.ok(pkg.dependencies["@sentry/cloudflare"]);
});

test("logging.ts never reads query, headers or body", async () => {
  const { dir } = await renderCombo(["base", "hono-worker:api"]);
  const text = await read(dir, "apps/api/src/hull/logging.ts");
  assert.match(text, /export function jsonLogger/);
  assert.match(text, /export function onErrorHandler/);
  const code = text.replace(/\/\/.*$/gm, "");
  assert.ok(
    !/req\.(query|queries|header|headers|json|text|parseBody|arrayBuffer|blob|formData|url)\b/.test(
      code,
    ),
  );
  assert.ok(!/\.search\b|new URL/.test(code));
});

test("sentry.ts imports Sentry dynamically only", async () => {
  const { dir } = await renderCombo(["base", "hono-worker:api"]);
  const text = await read(dir, "apps/api/src/hull/sentry.ts");
  assert.match(text, /import\("@sentry\/cloudflare"\)/);
  assert.ok(!/^import (?!type ).*@sentry/m.test(text));
});

test("root AGENTS.md mentions hono-worker; AGENTS + CLAUDE stay ≤ 80 lines", async () => {
  const { dir } = await renderCombo(["base", "hono-worker:api"]);
  const text = await read(dir, "AGENTS.md");
  assert.match(text, /hono-worker/);
  assert.match(text, /`apps\/<name>\/AGENTS\.md`/);
  assert.ok(lineCount(text) + lineCount(await read(dir, "CLAUDE.md")) <= 80);
  assert.ok(!/hono-worker/.test(await read((await renderCombo(["base"])).dir, "AGENTS.md")));
});

test("logging never logs err.message; sentry scrubs events and caches the import", async () => {
  const { dir } = await renderCombo(["base", "hono-worker:api"]);
  const log = await read(dir, "apps/api/src/hull/logging.ts");
  assert.match(log, /msg: err\.name/);
  assert.match(log, /HTTPException/);
  const sentry = await read(dir, "apps/api/src/hull/sentry.ts");
  for (const k of ["query_string", "headers", "cookies", "data"])
    assert.match(sentry, new RegExp(`delete r\\.${k}`));
  assert.match(sentry, /wrapped \?\?= import\("@sentry\/cloudflare"\)/);
  const doc = await read(dir, "apps/api/AGENTS.md");
  assert.match(doc, /about 1\.2 MB/);
});

test("per-instance notes: AGENTS.md owned within 20 lines, CLAUDE.md seed", async () => {
  const { agents } = await assertInstanceNotes(["base", "hono-worker:api"], "apps/api");
  assert.match(agents, /^# /);
});
