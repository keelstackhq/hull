import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderCombo } from "./helpers.mjs";

const SCRIPT = fileURLToPath(
  new URL("../template/pieces/base/files/scripts/ready.mjs", import.meta.url),
);
const DOC = fileURLToPath(new URL("../docs/start-checklist.md", import.meta.url));
const {
  BOOTSTRAP_END,
  ITEMS,
  QUESTIONS,
  checklistUrl,
  readAnswers,
  requiredEnvironments,
  runChecks,
  report,
} = await import(SCRIPT);

/** Doc items: `<a id="x"></a>`, then `### N. Title · where · ready: kind · required|optional: q`. */
function docItems(text) {
  const re =
    /^<a id="([a-z-]+)"><\/a>\n\n### \d+\. .+ · (phone|computer) · ready: (auto|manual) · (required|optional: [a-z_]+)$/gm;
  return [...text.matchAll(re)].map((m) => ({ id: m[1], where: m[2], kind: m[3], need: m[4] }));
}

/** Rows of the doc's onboarding table: | `id` | question | `v1`, `v2` | `item`, ... | */
function docQuestions(text) {
  const re = /^\| `([a-z_]+)` +\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm;
  const ticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return [...text.matchAll(re)].map((m) => ({
    id: m[1],
    question: m[2].trim(),
    values: ticks(m[3]),
    items: ticks(m[4]),
  }));
}

test("onboarding questions: doc table = QUESTIONS (ids, text, option values, gated items)", () => {
  assert.deepEqual(
    docQuestions(readFileSync(DOC, "utf8")),
    QUESTIONS.map((q) => ({
      id: q.id,
      question: q.question,
      values: q.options.map((o) => o.value),
      items: q.items,
    })),
  );
});

test("an item is optional exactly when a question can turn it off, and the doc names it", () => {
  const doc = Object.fromEntries(docItems(readFileSync(DOC, "utf8")).map((d) => [d.id, d.need]));
  for (const i of ITEMS) {
    const q = QUESTIONS.find((x) => x.items.includes(i.id) && x.off?.length);
    assert.equal(doc[i.id], q ? `optional: ${q.id}` : "required", i.id);
  }
});

test("questions fit AskUserQuestion: 2-4 options, header <= 12, gated items exist", () => {
  for (const q of QUESTIONS) {
    assert.ok(q.options.length >= 2 && q.options.length <= 4, q.id);
    assert.ok(q.header.length <= 12, q.id);
    assert.ok(q.question.endsWith("?"), q.id);
    for (const o of q.options) assert.ok(o.description.length > 10, `${q.id}.${o.value}`);
    for (const id of q.items)
      assert.ok(
        ITEMS.some((i) => i.id === id),
        `${q.id} -> ${id}`,
      );
  }
});

test("checklist doc and ready.mjs list the same items, in order, with the same kind", () => {
  const doc = docItems(readFileSync(DOC, "utf8"));
  assert.ok(doc.length >= 10, `only ${doc.length} items parsed from the doc`);
  assert.deepEqual(
    doc.map(({ id, kind }) => ({ id, kind })),
    ITEMS.map(({ id, kind }) => ({ id, kind })),
  );
  const anchors = readFileSync(DOC, "utf8").match(/<a id="/g).length;
  assert.equal(anchors, doc.length, "every anchor starts a well-formed item heading");
});

test("D-009 order: computer items come before phone items", () => {
  const where = docItems(readFileSync(DOC, "utf8")).map((d) => d.where);
  assert.deepEqual(
    where,
    [...where].sort((a, b) => (a === b ? 0 : a === "computer" ? -1 : 1)),
  );
});

test("every item has a unique id and a fix step", () => {
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  for (const i of ITEMS) assert.ok(i.fix.length > 10, i.id);
});

const put = async (root, rel, text) => {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), text);
};

test("checklistUrl links to the rendered hull tag, else main", async () => {
  const d = await mkdtemp(join(tmpdir(), "ready-"));
  assert.match(checklistUrl(d), /\/blob\/main\/docs\/start-checklist\.md$/);
  await put(d, ".splice/lock.toml", '[template]\nsource = "x"\nversion = "0.5.0"\n');
  assert.equal(
    checklistUrl(d),
    "https://github.com/keelstackhq/hull/blob/v0.5.0/docs/start-checklist.md",
  );
});

