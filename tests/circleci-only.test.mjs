import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import YAML from "yaml";
import { loadCombos } from "../scripts/lib/combos.mjs";
import { renderCombo } from "./helpers.mjs";

const PIECE = fileURLToPath(new URL("../template/pieces/circleci-only/", import.meta.url));
const SNAPSHOT = JSON.parse(
  await readFile(new URL("./fixtures/github-workflows.sha256.json", import.meta.url), "utf8"),
);
const WEB = ["base", "circleci", "circleci-only", "preact-app:web", "hono-worker:api"];
const VARS = { scope: "x", context_prefix: "x" };
const read = (dir, p) => readFile(join(dir, p), "utf8");
const has = (dir, p) => existsSync(join(dir, p));
const wfs = (dir) => readdirSync(join(dir, ".github/workflows")).sort();
const sha = (text) => createHash("sha256").update(text).digest("hex");

const only = await renderCombo(WEB);
const mirrorText = await read(PIECE, "files/.github/workflows/circleci-status.yml");
const mirror = YAML.parse(mirrorText);
const job = mirror.jobs.mirror;

test("the web-circleci-only combo is registered", () => {
  const c = loadCombos().combos.find((x) => x.name === "web-circleci-only");
  assert.deepEqual(c?.pieces, WEB);
});

test("circleci-only piece requires circleci and owns only the mirror", async () => {
  const t = parseToml(await read(PIECE, "piece.toml"));
  assert.deepEqual(t.requires, ["circleci"]);
  assert.ok(t.description);
  assert.deepEqual(t.files.owned, [".github/workflows/circleci-status.yml"]);
  const cls = only.result.changes.find((c) => c.path === ".github/workflows/circleci-status.yml");
  assert.equal(cls?.class, "owned");
});

test("circleci-only render has no ci.yml or desktop.yml, but release, preview and the mirror", () => {
  assert.deepEqual(wfs(only.dir), [
    "circleci-status.yml",
    "preview-deploy.yml",
    "preview.yml",
    "release.yml",
    "splice.yml",
  ]);
});

test("GitHub-mode renders (web, desktop) are byte-identical to the pre-circleci-only render", async () => {
  const cases = {
    web: ["base", "preact-app:web", "ui-storybook", "hono-worker:api"],
    desktop: ["base", "preact-app:web", "tauri-app:desk"],
  };
  for (const [name, pieces] of Object.entries(cases)) {
    const { dir } = await renderCombo(pieces);
    const got = Object.fromEntries(
      await Promise.all(
        wfs(dir).map(async (f) => [f, sha(await read(dir, `.github/workflows/${f}`))]),
      ),
    );
    assert.deepEqual(got, SNAPSHOT[name], name);
  }
});

test("mirror: trigger is `status` only", () => {
  assert.equal(mirror.on, "status");
});

test("mirror: job-level if filters context, non-pending state and the CircleCI bot", () => {
  const cond = job.if;
  assert.match(cond, /github\.event\.context == 'ci\/circleci: ci-ok'/);
  assert.match(cond, /github\.event\.context == 'ci\/circleci: bosun-ok'/);
  assert.match(cond, /github\.event\.state != 'pending'/);
  assert.match(cond, /github\.event\.sender\.login == 'circleci-app\[bot\]'/);
  assert.match(cond, /github\.event\.sender\.type == 'Bot'/);
});

test("mirror: permissions are exactly statuses: write, timeout at most 2 minutes", () => {
  assert.deepEqual(mirror.permissions, { statuses: "write" });
  assert.equal(job.permissions, undefined);
  assert.ok(job["timeout-minutes"] <= 2);
  assert.equal(Object.keys(mirror.jobs).length, 1);
});

