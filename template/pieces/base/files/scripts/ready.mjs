#!/usr/bin/env node
// Checks the project-start checklist (hull docs/start-checklist.md) before autonomous agent work.
// Each item prints pass, fail, manual, ask (an onboarding answer is missing) or skipped (turned
// off by an answer). Exit 0 only when nothing fails or asks; the owner confirms manual items.
// Item and question ids match the checklist (a hull test keeps them in sync).
//   node scripts/ready.mjs                    check
//   node scripts/ready.mjs --questions        the onboarding questions as JSON, with answers
//   node scripts/ready.mjs --answer id=v[,v]  record answers in docs/agents/onboarding.toml
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const item = (id, kind, fix) => ({ id, kind, fix });
export const ITEMS = [
  item("repo", "auto", "Create the repo under keelstackhq; run from a clone of it."),
  item("apps", "auto", "Install the GitHub Apps the checklist lists on this repo."),
  item("environment", "auto", "Install the missing tools in the environment setup script."),
  item("actions", "auto", "Settings → Actions → General: allow GitHub Actions."),
  item("rulesets", "auto", "Require ci-ok on main; add the release-tags tag ruleset."),
  item("environments", "auto", "Create each environment the workflows name, deploying from main."),
  item("secrets", "auto", "Fix secrets.toml or the grants until `hoist secrets check` passes."),
  item("bosun", "auto", "Fix what `bosun doctor` reports."),
  item("render", "auto", "Render with `splice new` and commit; `splice check` must pass."),
  item("plan", "auto", "Add docs/superpowers/plans/*.md or `## Steps` in docs/agents/project.md."),
  item("approvals", "auto", "Confirm with the owner how approvals reach agents (D-012)."),
];

const opt = (value, label, description) => ({ value, label, description });
/** Asked by the `ready` skill. The first option is the recommended default; `off` skips `items`. */
export const QUESTIONS = [
  {
    id: "pieces",
    header: "Pieces",
    multi: true,
    items: ["render"],
    question: "What will this repo hold?",
    options: [
      opt("web", "Web app", "preact-app with a hono-worker API, deployed to Cloudflare"),
      opt("site", "Static site", "astro-site with Preact islands"),
      opt("lib", "Library", "ts-lib: a publishable ESM package"),
      opt("cli", "CLI", "rust-cli with an npm-cli launcher"),
    ],
  },
  {
    id: "ci",
    header: "CI",
    items: ["render"],
    question: "Which CI provider runs ci-ok?",
    options: [
      opt("github", "GitHub Actions", "Default: one job plus ci-ok on every PR (D-011)"),
      opt("circleci", "CircleCI only", "circleci-only piece; ci-ok is mirrored to GitHub"),
      opt("both", "Both", "circleci piece next to the GitHub ci.yml"),
    ],
  },
  {
    id: "update_bot",
    header: "Update bot",
    items: ["environments"],
    question: "Who opens the weekly splice update PRs?",
    options: [
      opt("app", "GitHub App", "An App token in environment splice-bot; CI runs on its PRs"),
      opt("pat", "Token", "SPLICE_BOT_TOKEN in environment splice-bot (bosun uses this)"),
      opt("session", "Agent session", "SPLICE_BOT=off: agents run splice update; no splice-bot"),
    ],
  },
  {
    id: "approvals",
    header: "Approvals",
    items: ["approvals"],
    question: "How are gated PRs approved?",
    options: [
      opt("bootstrap", "Bootstrap mode", "D-012 until 2026-11-30: orchestrator, after CI + review"),
      opt("owner", "Owner approves", "The owner approves every gated PR in a Claude Code form"),
    ],
  },
  {
    id: "apps",
    header: "Apps",
    multi: true,
    items: ["apps"],
    question: "Which GitHub Apps are installed on the repo?",
    options: [
      opt("claude", "Claude", "Required: agents push branches and open PRs"),
      opt("renovate", "Renovate", "Dependency PRs from the hull Renovate preset"),
      opt("splice", "Update bot App", "Needed when the update bot is a GitHub App"),
      opt("secrets", "Secrets read", "Repo added to the SECRETS_READ_APP_* org settings"),
    ],
  },
  {
    id: "secrets",
    header: "Secrets",
    items: ["secrets"],
    off: ["none"],
    present: "secrets.toml",
    question: "Does the repo need secrets, such as deploy tokens?",
    options: [
      opt("hoist", "Yes, via hoist", "D-010: sops+age bundles; needs the secrets piece"),
      opt("none", "No", "Nothing to deploy yet; the secrets step is skipped"),
    ],
  },
  {
    id: "bosun",
    header: "bosun",
    items: ["bosun"],
    off: ["no"],
    present: ".bosun",
    question: "Adopt bosun governance now?",
    options: [
      opt("yes", "Yes", "bosun init: gates and signed approvals (D-012)"),
      opt("no", "Not yet", "The bosun step is skipped; add it later with bosun init"),
    ],
  },
];