test("requiredEnvironments reads `environment:` from the workflows", async () => {
  const d = await mkdtemp(join(tmpdir(), "ready-"));
  await put(d, ".github/workflows/a.yml", "jobs:\n  x:\n    environment: release\n");
  await put(
    d,
    ".github/workflows/b.yml",
    "jobs:\n  y:\n    environment: splice-bot\n  z:\n    environment: release\n",
  );
  assert.deepEqual(requiredEnvironments(d), ["release", "splice-bot"]);
});

/** Fake command runner: `answers` maps "cmd arg1 arg2" prefixes to stdout (or null = exit 1). */
const fakeRun =
  (answers, errs = {}) =>
  (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    const keys = Object.keys(answers).sort((a, b) => b.length - a.length);
    const key = keys.find((k) => line.startsWith(k));
    const errKey = Object.keys(errs).find((k) => line.startsWith(k));
    if (errKey) return { ok: false, out: "", err: errs[errKey] };
    if (key === undefined || answers[key] === null)
      return { ok: false, out: "", err: `no: ${line}` };
    return { ok: true, out: answers[key], err: "" };
  };

const GOOD_GH = {
  "gh --version": "gh 2",
  "gh auth status": "Logged in",
  "gh repo view": "keelstackhq/demo\n",
  "gh api repos/keelstackhq/demo/actions/permissions": '{"enabled":true}',
  "gh api repos/keelstackhq/demo/rules/branches/main": JSON.stringify([
    {
      type: "required_status_checks",
      parameters: { required_status_checks: [{ context: "ci-ok" }] },
    },
  ]),
  "gh api repos/keelstackhq/demo/rulesets": JSON.stringify([
    { name: "release-tags", target: "tag", enforcement: "active" },
  ]),
  "gh api repos/keelstackhq/demo/environments": JSON.stringify({
    environments: [
      {
        name: "release",
        deployment_branch_policy: { custom_branch_policies: true },
        protection_rules: [{ type: "required_reviewers" }],
      },
      {
        name: "splice-bot",
        deployment_branch_policy: { custom_branch_policies: true },
        protection_rules: [],
      },
    ],
  }),
  "gh api repos/keelstackhq/demo/environments/release/deployment-branch-policies": JSON.stringify({
    branch_policies: [{ name: "*-v*", type: "tag" }],
  }),
  "gh api repos/keelstackhq/demo/environments/splice-bot/deployment-branch-policies":
    JSON.stringify({ branch_policies: [{ name: "main", type: "branch" }] }),
  "gh api repos/keelstackhq/demo/actions/variables/SPLICE_BOT":
    '{"name":"SPLICE_BOT","value":"off"}',
  "pnpm --version": "12.11.2\n",
  "splice --version": "splice 0.3.1",
  "splice check --offline": "ok",
};

const ANSWERS = `# answers
pieces = ["web"]
ci = "github"
update_bot = "app"
approvals = "bootstrap"
apps = ["claude", "renovate", "splice"]
secrets = "none"
bosun = "no"
`;

const LOCK = `[template]
version = "0.5.0"

[[pieces]]
id = "preact-app"
name = "web"

[[pieces]]
id = "hono-worker"
name = "api"
`;

const readyRepo = async () => {
  const d = await mkdtemp(join(tmpdir(), "ready-"));
  await put(d, "package.json", '{"packageManager":"pnpm@12.11.2"}\n');
  await put(d, ".splice/lock.toml", LOCK);
  await put(
    d,
    ".github/workflows/r.yml",
    "    environment: release\n    environment: splice-bot\n",
  );
  await put(d, "docs/superpowers/plans/2026-11-01-first.md", "# Plan\n");
  await put(d, "docs/agents/onboarding.toml", ANSWERS);
  return d;
};

const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r.status]));

test("a ready repo: every item passes or is skipped as chosen, exit 0", async () => {
  const root = await readyRepo();
  const results = runChecks({ root, run: fakeRun(GOOD_GH), node: "24.21.0" });
  const s = byId(results);
  for (const i of ITEMS) {
    assert.equal(s[i.id], ["secrets", "bosun"].includes(i.id) ? "skipped" : "pass", i.id);
  }
  assert.equal(results.find((r) => r.id === "apps").note, "confirmed: claude, renovate, splice");
  assert.equal(results.find((r) => r.id === "bosun").note, "chosen: no");
  const { text, code } = report(results, "https://x/start-checklist.md");
  assert.equal(code, 0);
  assert.match(text, /^skipped +bosun +chosen: no$/m);
  assert.match(text, /^ready: /m);
});

