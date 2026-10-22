import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { renderCombo } from "./helpers.mjs";
import { TURBO_ARGS, report } from "../template/pieces/base/files/.github/scripts/preview.mjs";

const PATH = ".github/workflows/preview.yml";

async function load(pieces) {
  const { dir, result } = await renderCombo(pieces);
  const raw = await readFile(join(dir, PATH), "utf8");
  return { dir, result, raw, wf: YAML.parse(raw) };
}

const base = await load(["base"]);
const job = base.wf.jobs.preview;
const steps = job.steps;
const detectIdx = steps.findIndex((s) => /wrangler\.jsonc/.test(s.run ?? ""));
const detect = steps[detectIdx];

test("preview.yml is an owned plain file", () => {
  const c = base.result.changes.find((x) => x.path === PATH);
  assert.equal(c.class, "owned");
});

test("triggers, concurrency, permissions", () => {
  assert.deepEqual(Object.keys(base.wf.on), ["pull_request"]);
  assert.match(base.wf.concurrency.group, /pull_request\.number/);
  assert.equal(base.wf.concurrency["cancel-in-progress"], true);
  assert.deepEqual(base.wf.permissions, { contents: "read" });
});

test("checkout has full history; detect step is right after it", () => {
  const co = steps[0];
  assert.match(co.uses, /^actions\/checkout@/);
  assert.equal(co.with["fetch-depth"], 0);
  assert.equal(co.with.filter, "blob:none");
  assert.equal(detectIdx, 1);
  assert.ok(detect.id);
  assert.match(detect.run, /deploy=(true|false)/);
});

test("every step after detect is guarded by the deploy output", () => {
  for (const s of steps.slice(detectIdx + 1)) {
    assert.match(String(s.if), new RegExp(`steps\\.${detect.id}\\.outputs\\.deploy == 'true'`));
  }
});

