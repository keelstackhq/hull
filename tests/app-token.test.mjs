import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const SPLICE = ".github/workflows/splice.yml";
const RUST_SPLICE = `template-rust/pieces/base/files/${SPLICE}`;
const TS_SPLICE = `template/pieces/base/files/${SPLICE}`;
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
  const want = readFileSync(path(SPLICE), "utf8");
  assert.equal(readFileSync(path(RUST_SPLICE), "utf8"), want);
});

// The two setup steps template/'s copy adds (splice's [[post]] lockfile hook needs pnpm and node);
// they run before the App step, so they never see the bot token.
const SETUP_STEPS = `      # The update runs template [[post]] hooks on this runner, e.g. \`pnpm install --lockfile-only\`.
      - uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version-file: .node-version
`;
const ANCHOR = "      # Optional GitHub App";

test("splice.yml: template/'s copy differs only by the pnpm and node setup steps", () => {
  const want = readFileSync(path(SPLICE), "utf8");
  const ts = readFileSync(path(TS_SPLICE), "utf8");
  assert.ok(want.includes(ANCHOR));
  assert.equal(ts, want.replace(ANCHOR, SETUP_STEPS + ANCHOR));
  const steps = load(TS_SPLICE).jobs.update.steps;
  const app = steps.findIndex((s) => s.id === "app");
  const setup = steps.filter((s) =>
    /^(pnpm\/action-setup|actions\/setup-node)@/.test(s.uses ?? ""),
  );
  assert.equal(setup.length, 2);
  for (const s of setup) {
    assert.ok(steps.indexOf(s) < app, "before the App step");
    assert.match(s.uses, /@[0-9a-f]{40}$/);
    assert.ok(!("env" in s) && !("token" in (s.with ?? {})), "no env or token input");
    assert.ok(!JSON.stringify(s).includes("secrets."), "no secrets");
  }
  assert.match(ts, /pnpm\/action-setup@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/);
  assert.match(ts, /actions\/setup-node@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/);
  assert.equal(setup[1].with["node-version-file"], ".node-version");
});

test("splice.yml: App token step pinned and gated, token precedence app > PAT > github.token", () => {
  for (const f of [SPLICE, RUST_SPLICE, TS_SPLICE]) {
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
  for (const f of [SPLICE, RUST_SPLICE, TS_SPLICE])
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
  // the checkout leaves the token in .git/config: no install step may run lifecycle scripts
  for (const s of job.steps.filter((x) => /\bnpm install\b/.test(x.run ?? "")))
    assert.match(s.run, /--ignore-scripts/, s.run);
  const raw = readFileSync(path(RUST_RELEASE), "utf8");
  for (const f of [SPLICE, RUST_SPLICE, TS_SPLICE])
    assert.match(
      readFileSync(path(f), "utf8"),
      /uses: keelstackhq\/splice\/action@5d64f250fd1e0fcf27690b425a2f9f8de5fd4ac0 # v0\.3\.0\n/,
      f,
    );
  assert.ok(raw.includes("--ignore-scripts"));
});

test("release.yml publish: App token step pinned and gated, tags pushed with it, id-token kept", () => {
  const job = load(RUST_RELEASE).jobs.publish;
  job.__file = RUST_RELEASE;
  // hoist creates the tags and the GitHub Release: Contents write only
  checkJob(job, "HOIST_RELEASE_APP_CLIENT_ID", "HOIST_RELEASE_APP_KEY", ["contents"]);
  assert.equal(job.environment, "release");
  assert.equal(job.permissions["id-token"], "write");
  const checkout = job.steps.find((s) => s.uses?.startsWith("actions/checkout"));
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with.token, undefined);
  const hoist = job.steps.find((s) => s.run === "hoist release publish --assets dist");
  assert.equal(hoist.env.GH_TOKEN, "${{ steps.app.outputs.token || github.token }}");
});