/** Pieces each `pieces` answer renders; the lock must list them. */
const PIECES = {
  web: ["preact-app", "hono-worker"],
  site: ["astro-site"],
  lib: ["ts-lib"],
  cli: ["rust-cli", "npm-cli"],
};
/** Last day of D-012 bootstrap mode (UTC, inclusive). */
export const BOOTSTRAP_END = "2026-11-30";
const ANSWERS = "docs/agents/onboarding.toml";
const HEADER = `# Onboarding answers for scripts/ready.mjs; the \`ready\` skill asks the questions.
# Seed (splice never overwrites it). Change one: node scripts/ready.mjs --answer id=value
`;

/** Answers by question id: a string, or a list for multi-select questions. */
export function readAnswers(root) {
  if (!existsSync(join(root, ANSWERS))) return {};
  const text = readFileSync(join(root, ANSWERS), "utf8");
  /** TOML strings and lists of strings; a line that does not parse keeps its raw text (invalid). */
  const parse = (raw) => {
    try {
      return JSON.parse(raw.replace(/\s+#.*$/, "").replace(/'([^']*)'/g, '"$1"'));
    } catch {
      return raw;
    }
  };
  return Object.fromEntries(
    [...text.matchAll(/^([a-z_]+)\s*=\s*(.+?)\s*$/gm)].map((m) => [m[1], parse(m[2])]),
  );
}

function writeAnswers(root, answers) {
  const value = (v) =>
    Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(v);
  const lines = QUESTIONS.filter((q) => q.id in answers).map(
    (q) => `${q.id} = ${value(answers[q.id])}`,
  );
  writeFileSync(join(root, ANSWERS), `${HEADER}${lines.map((l) => `${l}\n`).join("")}`);
}

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
const ASK_FIX = "Run the `ready` skill: it asks via `node scripts/ready.mjs --questions`.";

/** Run every item. ctx: { root, run(cmd, args) → { ok, out, err }, node: version string }. */
export function runChecks({ root, run, node, today = new Date().toISOString().slice(0, 10) }) {
  const has = (cmd) => run(cmd, ["--version"]).ok;
  const file = (rel) => existsSync(join(root, rel));
  // gh missing or logged out (the Claude Code web default), or a 401/403: the owner confirms.
  const gh = has("gh") && run("gh", ["auth", "status"]).ok;
  let repo;
  const api = (path) => {
    const r = run("gh", ["api", `repos/${repo}/${path}`]);
    const msg = `gh api ${path}: ${(r.err || r.out).trim().split("\n")[0]}`;
    if (!r.ok) throw Object.assign(new Error(msg), { manual: /HTTP 40[13]/.test(msg) });
    return JSON.parse(r.out);
  };
  const noGh = manual("gh is not logged in here: the owner confirms this on github.com");
  /** Pass when `cmd args` exits 0; else fail with its first output line. */
  const tool = (cmd, ...args) => {
    if (!has(cmd)) return fail(`${cmd} is not on PATH`);
    const r = run(cmd, args);
    const label = [cmd, ...args].join(" ");
    return r.ok ? pass(label) : fail((r.err || r.out).trim().split("\n")[0] || `${label} failed`);
  };
  const answers = readAnswers(root);
  /** ask when a gating question is unanswered; skipped when an answer turns the item off. */
  const gate = (id) => {
    for (const q of QUESTIONS.filter((x) => x.items.includes(id))) {
      const a = answers[q.id];
      if (a === undefined)
        return { status: "ask", note: `answer question \`${q.id}\``, fix: ASK_FIX };
      const ok = [].concat(a).every((v) => q.options.some((o) => o.value === v));
      if (!ok || (!q.multi && typeof a !== "string")) {
        return { status: "ask", note: `not a valid answer to \`${q.id}\`: ${a}`, fix: ASK_FIX };
      }
      if (q.off?.includes(a) && q.present && file(q.present)) {
        return fail(`chosen: ${a}, but ${q.present} exists`);
      }
      if (q.off?.includes(a)) return { status: "skipped", note: `chosen: ${a}` };
    }
  };
  const noRepo = () => (gh ? manual("repo unknown (see repo): the owner confirms") : noGh);

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
    apps() {
      const apps = [].concat(answers.apps);
      if (!apps.includes("claude")) return fail("the Claude App is required");
      if (answers.secrets === "hoist" && !apps.includes("secrets")) {
        return fail("secrets = hoist, but secrets read access is not confirmed");
      }
      if (answers.update_bot === "app" && !apps.includes("splice")) {
        return fail("update bot is a GitHub App, but that App is not installed");
      }
      return pass(`confirmed: ${apps.join(", ")}`);
    },
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
      if (!repo) return noRepo();
      const p = api("actions/permissions");
      return p.enabled
        ? pass(`enabled (allowed: ${p.allowed_actions})`)
        : fail("Actions are disabled");
    },
    rulesets() {
      if (!repo) return noRepo();
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
      if (!repo) return noRepo();
      const have = new Map(api("environments").environments.map((e) => [e.name, e]));
      const gaps = [];
      // Session mode skips the update job, but bosun still uses splice-bot's token.
      const session = answers.update_bot === "session" && answers.bosun !== "yes";
      const names = requiredEnvironments(root).filter((n) => !(session && n === "splice-bot"));
      for (const name of names) {
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
      // Session mode needs SPLICE_BOT=off, or splice.yml runs and auto-creates splice-bot.
      if (answers.update_bot === "session") {
        let value;
        try {
          value = api("actions/variables/SPLICE_BOT").value;
        } catch (e) {
          if (e.manual) throw e;
        }
        if (value !== "off") gaps.push("update bot is session, but variable SPLICE_BOT is not off");
      }
      return gaps.length ? fail(gaps.join("; ")) : pass(names.join(", ") || "none needed");
    },
    secrets: () =>
      file("secrets.toml")
        ? tool("hoist", "secrets", "check")
        : fail("no secrets.toml: add the secrets piece"),
    bosun: () => (file(".bosun") ? tool("bosun", "doctor") : fail("no .bosun/: run bosun init")),
    render() {
      if (!file(".splice/lock.toml")) return fail("no .splice/lock.toml");
      const lock = readFileSync(join(root, ".splice/lock.toml"), "utf8");
      const ids = [...lock.matchAll(/^\[\[pieces\]\]\s*\nid\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
      const want = [].concat(answers.pieces).flatMap((p) => PIECES[p]);
      const missing = want.filter((id) => !ids.includes(id));
      if (missing.length) return fail(`pieces answer needs ${missing.join(", ")}, not in the lock`);
      const ci = ids.find((id) => id.startsWith("circleci"));
      const ciWant = { github: undefined, circleci: "circleci-only", both: "circleci" }[answers.ci];
      if (ci !== ciWant)
        return fail(`ci = ${answers.ci}, but the lock has ${ci ?? "no CircleCI piece"}`);
      return tool("splice", "check", "--offline");
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
    approvals: () =>
      answers.approvals === "bootstrap" && today > BOOTSTRAP_END
        ? fail(`bootstrap mode ended ${BOOTSTRAP_END} (D-012); pick owner`)
        : pass(`confirmed: ${answers.approvals}`),
  };

  return ITEMS.map((item) => {
    try {
      return { ...item, ...(gate(item.id) ?? checks[item.id]()) };
    } catch (e) {
      return { ...item, ...(e.manual ? manual(e.message) : fail(e.message)) };
    }
  });
}

/** Text report and exit code. */
export function report(results, url) {
  const lines = [];
  for (const r of results) {
    lines.push(`${r.status.padEnd(7)} ${r.id.padEnd(12)} ${r.note}`);
    if (!["pass", "skipped"].includes(r.status)) {
      lines.push(`        fix: ${r.fix}`, `        see: ${url}#${r.id}`);
    }
  }
  const failed = results.filter((r) => ["fail", "ask"].includes(r.status)).length;
  const manuals = results.some((r) => r.status === "manual");
  lines.push(
    failed
      ? `not ready: ${failed} item(s) fail or need an answer. Do not start autonomous work.`
      : manuals
        ? "automatable items pass: confirm every manual item with the owner before autonomous work."
        : "ready: every item passes or was skipped by choice.",
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
  const [flag, ...rest] = process.argv.slice(2);
  if (flag === "--questions") {
    const answers = readAnswers(root);
    const qs = QUESTIONS.map(({ id, header, question, multi, options }) => ({
      id,
      header,
      question,
      multiSelect: Boolean(multi),
      answer: answers[id] ?? null,
      options: options.map((o, i) => ({ ...o, recommended: i === 0 })),
    }));
    process.stdout.write(`${JSON.stringify(qs, null, 2)}\n`);
    process.exit(0);
  }
  if (flag === "--answer") {
    const answers = readAnswers(root);
    for (const arg of rest) {
      const [id, value = ""] = arg.split("=");
      const q = QUESTIONS.find((x) => x.id === id);
      if (!q) {
        process.stderr.write(
          `unknown question ${id}; ids: ${QUESTIONS.map((x) => x.id).join(", ")}\n`,
        );
        process.exit(2);
      }
      const values = value === "" ? [] : value.split(",");
      const allowed = q.options.map((o) => o.value);
      if (values.some((v) => !allowed.includes(v)) || (!q.multi && values.length !== 1)) {
        process.stderr.write(`${id}: ${value} is not one of ${allowed.join(", ")}\n`);
        process.exit(2);
      }
      answers[id] = q.multi ? values : values[0];
    }
    writeAnswers(root, answers);
    process.exit(0);
  }
  const { text, code } = report(
    runChecks({ root, run, node: process.versions.node }),
    checklistUrl(root),
  );
  process.stdout.write(text);
  process.exitCode = code;
}
