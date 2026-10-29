#!/usr/bin/env node
// Checks the project-start checklist (hull docs/start-checklist.md) before autonomous agent work.
// Each item prints pass, fail or manual. Exit 0 only when no item fails; the owner still confirms
// every manual item. Item ids match the checklist anchors (a hull test keeps them in sync).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const item = (id, kind, fix) => ({ id, kind, fix });
export const ITEMS = [
  item("repo", "auto", "Create the repo under keelstackhq; run from a clone of it."),
  item("apps", "manual", "Install the GitHub Apps the checklist lists on this repo."),
  item("environment", "auto", "Install the missing tools in the environment setup script."),
  item("actions", "auto", "Settings → Actions → General: allow GitHub Actions."),
  item("rulesets", "auto", "Require ci-ok on main; add the release-tags tag ruleset."),
  item("environments", "auto", "Create each environment the workflows name, deploying from main."),
  item("secrets", "auto", "Fix secrets.toml or the grants until `hoist secrets check` passes."),
  item("bosun", "auto", "Fix what `bosun doctor` reports."),
  item("render", "auto", "Render with `splice new` and commit; `splice check` must pass."),
  item("plan", "auto", "Add docs/superpowers/plans/*.md or `## Steps` in docs/agents/project.md."),
  item("approvals", "manual", "Confirm with the owner how approvals reach agents (D-012)."),
];