test("no answers: question-gated items are `ask`, exit 1; a manual item keeps its link", async () => {
  const root = await readyRepo();
  await put(root, "docs/agents/onboarding.toml", "# no answers yet\n");
  const results = runChecks({ root, run: fakeRun(GOOD_GH), node: "24.21.0" });
  const s = byId(results);
  for (const id of ["render", "apps", "approvals", "secrets", "bosun", "environments"]) {
    assert.equal(s[id], "ask", id);
  }
  assert.equal(s.repo, "pass");
  const { text, code } = report(results, "https://x/start-checklist.md");
  assert.equal(code, 1);
  assert.match(
    text,
    /^ask +apps .*`apps`.*\n +fix: .*--questions.*\n +see: https:\/\/x\/start-checklist\.md#apps$/m,
  );
});

test("update_bot = session: no splice-bot environment is needed", async () => {
  const root = await readyRepo();
  await put(root, "docs/agents/onboarding.toml", ANSWERS.replace('"app"', '"session"'));
  const gh = {
    ...GOOD_GH,
    "gh api repos/keelstackhq/demo/environments": JSON.stringify({
      environments: [
        JSON.parse(GOOD_GH["gh api repos/keelstackhq/demo/environments"]).environments[0],
      ],
    }),
  };
  assert.equal(byId(runChecks({ root, run: fakeRun(gh), node: "24.0.0" })).environments, "pass");
});

test("enabled optional items must pass: secrets = hoist needs secrets.toml", async () => {
  const root = await readyRepo();
  await put(
    root,
    "docs/agents/onboarding.toml",
    ANSWERS.replace('secrets = "none"', 'secrets = "hoist"'),
  );
  const r = runChecks({ root, run: fakeRun(GOOD_GH), node: "24.0.0" }).find(
    (x) => x.id === "secrets",
  );
  assert.equal(r.status, "fail");
  assert.match(r.note, /secrets\.toml/);
});

