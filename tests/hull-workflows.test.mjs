import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const DIR = fileURLToPath(new URL("../.github/workflows/", import.meta.url));

test("hull's own workflows are valid YAML with jobs", async () => {
  const files = (await readdir(DIR)).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) {
    const doc = YAML.parseDocument(await readFile(DIR + f, "utf8"));
    assert.deepEqual(doc.errors.map(String), [], f);
    assert.ok(doc.toJS().jobs, `${f} has jobs`);
  }
});

const hullCi = async () => YAML.parse(await readFile(DIR + "ci.yml", "utf8")).jobs.ci.steps;
const combosJson = async () => {
  const { loadCombos } = await import("../scripts/lib/combos.mjs");
  return JSON.stringify(loadCombos());
};

test("hull ci.yml Rust condition matches rust-tool and rust-cli combos only", async () => {
  const step = (await hullCi()).find((s) => s.id === "rust");
  const script = step.run.match(/node -e '([^']+)'/)[1];
  const exit = async (list) =>
    spawnSync("node", ["-e", script, JSON.stringify(list), await combosJson()]).status;
  assert.equal(await exit(["cli"]), 0);
  assert.equal(await exit(["site"]), 0);
  assert.equal(await exit(["web"]), 1);
  assert.equal(await exit(["lib"]), 1);
  assert.equal(await exit(["rust"]), 0);
});

test("hull ci.yml installs nextest@0.9.148 and cargo-deny@0.20.2, with rust-cache for the cli and rust combos", async () => {
  const steps = await hullCi();
  const install = steps.find((s) => s.uses?.startsWith("taiki-e/install-action"));
  assert.equal(install.with.tool, "cargo-nextest@0.9.148,cargo-deny@0.20.2");
  const cache = steps.find((s) => s.uses === "Swatinem/rust-cache@v2");
  assert.equal(cache.if, "steps.rust.outputs.needed == 'true'");
  assert.equal(
    cache.with.workspaces,
    "${{ runner.temp }}/combos/cli -> target\n${{ runner.temp }}/combos/rust -> target\n",
  );
});

test("hull ci.yml installs splice SPLICE_VERSION before Test and sets SPLICE_BIN", async () => {
  const { SPLICE_VERSION } = await import("../scripts/lib/splice.mjs");
  const steps = await hullCi();
  const i = steps.findIndex((s) => s.name === "Install splice");
  assert.ok(i >= 0, "Install splice step");
  assert.ok(i < steps.findIndex((s) => s.name === "Test"), "before Test");
  assert.match(
    steps[i].run,
    new RegExp(`@keelstackhq/splice@${SPLICE_VERSION.replaceAll(".", "\\.")}\\b`),
  );
  assert.match(steps[i].run, /SPLICE_BIN=.*>> "\$GITHUB_ENV"/);
});

test("hull splice.yml runs the splice update bot on all sources", async () => {
  const wf = YAML.parse(await readFile(DIR + "splice.yml", "utf8"));
  assert.ok(wf.on.schedule?.length, "scheduled");
  assert.ok("workflow_dispatch" in wf.on);
  assert.deepEqual(wf.permissions, { contents: "write", "pull-requests": "write" });
  const [checkout, bot] = wf.jobs.update.steps;
  assert.match(checkout.uses, /^actions\/checkout@/);
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(bot.uses, "keelstackhq/splice/action@v1");
  assert.equal(bot.with.scope, "all");
  assert.equal(bot.with.token, "${{ secrets.SPLICE_BOT_TOKEN || github.token }}");
});

test("hull ci.yml uses hoard@v0 for the turbo cache before dogfood, without --cache-dir", async () => {
  const steps = await hullCi();
  const i = steps.findIndex((s) => s.uses === "keelstackhq/hoard@v0");
  assert.ok(i >= 0, "uses keelstackhq/hoard@v0");
  assert.equal(steps[i].if, "steps.combos.outputs.args != ''");
  const df = steps.findIndex((s) => s.name === "Dogfood combos");
  assert.ok(i < df, "before dogfood");
  assert.doesNotMatch(steps[df].run, /--cache-dir/);
  assert.ok(!steps.some((s) => s.uses?.startsWith("actions/cache")), "no actions/cache step");
});

test("hull release.yml plans on main pushes and releases behind the release environment", async () => {
  const wf = YAML.parse(await readFile(DIR + "release.yml", "utf8"));
  assert.equal(wf.name, "release");
  assert.deepEqual(wf.on.push.branches, ["main"]);
  assert.ok("workflow_dispatch" in wf.on);
  assert.deepEqual(wf.permissions, {});
  assert.equal(wf.concurrency.group, "release-run-${{ github.run_id }}");
  assert.equal(wf.concurrency["cancel-in-progress"], false);
  const { plan, release } = wf.jobs;
  assert.equal(
    plan.if,
    "github.repository == 'keelstackhq/hull' && github.ref == 'refs/heads/main'",
  );
  const publish = release.steps.find((s) => s.name === "Publish the GitHub release");
  assert.equal(publish.if, "steps.tag.outputs.skip != 'true'");
  assert.deepEqual(plan.permissions, { contents: "read" });
  assert.equal(release.needs, "plan");
  assert.equal(release.if, "needs.plan.outputs.release == 'true'");
  assert.equal(release.environment, "release");
  assert.deepEqual(release.permissions, { contents: "write" });
  assert.equal(release.concurrency.group, "release-tag-${{ needs.plan.outputs.tag }}");
  assert.equal(release.concurrency["cancel-in-progress"], false);
  const writers = Object.entries(wf.jobs).filter(([, j]) => j.permissions?.contents === "write");
  assert.deepEqual(
    writers.map(([k]) => k),
    ["release"],
  );
  const run = release.steps.map((s) => s.run ?? "").join("\n");
  assert.match(run, /--verify-tag/);
  assert.match(run, /--notes-start-tag/);
  assert.match(run, /git push origin "refs\/tags\/\$TAG"/);
  for (const job of [plan, release]) {
    // Credentials stay in the checkout: ls-remote and the tag push need them on a private repo.
    const co = job.steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    assert.equal(co.with.ref, "${{ github.sha }}");
  }
});
