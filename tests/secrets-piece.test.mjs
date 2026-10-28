import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import YAML from "yaml";
import { renderString } from "../scripts/lib/render-file.mjs";
import { lineCount, renderCombo } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PIECE = join(ROOT, "template/pieces/secrets/files");
const PIECES = ["base", "preact-app:web", "hono-worker:api", "secrets"];
const VARS = { context_prefix: "hullci" };

const read = (dir, p) => readFileSync(join(dir, p), "utf8");

test("deploy.yml: push to main + workflow_dispatch, environment prod, hoist step with explicit keys", async () => {
  const { dir, result } = await renderCombo(PIECES, VARS);
  const text = read(dir, ".github/workflows/deploy.yml");
  const wf = YAML.parse(text);
  assert.deepEqual(Object.keys(wf.on).sort(), ["push", "workflow_dispatch"]);
  assert.deepEqual(wf.on.push.branches, ["main"]);
  assert.deepEqual(wf.permissions, { contents: "read" });
  assert.deepEqual(wf.concurrency, { group: "deploy-prod", "cancel-in-progress": false });
  assert.equal(wf.jobs.deploy.environment, "prod");
  assert.equal(wf.jobs.gate.environment, undefined);
  assert.match(wf.jobs.gate.if, /github\.ref == 'refs\/heads\/main'/);
  assert.match(wf.jobs.deploy.if, /github\.ref == 'refs\/heads\/main'/);
  assert.equal(wf.jobs.deploy.needs, "gate");
  assert.match(JSON.stringify(wf.jobs.gate), /apps\/\*\/wrangler\.jsonc/);
  const hoist = wf.jobs.deploy.steps.find((s) => /keelstackhq\/hoist\/secrets@/.test(s.uses));
  assert.equal(hoist.with.env, "prod");
  assert.equal(hoist.with.keys, "CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID");
  assert.equal(hoist.with.run, "pnpm turbo run deploy --filter=./apps/*");
  assert.equal(hoist.with["app-id"], "${{ vars.SECRETS_READ_APP_ID }}");
  assert.equal(hoist.with["app-key"], "${{ secrets.SECRETS_READ_APP_KEY }}");
  assert.equal(hoist.with["age-key"], "${{ secrets.SOPS_AGE_KEY }}");
  for (const job of Object.values(wf.jobs))
    for (const s of job.steps ?? []) assert.ok(!(s.run ?? "").includes("${{"), s.run);
  assert.ok(text.endsWith("\n") && !text.endsWith("\n\n"));
  const cls = Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
  assert.equal(cls[".github/workflows/deploy.yml"], "owned");
  assert.equal(cls["docs/agents/secrets.md"], "owned");
  assert.equal(cls["secrets.toml"], "seed");
});

test("deploy.yml renders empty (so is not written) in circleci-only mode", () => {
  const src = readFileSync(join(PIECE, ".github/workflows/deploy.yml.jinja"), "utf8");
  assert.ok(src.startsWith('{% if "circleci-only" in pieces %}'));
  assert.equal(renderString(src, { pieces: ["base", "secrets", "circleci", "circleci-only"] }), "");
  assert.ok(renderString(src, { pieces: ["base", "secrets"] }).startsWith("name: deploy"));
});

test("no deploy.yml without the secrets piece", async () => {
  const { dir } = await renderCombo(["base", "hono-worker:api"]);
  assert.throws(() => read(dir, ".github/workflows/deploy.yml"), /ENOENT/);
});

const SOURCE_NAME = /^[a-z][a-z0-9_-]*$/;
const VAR_NAME = /^[A-Z_][A-Z0-9_]*$/;
const PATH = /^[a-z0-9-]+\/[a-z0-9._-]+\.sops\.yaml$/;

/** Violations of the secrets.toml rules of spec §3.3. */
function checkManifest(toml) {
  const bad = [];
  if (toml.version !== 1) bad.push("version must be 1");
  const sources = toml.sources ?? {};
  for (const [name, s] of Object.entries(sources))
    if (!SOURCE_NAME.test(name) || typeof s.repo !== "string") bad.push(`source ${name}`);
  const check = (env, table) => {
    for (const [k, v] of Object.entries(table)) {
      if (k === "files") {
        check(env, v);
        continue;
      }
      const m = /^([^:]+):([^#]+)#(.+)$/.exec(v);
      if (!VAR_NAME.test(k)) bad.push(`${env}: var name ${k}`);
      else if (!m) bad.push(`${env}.${k}: ${v}`);
      else if (!(m[1] in sources)) bad.push(`${env}.${k}: unknown source ${m[1]}`);
      else if (!PATH.test(m[2]) || !m[2].startsWith(`${env}/`))
        bad.push(`${env}.${k}: path ${m[2]}`);
    }
  };
  for (const [env, table] of Object.entries(toml.env ?? {})) check(env, table);
  return bad;
}

test("the secrets.toml seed follows the manifest rules and the checker catches violations", async () => {
  const { dir } = await renderCombo(PIECES, { scope: "acme", ...VARS });
  const toml = parseToml(read(dir, "secrets.toml"));
  assert.deepEqual(checkManifest(toml), []);
  assert.equal(toml.sources.shared.repo, "acme/secrets-shared");
  for (const env of ["preview", "prod"])
    assert.deepEqual(Object.keys(toml.env[env]), ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
  const bads = [
    { version: 2 },
    { version: 1, env: { prod: { lower: "s:prod/a.sops.yaml#k" } } },
    { version: 1, sources: {}, env: { prod: { A: "s:prod/a.sops.yaml#k" } } },
    {
      version: 1,
      sources: { s: { repo: "o/r" } },
      env: { prod: { A: "s:preview/a.sops.yaml#k" } },
    },
    { version: 1, sources: { s: { repo: "o/r" } }, env: { prod: { A: "s:prod/a.yaml#k" } } },
    { version: 1, sources: { s: { repo: "o/r" } }, env: { prod: { A: "nocolon" } } },
  ];
  for (const b of bads) assert.ok(checkManifest(b).length > 0, JSON.stringify(b));
});

test("docs/agents/secrets.md is short and AGENTS.md / CLAUDE.md keep their budgets", async () => {
  const { dir } = await renderCombo(PIECES, VARS);
  const md = read(dir, "docs/agents/secrets.md");
  assert.ok(lineCount(md) <= 30, `secrets.md has ${lineCount(md)} lines`);
  assert.doesNotMatch(md, /\$\{\{/);
  const agents = read(dir, "AGENTS.md");
  assert.ok(lineCount(agents) <= 60, `AGENTS.md has ${lineCount(agents)} lines`);
  assert.match(agents, /docs\/agents\/secrets\.md/);
  assert.ok(lineCount(read(dir, "CLAUDE.md")) <= 20);
  assert.ok(lineCount(agents) + lineCount(read(dir, "CLAUDE.md")) <= 80);
  const { dir: plain } = await renderCombo(["base"]);
  assert.doesNotMatch(read(plain, "AGENTS.md"), /secrets\.md/);
});

test("context_prefix has no default: rendering without it fails", async () => {
  await assert.rejects(renderCombo(PIECES), /context_prefix is required \(piece secrets\)/);
  await assert.rejects(renderCombo(PIECES, { context_prefix: "Bad_Prefix" }));
});

test("a piece var may be given unqualified when one piece declares it (splice spelling)", async () => {
  const { dir } = await renderCombo(PIECES, { context_prefix: "hullci" });
  assert.ok(read(dir, "secrets.toml"));
  await assert.rejects(
    renderCombo(PIECES, { context_prefix: "hullci", "secrets.context_prefix": "x" }),
  );
});