test("job env carries Cloudflare secrets, PR number and turbo scm range", () => {
  assert.equal(job.env.CLOUDFLARE_API_TOKEN, "${{ secrets.CLOUDFLARE_API_TOKEN }}");
  assert.equal(job.env.CLOUDFLARE_ACCOUNT_ID, "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
  assert.equal(job.env.PR_NUMBER, "${{ github.event.pull_request.number }}");
  assert.match(job.env.TURBO_SCM_BASE, /pull_request\.base\.sha/);
  assert.match(job.env.TURBO_SCM_HEAD, /github\.sha/);
});

test("deploy step runs preview.mjs, skipped without the token", () => {
  const d = steps.find((s) => /preview\.mjs/.test(s.run ?? ""));
  assert.equal(d.run.trim(), "node .github/scripts/preview.mjs");
  assert.equal(d.shell, "bash");
  assert.match(d.if, /env\.CLOUDFLARE_API_TOKEN != ''/);
  assert.match(d.if, /outputs\.deploy == 'true'/);
});

test("preview.mjs is owned by base and runs only deploy:preview (never production deploy)", () => {
  const c = base.result.changes.find((x) => x.path === ".github/scripts/preview.mjs");
  assert.equal(c.class, "owned");
  assert.deepEqual(TURBO_ARGS, [
    "turbo",
    "run",
    "deploy:preview",
    "--affected",
    "--continue",
    "--log-prefix=task",
  ]);
});

// Shapes of real turbo 2.11 output with --log-prefix=task in GitHub Actions (checked 2026-10-22).
const WEB_OK = [
  "::group::@acme/web:deploy:preview",
  "@acme/web:deploy:preview: Version Preview Alias URL: \x1b[36mhttps://pr-3-web.acme.workers.dev\x1b[0m",
  "::endgroup::",
].join("\n");
const API_MISSING = [
  "\x1b[;31m@acme/api:deploy:preview\x1b[;0m",
  "@acme/api:deploy:preview: \x1b[31m✘ [ERROR]\x1b[0m You cannot upload a new version of a Worker that does not yet exist. Please run the `deploy` command first.",
  "@acme/api:deploy:preview: [ELIFECYCLE] Command failed with exit code 1.",
].join("\n");
const tail = (failed) =>
  ` Tasks:    1 successful, 2 total\nFailed:    ${failed}\n ERROR  run failed: command  exited (1)\n`;

test("report: success lists the preview URLs without ANSI codes", () => {
  const r = report(`${WEB_OK}\n Tasks:    1 successful, 1 total\n`, 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.urls, ["https://pr-3-web.acme.workers.dev"]);
  assert.deepEqual(r.notCreated, []);
  assert.match(r.summary, /^## Preview deployments\n/);
  assert.match(r.summary, /https:\/\/pr-3-web\.acme\.workers\.dev/);
});

test("report: a Worker that was never deployed is skipped with a notice, not a failure", () => {
  const r = report(`${WEB_OK}\n${API_MISSING}\n${tail("@acme/api#deploy:preview")}`, 1);
  assert.equal(r.ok, true);
  assert.deepEqual(r.notCreated, ["@acme/api"]);
  assert.deepEqual(r.urls, ["https://pr-3-web.acme.workers.dev"]);
  assert.match(r.summary, /does not exist yet/);
  assert.match(r.summary, /pnpm turbo run deploy --filter=@acme\/api/);
  assert.equal(r.notices.length, 1);
  assert.match(r.notices[0], /^::notice title=Preview skipped::@acme\/api/);
});

test("report: any other failure still fails the job", () => {
  const build = report(`${API_MISSING}\n${tail("@acme/web#build, @acme/api#deploy:preview")}`, 1);
  assert.equal(build.ok, false);
  const auth = report(
    `@acme/web:deploy:preview: ✘ [ERROR] Authentication error [code: 10000]\n${tail("@acme/web#deploy:preview")}`,
    1,
  );
  assert.equal(auth.ok, false);
  assert.deepEqual(auth.notCreated, []);
  const both = report(
    `${API_MISSING}\n@acme/web:deploy:preview: ✘ [ERROR] boom\n${tail("@acme/api#deploy:preview, @acme/web#deploy:preview")}`,
    1,
  );
  assert.equal(both.ok, false);
});

test("report: a non-zero exit without a Failed line fails", () => {
  assert.equal(report(" ERROR  run failed: no lockfile\n", 1).ok, false);
  assert.equal(report(API_MISSING, 1).ok, false);
});

test("deployable pieces document the one-time first deploy", async () => {
  for (const piece of ["preact-app:web", "astro-site:site", "hono-worker:api"]) {
    const name = piece.split(":")[1];
    const { dir } = await renderCombo(["base", piece]);
    const doc = await readFile(join(dir, `apps/${name}/AGENTS.md`), "utf8");
    assert.match(doc, /pnpm turbo run deploy --filter=@\w+\/\w+/, piece);
  }
});

test("install matches ci.yml rules", () => {
  assert.ok(steps.some((s) => s.uses?.startsWith("pnpm/action-setup@v4")));
  assert.ok(steps.some((s) => s.uses?.startsWith("actions/setup-node@v5")));
  assert.ok(steps.some((s) => s.run === "pnpm install --frozen-lockfile --prefer-offline"));
});

test("turbo passes deploy env through for deploy tasks", async () => {
  const turbo = JSON.parse(await readFile(join(base.dir, "turbo.json"), "utf8"));
  for (const t of ["deploy:preview", "deploy"]) {
    assert.deepEqual(turbo.tasks[t].passThroughEnv, [
      "PR_NUMBER",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
    ]);
  }
});

test("deploy tasks depend on build (a CI checkout has no dist/)", async () => {
  const turbo = JSON.parse(await readFile(join(base.dir, "turbo.json"), "utf8"));
  for (const t of ["deploy:preview", "deploy"])
    assert.deepEqual(turbo.tasks[t].dependsOn, ["build"]);
});

// Expand `apps/*/wrangler.jsonc` against a rendered dir.
async function globWrangler(dir) {
  const out = [];
  for (const e of await readdir(join(dir, "apps")).catch(() => [])) {
    const f = `apps/${e}/wrangler.jsonc`;
    if (
      await access(join(dir, f)).then(
        () => true,
        () => false,
      )
    )
      out.push(f);
  }
  return out;
}

test("base only: detection glob matches nothing", async () => {
  assert.deepEqual(await globWrangler(base.dir), []);
});

for (const piece of ["preact-app:web", "astro-site:site", "hono-worker:api"]) {
  test(`${piece}: present, and detection glob matches its wrangler.jsonc`, async () => {
    const { dir, result, wf } = await load(["base", piece]);
    assert.ok(result.changes.some((c) => c.path === PATH));
    const name = piece.split(":")[1];
    assert.match(wf.jobs.preview.steps[1].run, /apps\/\*\/wrangler\.jsonc/);
    assert.deepEqual(await globWrangler(dir), [`apps/${name}/wrangler.jsonc`]);
  });
}
