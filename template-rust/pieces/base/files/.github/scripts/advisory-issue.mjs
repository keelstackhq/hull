// Opens, updates or closes ONE advisory issue for advisories.yml. Node built-ins and fetch only.
//   ADVISORY_OK=true|false  ADVISORY_REPORT=<file with the cargo-deny output>
//   GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL (set by Actions). The token is never logged.
// Findings: create the issue (label `advisories`, fixed title) or update its body; a clean scan
// comments and closes it. Exits 1 only when an API call fails.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TITLE = "Security advisories found in dependencies";
export const LABEL = "advisories";
const MAX_REPORT = 60000;

/** A fenced block whose fence is longer than any backtick run in `text`. */
export function fence(text) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}\n${text}\n${f}`;
}

function body(report) {
  const text =
    report.length > MAX_REPORT ? `${report.slice(0, MAX_REPORT)}\n… (truncated)` : report;
  return [
    "`node scripts/deny.mjs --locked check advisories` reports findings (weekly scan, advisories.yml).",
    "Update the dependency, or add a reviewed ignore with a reason to `deny.local.toml`.",
    "This issue closes itself when a scan is clean.",
    "",
    fence(text.trim()),
  ].join("\n");
}

/** Decide what to do. `issues` are the open issues labelled `advisories`. */
export function plan({ ok, report, issues }) {
  const mine = issues.filter((i) => i.title === TITLE).sort((a, b) => a.number - b.number)[0];
  if (ok) {
    if (!mine) return { action: "none" };
    return {
      action: "close",
      number: mine.number,
      comment: "The weekly advisory scan is clean. Closing.",
    };
  }
  const text = body(report);
  if (!mine) return { action: "create", title: TITLE, body: text };
  if (mine.body === text) return { action: "none", number: mine.number };
  return { action: "update", number: mine.number, body: text };
}

async function main(env) {
  const api = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const repo = env.GITHUB_REPOSITORY;
  if (!env.GITHUB_TOKEN || !repo)
    throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
  const call = async (method, path, payload, okStatus = [200, 201]) => {
    const res = await fetch(`${api}/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!okStatus.includes(res.status)) throw new Error(`${method} ${path}: HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  const ok = env.ADVISORY_OK === "true";
  let report = "";
  if (!ok) {
    try {
      report = readFileSync(env.ADVISORY_REPORT || "advisories.txt", "utf8");
    } catch {
      report = "(no scan output captured; see the workflow run)";
    }
  }
  const found = await call("GET", `/issues?labels=${LABEL}&state=open&per_page=100`);
  const issues = found.filter((i) => !i.pull_request);
  const p = plan({ ok, report, issues });
  if (p.action === "create") {
    // The label may not exist yet; 422 means it does.
    await call("POST", "/labels", { name: LABEL, color: "d93f0b" }, [200, 201, 422]);
    await call("POST", "/issues", { title: p.title, body: p.body, labels: [LABEL] });
  } else if (p.action === "update") {
    await call("PATCH", `/issues/${p.number}`, { body: p.body });
  } else if (p.action === "close") {
    await call("POST", `/issues/${p.number}/comments`, { body: p.comment });
    await call("PATCH", `/issues/${p.number}`, { state: "closed", state_reason: "completed" });
  }
  console.log(`advisories: ${p.action}${p.number ? ` #${p.number}` : ""}`);
}

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
  main(process.env).catch((e) => {
    console.error(`advisories: ${e.message}`);
    process.exit(1);
  });
}
