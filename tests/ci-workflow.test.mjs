import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
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

test("early exit uses turbo query affected with CI_TASKS and affected.mjs", async () => {
  const s = steps[affectedIdx];
  assert.ok(affectedIdx > steps.indexOf(step("actions/checkout")));
  const ws = YAML.parse(await read(dir, "pnpm-workspace.yaml"));
  assert.equal(String(s.env.TURBO_VERSION), ws.catalog.turbo);
  assert.ok(s.run.includes(`query affected --tasks ${tasks} >`));
  assert.ok(!s.run.includes("--exit-code"));
  assert.match(s.run, /node \.github\/scripts\/affected\.mjs/);
  assert.match(s.run, /skip=false/);
  assert.match(s.run, /::warning::/);
});

test("early exit downloads the turbo binary without npx", () => {
  const s = steps[affectedIdx];
  assert.ok(!s.run.includes("npx"));
  assert.ok(
    s.run.includes("https://registry.npmjs.org/@turbo/linux-64/-/linux-64-$TURBO_VERSION.tgz"),
  );
  assert.match(s.run, /"\$RUNNER_TEMP\/turbo" query affected/);
});

test("every step after the affected check is guarded by skip", () => {
  assert.ok(affectedIdx >= 0);
  for (const s of steps.slice(affectedIdx + 1).filter((x) => x.name !== "Job duration")) {
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
  const last = steps.at(-2);
  assert.equal(last.run, `pnpm turbo run ${tasks} --affected --output-logs=errors-only`);
});

test("rust steps in the plain ci.yml are skipped when rust-affected.mjs is absent", () => {
  const decision = steps.find((s) => s.id === "rust");
  assert.match(decision.if, /hashFiles\('\.github\/scripts\/rust-affected\.mjs'\) != ''/);
  assert.ok(
    !result.changes.some(
      (x) => x.path === ".github/scripts/rust-affected.mjs" && x.action !== "skip",
    ),
  );
});

test("renovate.json extends the hull preset", async () => {
  const r = JSON.parse(await read(dir, "renovate.json"));
  assert.deepEqual(r.extends, ["github>keelstackhq/hull//renovate/default"]);
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

test("renovate preset groups react, cascivo, sentry and preact", async () => {
  const p = JSON.parse(
    await readFile(new URL("../renovate/default.json", import.meta.url), "utf8"),
  );
  const names = (g) => p.packageRules.find((r) => r.groupName === g)?.matchPackageNames;
  assert.deepEqual(names("react"), ["react", "react-dom"]);
  assert.deepEqual(names("cascivo"), ["@cascivo/**"]);
  assert.deepEqual(names("sentry"), ["@sentry/**"]);
  assert.deepEqual(names("preact"), ["preact", "@preact/**"]);
});

test("preset has a custom manager for the workflow turbo pin", async () => {
  const p = JSON.parse(
    await readFile(new URL("../renovate/default.json", import.meta.url), "utf8"),
  );
  const m = p.customManagers.find((x) => x.depNameTemplate === "turbo");
  assert.equal(m.customType, "regex");
  assert.equal(m.datasourceTemplate, "npm");
  assert.deepEqual(m.managerFilePatterns, ["/^\\.github/workflows/.*\\.ya?ml$/"]);
  const line = "          TURBO_VERSION: 2.11.8";
  assert.equal(new RegExp(m.matchStrings[0]).exec(line).groups.currentValue, "2.11.8");
  const rule = p.packageRules.find((r) => r.groupName === "turbo");
  assert.ok(rule.matchPackageNames.includes("turbo"));
});

test("affected.mjs is an owned plain file", () => {
  const c = result.changes.find((x) => x.path === ".github/scripts/affected.mjs");
  assert.equal(c.class, "owned");
});

test("root format:check script and turbo inputs cover the same root files", async () => {
  const pkg = JSON.parse(await read(dir, "package.json"));
  const turbo = JSON.parse(await read(dir, "turbo.json"));
  const args = pkg.scripts["format:check"].replace("vp fmt --check ", "").split(" ");
  const inputs = turbo.tasks["//#format:check"].inputs;
  const norm = (i) => i.replace(/\/\*\*$/, "");
  assert.deepEqual([...args].sort(), inputs.map(norm).sort());
  for (const f of ["CLAUDE.md", "AGENTS.md", ".claude", ".github", "pnpm-workspace.yaml", "docs"]) {
    assert.ok(args.includes(f), f);
  }
  assert.ok(!args.some((a) => /^(apps|packages|crates)/.test(a)));
});

test("affected.mjs triggers are a subset of the root format:check inputs", async () => {
  const { ROOT_TRIGGERS } = await import(join(dir, ".github/scripts/affected.mjs"));
  const turbo = JSON.parse(await read(dir, "turbo.json"));
  const inputs = turbo.tasks["//#format:check"].inputs;
  for (const t of ROOT_TRIGGERS.filter(
    (t) => !["pnpm-lock.yaml", ".node-version", ".npmrc"].includes(t),
  )) {
    assert.ok(inputs.includes(t), t);
  }
});

test("affected.mjs: docs-only skips; package or root config change runs", async () => {
  const repo = await mkdtemp(join(tmpdir(), "hull-affected-"));
  await cp(dir, repo, { recursive: true });
  const git = (...a) =>
    execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", ...a], {
      cwd: repo,
      encoding: "utf8",
    });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  const run = (stdin) =>
    execFileSync("node", [".github/scripts/affected.mjs"], {
      cwd: repo,
      input: JSON.stringify(stdin),
      encoding: "utf8",
      env: { ...process.env, TURBO_SCM_BASE: base, TURBO_SCM_HEAD: "HEAD" },
    }).trim();
  const rootOnly = {
    data: { affectedTasks: { items: [{ package: { name: "//" }, fullName: "//#format:check" }] } },
  };
  const pkgTask = {
    data: { affectedTasks: { items: [{ package: { name: "shared" }, fullName: "shared#test" }] } },
  };
  const none = { data: { affectedTasks: { items: [] } } };
  const commit = async (rel) => {
    await mkdir(join(repo, rel, ".."), { recursive: true });
    await writeFile(join(repo, rel), `// ${Math.random()}\n`);
    git("add", "-A");
    git("commit", "-qm", rel);
  };
  await commit("CLAUDE.md");
  assert.equal(run(rootOnly), "skip=true");
  assert.equal(run(none), "skip=true");
  await commit("packages/shared/src/x.ts");
  assert.equal(run(pkgTask), "skip=false");
  await commit("vite.config.ts");
  assert.equal(run(rootOnly), "skip=false");
  assert.equal(
    execFileSync("node", [".github/scripts/affected.mjs"], {
      cwd: repo,
      input: "not json",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim(),
    "skip=false",
  );
});

test("affected.mjs: ci.yml, scripts, .node-version, .npmrc each force a run", async () => {
  const repo = await mkdtemp(join(tmpdir(), "hull-affected2-"));
  await cp(dir, repo, { recursive: true });
  const git = (...a) =>
    execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", ...a], {
      cwd: repo,
      encoding: "utf8",
    });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  const rootOnly = {
    data: { affectedTasks: { items: [{ package: { name: "//" }, fullName: "//#format:check" }] } },
  };
  for (const rel of [
    ".github/workflows/ci.yml",
    ".github/scripts/affected.mjs",
    ".github/dependabot.yml",
    ".node-version",
    ".npmrc",
  ]) {
    git("reset", "-q", "--hard", base);
    await mkdir(join(repo, rel, ".."), { recursive: true });
    await appendFile(join(repo, rel), `\n// ${Math.random()}\n`);
    git("add", "-A");
    git("commit", "-qm", rel);
    const out = execFileSync("node", [".github/scripts/affected.mjs"], {
      cwd: repo,
      input: JSON.stringify(rootOnly),
      encoding: "utf8",
      env: { ...process.env, TURBO_SCM_BASE: base, TURBO_SCM_HEAD: "HEAD" },
    }).trim();
    assert.equal(out, "skip=false", rel);
  }
});

test("Job duration step: always, non-fatal, budget in summary, no ${{ }}", () => {
  const start = steps[0];
  assert.match(start.run ?? "", /CI_START=\$\(date \+%s\)" >> "\$GITHUB_ENV"/);
  const last = steps.at(-1);
  assert.equal(last.name, "Job duration");
  assert.equal(last.if, "always()");
  assert.equal(last["continue-on-error"], true);
  assert.match(last.run, /\$\{CI_START:-\$\(date \+%s\)\}/);
  assert.match(last.run, /GITHUB_STEP_SUMMARY/);
  assert.match(last.run, /45 s/);
  assert.match(last.run, /15 s/);
  assert.ok(!last.run.includes("${{") && !start.run.includes("${{"));
});

test("index check runs after checkout, before the early-exit step, with no if", () => {
  const label = (s) => s.name ?? s.uses;
  const names = steps.map(label);
  const order = ["actions/checkout@v5", "Agents index current?", "Anything affected?"];
  assert.deepEqual(
    names.filter((n) => order.includes(n)),
    order,
  );
  assert.ok(names.indexOf("Agents index current?") < names.indexOf("actions/setup-node@v5"));
  const s = steps.find((x) => x.name === "Agents index current?");
  assert.equal(s.run, "node scripts/agents-index.mjs --check");
  assert.equal("if" in s, false);
});
