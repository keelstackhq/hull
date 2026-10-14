import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { CI_TASKS } from "../scripts/lib/ci-tasks.mjs";
import { renderCombo } from "./helpers.mjs";

const read = (dir, rel) => readFile(join(dir, rel), "utf8");
const { dir, result } = await renderCombo(["base"]);
const raw = await read(dir, ".github/workflows/ci.yml");
const wf = YAML.parse(raw);
const steps = wf.jobs.ci.steps;
const step = (uses) => steps.find((s) => s.uses?.startsWith(uses));
const affectedIdx = steps.findIndex((s) => s.id === "affected");
const tasks = CI_TASKS.join(" ");

test("workflow is an owned plain file", () => {
  const c = result.changes.find((x) => x.path === ".github/workflows/ci.yml");
  assert.equal(c.class, "owned");
  assert.ok(!result.changes.some((x) => x.path.endsWith(".jinja")));
});

test("triggers and no path filters", () => {
  assert.deepEqual(Object.keys(wf.on).sort(), ["merge_group", "pull_request", "push"]);
  assert.ok(!JSON.stringify(wf.on).includes("paths"));
  assert.equal(wf.permissions.contents, "read");
});

test("concurrency cancels PR runs only", () => {
  assert.match(wf.concurrency.group, /pull_request\.number/);
  assert.match(String(wf.concurrency["cancel-in-progress"]), /pull_request/);
});

test("exactly jobs ci and ci-ok; ci-ok needs ci and runs always", () => {
  assert.deepEqual(Object.keys(wf.jobs), ["ci", "ci-ok"]);
  const ok = wf.jobs["ci-ok"];
  assert.deepEqual([].concat(ok.needs), ["ci"]);
  assert.equal(ok.if, "always()");
  const text = JSON.stringify(ok.steps);
  assert.match(text, /needs\.ci\.result/);
  assert.equal(wf.jobs.ci["timeout-minutes"], 15);
  assert.equal(wf.jobs.ci["runs-on"], "ubuntu-latest");
});

test("job env sets TURBO_SCM_BASE and TURBO_SCM_HEAD", () => {
  assert.match(wf.jobs.ci.env.TURBO_SCM_BASE, /merge_group\.base_sha/);
  assert.match(wf.jobs.ci.env.TURBO_SCM_BASE, /event\.before/);
  assert.ok(wf.jobs.ci.env.TURBO_SCM_HEAD);
});

test("checkout has full blobless history", () => {
  const s = step("actions/checkout");
  assert.equal(s.with["fetch-depth"], 0);
  assert.equal(s.with.filter, "blob:none");
});

test("early exit uses turbo query affected --exit-code with CI_TASKS", async () => {
  const s = steps[affectedIdx];
  assert.ok(affectedIdx > steps.indexOf(step("actions/checkout")));
  const ws = YAML.parse(await read(dir, "pnpm-workspace.yaml"));
  assert.ok(
    s.run.includes(`turbo@${ws.catalog.turbo} query affected --tasks ${tasks} --exit-code`),
  );
  assert.match(s.run, /skip=true/);
  assert.match(s.run, /skip=false/);
  assert.match(s.run, /::warning::/);
});

test("every step after the affected check is guarded by skip", () => {
  assert.ok(affectedIdx >= 0);
  for (const s of steps.slice(affectedIdx + 1)) {
    assert.match(s.if, /steps\.affected\.outputs\.skip != 'true'/, s.name ?? s.run);
  }
});

test("install is frozen and prefer-offline; setup-node caches pnpm", () => {
  assert.ok(steps.some((s) => s.run === "pnpm install --frozen-lockfile --prefer-offline"));
  const n = step("actions/setup-node");
  assert.equal(n.with["node-version-file"], ".node-version");
  assert.equal(n.with.cache, "pnpm");
  assert.ok(step("pnpm/action-setup"));
});

test("turbo cache restores by prefix", () => {
  const c = step("actions/cache");
  assert.equal(c.with.path, ".turbo/cache");
  assert.match(c.with.key, /^turbo-\$\{\{ runner\.os \}\}-\$\{\{ github\.sha \}\}$/);
  assert.match(c.with["restore-keys"], /turbo-\$\{\{ runner\.os \}\}-/);
});

test("turbo run uses CI_TASKS and --affected", () => {
  const last = steps.at(-1);
  assert.equal(last.run, `pnpm turbo run ${tasks} --affected --output-logs=errors-only`);
});

test("no rust steps without rust-tool", () => {
  assert.ok(!/rust|cargo/i.test(raw));
});

test("renovate.json extends the hull preset", async () => {
  const r = JSON.parse(await read(dir, "renovate.json"));
  assert.deepEqual(r.extends, ["github>keelstack/hull//renovate/default"]);
});

test("renovate preset groups vite-plus with vite-plus-core", async () => {
  const p = JSON.parse(
    await readFile(new URL("../renovate/default.json", import.meta.url), "utf8"),
  );
  assert.ok(p.extends.includes("config:recommended"));
  assert.ok(p.extends.includes("helpers:pinGitHubActionDigests"));
  assert.equal(p.rangeStrategy, "pin");
  assert.equal(p.minimumReleaseAge, "3 days");
  const rule = p.packageRules.find((r) => r.groupName === "vite-plus");
  assert.ok(rule.matchPackageNames.includes("vite-plus"));
  assert.ok(rule.matchPackageNames.includes("@voidzero-dev/vite-plus-core"));
  for (const g of ["storybook", "astro", "tauri", "cloudflare", "turbo"]) {
    assert.ok(
      p.packageRules.some((r) => r.groupName === g),
      g,
    );
  }
  assert.equal(p.platformAutomerge, true);
  assert.deepEqual(p.lockFileMaintenance.schedule, ["before 5am on monday"]);
});

test("preset has a custom manager for the workflow turbo pin", async () => {
  const p = JSON.parse(
    await readFile(new URL("../renovate/default.json", import.meta.url), "utf8"),
  );
  const m = p.customManagers.find((x) => x.depNameTemplate === "turbo");
  assert.equal(m.customType, "regex");
  assert.equal(m.datasourceTemplate, "npm");
  assert.deepEqual(m.managerFilePatterns, ["/^\\.github/workflows/.*\\.ya?ml$/"]);
  const line = "npx -y turbo@2.11.8 query affected";
  assert.equal(new RegExp(m.matchStrings[0]).exec(line).groups.currentValue, "2.11.8");
  const rule = p.packageRules.find((r) => r.groupName === "turbo");
  assert.ok(rule.matchPackageNames.includes("turbo"));
});