/** The checklist for the hull version this repo was rendered from (main when unknown). */
export function checklistUrl(root) {
  let ref = "main";
  try {
    const lock = readFileSync(join(root, ".splice/lock.toml"), "utf8");
    const v = /^\[template\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(lock);
    if (v) ref = `v${v[1]}`;
  } catch {}
  return `https://github.com/keelstackhq/hull/blob/${ref}/docs/start-checklist.md`;
}

/** Environment names the workflows use, sorted. */
export function requiredEnvironments(root) {
  const dir = join(root, ".github/workflows");
  if (!existsSync(dir)) return [];
  const names = new Set();
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(
      /^\s+environment:\s*([\w.-]+)\s*(#.*)?$/gm,
    )) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

const pass = (note) => ({ status: "pass", note });
const fail = (note) => ({ status: "fail", note });
const manual = (note) => ({ status: "manual", note });

/** Run every item. ctx: { root, run(cmd, args) → { ok, out, err }, node: version string }. */
export function runChecks({ root, run, node }) {
  const has = (cmd) => run(cmd, ["--version"]).ok;
  const file = (rel) => existsSync(join(root, rel));
  const gh = has("gh");
  let repo;
  const api = (path) => {
    const r = run("gh", ["api", `repos/${repo}/${path}`]);
    if (!r.ok) throw new Error(`gh api ${path}: ${(r.err || r.out).trim().split("\n")[0]}`);
    return JSON.parse(r.out);
  };
  const noGh = manual("gh is not available here: the owner confirms this on github.com");

  const checks = {
    repo() {
      if (!gh) return noGh;
      const r = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
      repo = r.ok ? r.out.trim() : undefined;
      if (!repo) return fail("gh repo view failed (no repo, remote or gh auth)");
      return repo.startsWith("keelstackhq/")
        ? pass(repo)
        : fail(`${repo} is not under keelstackhq`);
    },
    apps: () => manual("Claude, Renovate and the bots' Apps are not visible to an agent"),
    environment() {
      const missing = [];
      if (Number(node.split(".")[0]) < 24) missing.push(`node 24 (have ${node})`);
      const want = /pnpm@(\d+)/.exec(
        file("package.json") ? readFileSync(join(root, "package.json"), "utf8") : "",
      );
      const pnpm = run("pnpm", ["--version"]);
      if (!pnpm.ok || (want && pnpm.out.trim().split(".")[0] !== want[1]))
        missing.push(`pnpm ${want?.[1] ?? ""}`.trim());
      const tools = [
        ["splice", true],
        ["cargo", file("Cargo.toml")],
        ["hoist", file("secrets.toml")],
        ["bosun", file(".bosun")],
      ];
      for (const [t, needed] of tools) if (needed && !has(t)) missing.push(t);
      return missing.length ? fail(`missing: ${missing.join(", ")}`) : pass("tools on PATH");
    },
    actions() {
      if (!repo) return gh ? fail("repo unknown") : noGh;
      const p = api("actions/permissions");
      return p.enabled
        ? pass(`enabled (allowed: ${p.allowed_actions})`)
        : fail("Actions are disabled");
    },
    rulesets() {
      if (!repo) return gh ? fail("repo unknown") : noGh;
      const rules = api("rules/branches/main");
      const ciOk = rules.some(
        (r) =>
          r.type === "required_status_checks" &&
          r.parameters.required_status_checks.some((c) => c.context === "ci-ok"),
      );
      const tags = api("rulesets").some(
        (r) => r.name === "release-tags" && r.target === "tag" && r.enforcement === "active",
      );
      const gaps = [
        !ciOk && "main does not require ci-ok",
        !tags && "no active release-tags tag ruleset",
      ].filter(Boolean);
      return gaps.length ? fail(gaps.join("; ")) : pass("ci-ok required on main; release-tags");
    },
    environments() {
      if (!repo) return gh ? fail("repo unknown") : noGh;
      const have = new Map(api("environments").environments.map((e) => [e.name, e]));
      const gaps = [];
      for (const name of requiredEnvironments(root)) {
        const e = have.get(name);
        // release.yml runs on `*-v*` tag pushes; every other environment deploys from main.
        const [type, ref] = name === "release" ? ["tag", "*-v*"] : ["branch", "main"];
        const custom = e?.deployment_branch_policy?.custom_branch_policies;
        const policies = custom
          ? api(`environments/${name}/deployment-branch-policies`).branch_policies
          : [];
        if (!e) gaps.push(`${name} missing`);
        else if (!policies.some((p) => (p.type ?? "branch") === type && p.name === ref)) {
          gaps.push(`${name} does not deploy from ${type} ${ref}`);
        } else if (
          name === "release" &&
          !e.protection_rules.some((p) => p.type === "required_reviewers")
        ) {
          gaps.push("release has no required reviewer");
        }
      }
      return gaps.length
        ? fail(gaps.join("; "))
        : pass(requiredEnvironments(root).join(", ") || "none needed");
    },
    secrets() {
      if (!file("secrets.toml")) return pass("no secrets.toml");
      if (!has("hoist")) return fail("hoist is not on PATH");
      const r = run("hoist", ["secrets", "check"]);
      return r.ok
        ? pass("hoist secrets check")
        : fail((r.err || r.out).trim().split("\n")[0] || "hoist secrets check failed");
    },
    bosun() {
      if (!file(".bosun")) return pass("bosun not adopted");
      if (!has("bosun")) return fail("bosun is not on PATH");
      const r = run("bosun", ["doctor"]);
      return r.ok
        ? pass("bosun doctor")
        : fail((r.err || r.out).trim().split("\n")[0] || "bosun doctor failed");
    },
    render() {
      if (!file(".splice/lock.toml")) return fail("no .splice/lock.toml");
      if (!has("splice")) return fail("splice is not on PATH");
      const r = run("splice", ["check", "--offline"]);
      return r.ok
        ? pass("splice check")
        : fail((r.err || r.out).trim().split("\n")[0] || "splice check failed");
    },
    plan() {
      const md = (rel) => file(rel) && readdirSync(join(root, rel)).some((n) => n.endsWith(".md"));
      const project = file("docs/agents/project.md")
        ? readFileSync(join(root, "docs/agents/project.md"), "utf8")
        : "";
      const steps = /^## Steps\n+[-\d]/m.test(project);
      return md("docs/superpowers/plans") || md("docs/superpowers/specs") || steps
        ? pass("plan found")
        : fail("no plan or brief");
    },
    approvals: () => manual("the owner confirms the approval mode (D-012)"),
  };

  return ITEMS.map((item) => {
    try {
      return { ...item, ...checks[item.id]() };
    } catch (e) {
      return { ...item, ...fail(e.message) };
    }
  });
}

/** Text report and exit code. */
export function report(results, url) {
  const lines = [];
  for (const r of results) {
    lines.push(`${r.status.padEnd(6)} ${r.id.padEnd(12)} ${r.note}`);
    if (r.status !== "pass") lines.push(`       fix: ${r.fix}`, `       see: ${url}#${r.id}`);
  }
  const failed = results.filter((r) => r.status === "fail").length;
  lines.push(
    failed
      ? `not ready: ${failed} item(s) fail. Do not start autonomous work.`
      : "automatable items pass: confirm every manual item with the owner before autonomous work.",
  );
  return { text: `${lines.join("\n")}\n`, code: failed ? 1 : 0 };
}

/** True when this file is the entry script; symlink-safe (Node resolves import.meta.url). */
const isMain = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (isMain()) {
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
  };
  const root = process.cwd();
  const { text, code } = report(
    runChecks({ root, run, node: process.versions.node }),
    checklistUrl(root),
  );
  process.stdout.write(text);
  process.exitCode = code;
}