test("hand-edited answers: TOML quotes and comments parse; a bad line is `ask`, not a crash", async () => {
  const root = await readyRepo();
  const text = ANSWERS.replace('ci = "github"', "ci = 'github' # chosen in chat").replace(
    'bosun = "no"',
    "bosun = yes please",
  );
  await put(root, "docs/agents/onboarding.toml", text);
  assert.equal(readAnswers(root).ci, "github");
  const results = runChecks({ root, run: fakeRun(GOOD_GH), node: "24.0.0" });
  const bosun = results.find((r) => r.id === "bosun");
  assert.equal(bosun.status, "ask");
  assert.match(bosun.note, /not a valid answer/);
  const r = spawnSync(process.execPath, [SCRIPT, "--questions"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("answers checked against the repo: claude App required; files contradicting `none` fail", async () => {
  const root = await readyRepo();
  await put(root, "docs/agents/onboarding.toml", ANSWERS.replace('"claude", ', ""));
  await put(root, "secrets.toml", "");
  await put(root, ".bosun/bosun.toml", "");
  const s = byId(runChecks({ root, run: fakeRun(GOOD_GH), node: "24.0.0" }));
  assert.equal(s.apps, "fail");
  assert.equal(s.secrets, "fail");
  assert.equal(s.bosun, "fail");
});

test("update_bot = session with bosun = yes still needs splice-bot (bosun uses its token)", async () => {
  const root = await readyRepo();
  const text = ANSWERS.replace('"app"', '"session"').replace('bosun = "no"', 'bosun = "yes"');
  await put(root, "docs/agents/onboarding.toml", text);
  const gh = {
    ...GOOD_GH,
    "gh api repos/keelstackhq/demo/environments": JSON.stringify({
      environments: [
        JSON.parse(GOOD_GH["gh api repos/keelstackhq/demo/environments"]).environments[0],
      ],
    }),
  };
  const r = runChecks({ root, run: fakeRun(gh), node: "24.0.0" }).find(
    (x) => x.id === "environments",
  );
  assert.match(r.note, /splice-bot missing/);
});

test("--answer: an empty multi-select is recorded as []; an unknown id lists the ids", async () => {
  const root = await readyRepo();
  const cli = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: "utf8" });
  assert.equal(cli("--answer", "apps=").status, 0);
  assert.deepEqual(readAnswers(root).apps, []);
  const r = cli("--answer", "colour=red");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown question colour; ids: pieces, ci, /);
});

test("pieces and ci answers must match the lock", async () => {
  const root = await readyRepo();
  await put(root, "docs/agents/onboarding.toml", ANSWERS.replace('["web"]', '["web", "cli"]'));
  let r = runChecks({ root, run: fakeRun(GOOD_GH), node: "24.0.0" }).find((x) => x.id === "render");
  assert.equal(r.status, "fail");
  assert.match(r.note, /rust-cli, npm-cli/);
  await put(root, "docs/agents/onboarding.toml", ANSWERS);
  await put(root, ".splice/lock.toml", `${LOCK}\n[[pieces]]\nid = "circleci"\n`);
  r = runChecks({ root, run: fakeRun(GOOD_GH), node: "24.0.0" }).find((x) => x.id === "render");
  assert.equal(r.status, "fail");
  assert.match(r.note, /ci = github, but the lock has circleci/);
});

test("update_bot = session needs SPLICE_BOT=off; 403 is manual", async () => {
  const root = await readyRepo();
  await put(root, "docs/agents/onboarding.toml", ANSWERS.replace('"app"', '"session"'));
  const VAR = "gh api repos/keelstackhq/demo/actions/variables/SPLICE_BOT";
  const env = (gh, errs) =>
    runChecks({ root, run: fakeRun(gh, errs), node: "24.0.0" }).find(
      (x) => x.id === "environments",
    );
  assert.equal(env(GOOD_GH).status, "pass");
  const on = env({ ...GOOD_GH, [VAR]: '{"name":"SPLICE_BOT","value":"on"}' });
  assert.equal(on.status, "fail");
  assert.match(on.note, /SPLICE_BOT/);
  assert.equal(env(GOOD_GH, { [VAR]: "gh: Not Found (HTTP 404)" }).status, "fail");
  assert.equal(env(GOOD_GH, { [VAR]: "gh: Forbidden (HTTP 403)" }).status, "manual");
});

test("approvals = bootstrap fails after BOOTSTRAP_END; secrets = hoist needs the secrets App", async () => {
  const root = await readyRepo();
  const approvals = (today) =>
    runChecks({ root, run: fakeRun(GOOD_GH), node: "24.0.0", today }).find(
      (x) => x.id === "approvals",
    );
  assert.equal(BOOTSTRAP_END, "2026-11-30");
  assert.equal(approvals("2026-11-30").status, "pass");
  assert.equal(approvals("2026-12-01").status, "fail");
  await put(
    root,
    "docs/agents/onboarding.toml",
    ANSWERS.replace('secrets = "none"', 'secrets = "hoist"'),
  );
  const apps = runChecks({ root, run: fakeRun(GOOD_GH), node: "24.0.0" }).find(
    (x) => x.id === "apps",
  );
  assert.equal(apps.status, "fail");
  assert.match(apps.note, /secrets read/);
});

test("readAnswers parses strings and lists; --answer writes them and --questions shows them", async () => {
  const root = await readyRepo();
  assert.deepEqual(readAnswers(root).pieces, ["web"]);
  assert.equal(readAnswers(root).ci, "github");
  const cli = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: "utf8" });
  let r = cli("--answer", "bosun=yes", "pieces=web,cli");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readAnswers(root).bosun, "yes");
  assert.deepEqual(readAnswers(root).pieces, ["web", "cli"]);
  assert.equal(readAnswers(root).ci, "github", "other answers are kept");
  r = cli("--answer", "bosun=maybe");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /bosun: maybe is not one of yes, no/);
  r = cli("--questions");
  const qs = JSON.parse(r.stdout);
  assert.equal(qs.length, QUESTIONS.length);
  assert.deepEqual(qs.find((q) => q.id === "bosun").answer, "yes");
  assert.equal(qs[0].options[0].recommended, true);
});

