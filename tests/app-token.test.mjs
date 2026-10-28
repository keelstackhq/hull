import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const SPLICE = ".github/workflows/splice.yml";
const RUST_SPLICE = `template-rust/pieces/base/files/${SPLICE}`;
const RUST_RELEASE = "template-rust/pieces/base/files/.github/workflows/release.yml";
const load = (p) => YAML.parse(readFileSync(path(p), "utf8"));

/** The app-token step must be pinned, var-gated, before every step that uses its output. */
function checkJob(job, idVar, keyName, perms) {
  const steps = job.steps;
  const i = steps.findIndex((s) => s.id === "app");
  assert.ok(i >= 0, "app step");
  const raw = readFileSync(path(job.__file), "utf8");
  assert.match(
    raw,
    /uses: actions\/create-github-app-token@[0-9a-f]{40} # v3\.3\.0/,
    "SHA-pinned with version comment",
  );
  assert.equal(steps[i].if, `vars.${idVar} != ''`);
  assert.equal(steps[i].with["client-id"], `\${{ vars.${idVar} }}`);
  assert.equal(steps[i].with["private-key"], `\${{ secrets.${keyName} }}`);
  // no owner/repositories input: the action then scopes the token to the current repository;
  // permission-* inputs narrow it to what the job needs
  const want = ["client-id", "private-key", ...perms.map((p) => `permission-${p}`)];
  assert.deepEqual(Object.keys(steps[i].with).sort(), want.sort());
  for (const p of perms) assert.equal(steps[i].with[`permission-${p}`], "write", p);
  assert.ok(job.environment, "literal environment on the job holding the key");
  assert.equal(typeof job.environment, "string");
  for (const [k, s] of steps.entries())
    if (JSON.stringify(s).includes("steps.app.outputs")) assert.ok(k > i, "after app step");
}

test("splice.yml: hull's and template-rust's are byte-identical", () => {
  assert.equal(readFileSync(path(SPLICE), "utf8"), readFileSync(path(RUST_SPLICE), "utf8"));
});

test("splice.yml: App token step pinned and gated, token precedence app > PAT > github.token", () => {
  for (const f of [SPLICE, RUST_SPLICE]) {
    const job = load(f).jobs.update;
    job.__file = f;
    checkJob(job, "SPLICE_APP_CLIENT_ID", "SPLICE_APP_KEY", [
      "contents",
      "pull-requests",
      "workflows",
    ]);
    assert.equal(job.environment, "splice-bot");
    const bot = job.steps.find((s) => s.uses?.startsWith("keelstackhq/splice/action"));
    assert.equal(
      bot.with.token,
      "${{ steps.app.outputs.token || secrets.SPLICE_BOT_TOKEN || github.token }}",
    );
  }
});

test("splice.yml: session mode, job skipped when vars.SPLICE_BOT == 'off'", () => {
  for (const f of [SPLICE, RUST_SPLICE])
    assert.equal(load(f).jobs.update.if, "vars.SPLICE_BOT != 'off'");
});

test("release.yml prepare: App token step pinned and gated, precedence app > PAT > github.token", () => {
  const job = load(RUST_RELEASE).jobs.prepare;
  job.__file = RUST_RELEASE;
  checkJob(job, "HOIST_RELEASE_APP_CLIENT_ID", "HOIST_RELEASE_APP_KEY", [
    "contents",
    "pull-requests",
  ]);
  assert.equal(job.environment, "release-pr");
  const want = "${{ steps.app.outputs.token || secrets.HOIST_RELEASE_TOKEN || github.token }}";
  const checkout = job.steps.find((s) => s.uses?.startsWith("actions/checkout"));
  assert.equal(checkout.with.token, want);
  const hoist = job.steps.find((s) => s.run === "hoist release prepare");
  assert.equal(hoist.env.GH_TOKEN, want);
});
