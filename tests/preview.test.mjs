import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { renderCombo } from "./helpers.mjs";

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

test("deploy step runs deploy:preview --affected, skipped without the token", () => {
  const d = steps.find((s) => /deploy:preview/.test(s.run ?? ""));
  assert.match(d.run, /turbo run deploy:preview --affected/);
  assert.equal(d.shell, "bash");
  assert.match(d.run, /tee /);
  assert.match(d.run, /workers\\\.dev/);
  assert.match(d.run, /x1b/);
  assert.match(d.run, /GITHUB_STEP_SUMMARY/);
  assert.match(d.if, /env\.CLOUDFLARE_API_TOKEN != ''/);
  assert.match(d.if, /outputs\.deploy == 'true'/);
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