test("missing environment, ruleset, plan and old node fail with a fix; exit 1", async () => {
  const root = await readyRepo();
  await put(root, ".github/workflows/p.yml", "    environment: preview\n");
  spawnSync("rm", ["-rf", join(root, "docs/superpowers")]);
  const gh = { ...GOOD_GH, "gh api repos/keelstackhq/demo/rulesets": "[]" };
  const results = runChecks({ root, run: fakeRun(gh), node: "22.1.0" });
  const s = byId(results);
  assert.equal(s.environments, "fail");
  assert.match(results.find((r) => r.id === "environments").note, /preview/);
  assert.equal(s.rulesets, "fail");
  assert.equal(s.plan, "fail");
  assert.equal(s.environment, "fail");
  const { text, code } = report(results, "u");
  assert.equal(code, 1);
  assert.match(text, /^fail +rulesets .*\n +fix: .*\n +see: u#rulesets$/m);
});

test("false passes: release from main only, inactive tag ruleset, repo outside keelstackhq", async () => {
  const root = await readyRepo();
  const gh = {
    ...GOOD_GH,
    "gh api repos/keelstackhq/demo/environments/release/deployment-branch-policies": JSON.stringify(
      { branch_policies: [{ name: "main", type: "branch" }] },
    ),
    "gh api repos/keelstackhq/demo/rulesets": JSON.stringify([
      { name: "release-tags", target: "tag", enforcement: "disabled" },
    ]),
  };
  const results = runChecks({ root, run: fakeRun(gh), node: "24.0.0" });
  const note = (id) => results.find((r) => r.id === id).note;
  assert.match(note("environments"), /release does not deploy from tag \*-v\*/);
  assert.match(note("rulesets"), /no active release-tags/);
  const other = { ...GOOD_GH, "gh repo view": "someone/demo\n" };
  assert.equal(byId(runChecks({ root, run: fakeRun(other), node: "24.0.0" })).repo, "fail");
});

test("an `environment:` line may end in a comment", async () => {
  const d = await mkdtemp(join(tmpdir(), "ready-"));
  await put(d, ".github/workflows/a.yml", "    environment: prod # deploy\n");
  assert.deepEqual(requiredEnvironments(d), ["prod"]);
});

const GH_ITEMS = ["repo", "actions", "rulesets", "environments"];

test("gh on PATH but not logged in: GitHub items are manual, not fail", async () => {
  const root = await readyRepo();
  const run = fakeRun({ ...GOOD_GH, "gh auth status": null });
  const s = byId(runChecks({ root, run, node: "24.0.0" }));
  for (const id of GH_ITEMS) assert.equal(s[id], "manual", id);
});

test("a 401/403 from the API is manual (the owner confirms), not fail", async () => {
  const root = await readyRepo();
  const errs = {
    "gh api repos/keelstackhq/demo/actions": "gh: Resource not accessible (HTTP 403)",
  };
  const results = runChecks({ root, run: fakeRun(GOOD_GH, errs), node: "24.0.0" });
  assert.equal(byId(results).actions, "manual");
  assert.match(results.find((r) => r.id === "actions").note, /HTTP 403/);
  assert.equal(byId(results).rulesets, "pass");
});

test("a failed gh repo view fails repo only; the other GitHub items do not cascade", async () => {
  const root = await readyRepo();
  const s = byId(
    runChecks({ root, run: fakeRun({ ...GOOD_GH, "gh repo view": null }), node: "24.0.0" }),
  );
  assert.equal(s.repo, "fail");
  for (const id of GH_ITEMS.slice(1)) assert.equal(s[id], "manual", id);
});

test("without gh, GitHub items are manual (not a pass); bosun and secrets run when present", async () => {
  const root = await readyRepo();
  await put(root, ".bosun/bosun.toml", "");
  await put(root, "secrets.toml", "");
  const yes = ANSWERS.replace('secrets = "none"', 'secrets = "hoist"').replace('"no"', '"yes"');
  await put(root, "docs/agents/onboarding.toml", yes);
  const run = fakeRun({
    "pnpm --version": "12.0.0",
    "splice --version": "1",
    "splice check --offline": "",
    "hoist --version": "1",
    "hoist secrets check": null,
    "bosun --version": "1",
    "bosun doctor": "",
  });
  const s = byId(runChecks({ root, run, node: "24.0.0" }));
  for (const id of ["repo", "actions", "rulesets", "environments"])
    assert.equal(s[id], "manual", id);
  assert.equal(s.secrets, "fail");
  assert.equal(s.bosun, "pass");
});

test("base renders scripts/ready.mjs and the ready skill (owned); AGENTS.md says run it first", async () => {
  const { dir, result } = await renderCombo(["base"]);
  const cls = Object.fromEntries(result.changes.map((c) => [c.path, c.class]));
  assert.equal(cls["scripts/ready.mjs"], "owned");
  assert.equal(cls[".claude/skills/ready/SKILL.md"], "owned");
  assert.equal(cls["docs/agents/onboarding.toml"], "seed");
  assert.deepEqual(readAnswers(dir), {}, "rendered with no answers");
  const skill = await readFile(join(dir, ".claude/skills/ready/SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: ready\n/);
  assert.match(skill, /node scripts\/ready\.mjs/);
  assert.match(await readFile(join(dir, "AGENTS.md"), "utf8"), /`ready`.*first/);
});

test("ready.mjs runs as a script and exits 1 outside a ready repo", async () => {
  const d = await mkdtemp(join(tmpdir(), "ready-"));
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: d, encoding: "utf8", env: { PATH: "" } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^ask +render /m);
});
