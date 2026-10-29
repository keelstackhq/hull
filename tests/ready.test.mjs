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
const { ITEMS, checklistUrl, requiredEnvironments, runChecks, report } = await import(SCRIPT);

/** Checklist items in doc order: `<a id="x"></a>` then a heading ending `· ready: auto|manual`. */
function docItems(text) {
  const re =
    /^<a id="([a-z-]+)"><\/a>\n\n### \d+\. .+ · (phone|computer) · ready: (auto|manual)$/gm;
  return [...text.matchAll(re)].map((m) => ({ id: m[1], where: m[2], kind: m[3] }));
}

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
  "pnpm --version": "12.11.2\n",
  "splice --version": "splice 0.3.1",
  "splice check --offline": "ok",
};

const readyRepo = async () => {
  const d = await mkdtemp(join(tmpdir(), "ready-"));
  await put(d, "package.json", '{"packageManager":"pnpm@12.11.2"}\n');
  await put(d, ".splice/lock.toml", '[template]\nversion = "0.5.0"\n');
  await put(
    d,
    ".github/workflows/r.yml",
    "    environment: release\n    environment: splice-bot\n",
  );
  await put(d, "docs/superpowers/plans/2026-11-01-first.md", "# Plan\n");
  return d;
};

const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r.status]));

test("a ready repo: every auto item passes, manual items stay manual, exit 0", async () => {
  const root = await readyRepo();
  const results = runChecks({ root, run: fakeRun(GOOD_GH), node: "24.21.0" });
  for (const i of ITEMS) {
    assert.equal(byId(results)[i.id], i.kind === "auto" ? "pass" : "manual", i.id);
  }
  const { text, code } = report(results, "https://x/start-checklist.md");
  assert.equal(code, 0);
  assert.match(text, /^manual +apps .*\n +fix: .*\n +see: https:\/\/x\/start-checklist\.md#apps$/m);
  assert.match(text, /confirm every manual item/);
});

test("missing environment, ruleset, plan and old node fail with a fix; exit 1", async () => {
  const root = await readyRepo();
  await put(root, ".github/workflows/p.yml", "    environment: preview\n");
  spawnSync("rm", ["-rf", join(root, "docs")]);
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
  const skill = await readFile(join(dir, ".claude/skills/ready/SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: ready\n/);
  assert.match(skill, /node scripts\/ready\.mjs/);
  assert.match(await readFile(join(dir, "AGENTS.md"), "utf8"), /`ready`.*first/);
});

test("ready.mjs runs as a script and exits 1 outside a ready repo", async () => {
  const d = await mkdtemp(join(tmpdir(), "ready-"));
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: d, encoding: "utf8", env: { PATH: "" } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^fail +render /m);
});