test("mirror: event values reach the shell only through env:", () => {
  for (const step of job.steps) assert.ok(!/\$\{\{/.test(step.run ?? ""), step.run);
  const env = job.steps.find((s) => s.run).env;
  assert.match(env.SHA, /github\.event\.sha/);
  assert.match(env.STATE, /github\.event\.state/);
  assert.match(env.CONTEXT, /github\.event\.context/);
  assert.match(env.GH_TOKEN, /secrets\.GITHUB_TOKEN/);
});

test("mirror: posts the same state and sha under the context without the ci/circleci prefix", () => {
  const run = job.steps.find((s) => s.run).run;
  assert.match(run, /gh api "repos\/\$REPO\/statuses\/\$SHA"/);
  assert.match(run, /-f state="\$STATE"/);
  assert.match(run, /-f context="\$\{CONTEXT#ci\/circleci: \}"/);
  assert.doesNotMatch(mirrorText, /checkout/);
});

test("circleci-only + tauri-app renders the CircleCI desktop job and a scheduled workflow", async () => {
  const { dir } = await renderCombo([...WEB, "tauri-app:desk"]);
  const text = await read(dir, ".circleci/src/jobs/desktop.yml");
  assert.equal(YAML.parse(text).executor, "node");
  assert.doesNotMatch(text, /context|TOKEN|SECRET|restore_cache|save_cache|hoard/);
  assert.match(text, /sha256sum -c - \|\| exit 1/);
  const w = YAML.parse(await read(dir, ".circleci/src/workflows/desktop.yml"));
  assert.deepEqual(w.jobs, ["desktop"]);
  assert.ok(JSON.stringify(w.when).includes("scheduled_pipeline"));
  assert.ok(!wfs(dir).includes("desktop.yml"));
});

test("no CircleCI desktop or deploy jobs without circleci-only (github and both mode)", async () => {
  for (const pieces of [
    ["base", "circleci", "preact-app:web", "tauri-app:desk"],
    ["base", "circleci", "preact-app:web", "hono-worker:api", "secrets"],
    WEB,
    [...WEB, "tauri-app:desk"],
  ]) {
    const { dir } = await renderCombo(pieces, pieces.includes("secrets") ? VARS : {});
    const tauri = pieces.some((p) => p.startsWith("tauri-app"));
    const onlyMode = pieces.includes("circleci-only");
    for (const f of ["jobs/desktop.yml", "workflows/desktop.yml"])
      assert.equal(has(dir, `.circleci/src/${f}`), tauri && onlyMode, `${pieces.join()} ${f}`);
    for (const f of ["jobs/deploy.yml", "workflows/deploy.yml"])
      assert.ok(!has(dir, `.circleci/src/${f}`), `${pieces.join()} ${f}`);
  }
});

test("ci workflow skips scheduled pipelines (the weekly desktop one), not API or push ones", async () => {
  const w = YAML.parse(await read(only.dir, ".circleci/src/workflows/ci.yml"));
  assert.deepEqual(w.when, {
    not: { equal: ["scheduled_pipeline", "<< pipeline.trigger_source >>"] },
  });
  assert.deepEqual(w.jobs, ["ci-ok"]);
});

test("mirror: target_url is passed only when non-empty", () => {
  const run = job.steps.find((s) => s.run).run;
  assert.match(run, /if \[ -n "\$URL" \]/);
  assert.doesNotMatch(run, /-f target_url="\$URL" *\n/);
});

test("tauri-app + circleci-only AGENTS.md mentions the CircleCI scheduled trigger; github mode does not", async () => {
  const { dir } = await renderCombo([...WEB, "tauri-app:desk"]);
  assert.match(await read(dir, "AGENTS.md"), /CircleCI scheduled trigger/);
  const gh = await renderCombo(["base", "preact-app:web", "tauri-app:desk"]);
  assert.doesNotMatch(await read(gh.dir, "AGENTS.md"), /CircleCI/);
});

test("secrets + circleci-only does not write deploy.yml", async () => {
  const { dir } = await renderCombo([...WEB, "secrets"], VARS);
  assert.ok(!wfs(dir).includes("deploy.yml"));
  assert.ok(wfs(dir).includes("circleci-status.yml"));
});
