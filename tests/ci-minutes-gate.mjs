// A small port of bosun's `ci-minutes` gate (bosun src/core/ci_minutes.rs, rules as relayed by the
// orchestrator; bosun itself was not available). Pure: `check(text)` returns finding strings.
import YAML from "yaml";

const PR_EVENTS = ["pull_request", "pull_request_target"];
const PR_TYPES = ["opened", "synchronize", "reopened", "ready_for_review", "edited"];
const GUARDS = [
  /pull_request\.draft\s*==\s*false/,
  /pull_request\.draft\s*!=\s*true/,
  /!\s*github\.event\.pull_request\.draft/,
];
const AGGREGATE = new Set(["ci-ok", "bosun-ok"]);

const norm = (s) =>
  String(s ?? "")
    .replace(/^\$\{\{|\}\}$/g, "")
    .trim();

/** One `&&`-term of a branch that makes the branch safe for drafts. */
function termOk(t) {
  if (GUARDS.some((g) => g.test(t))) return true;
  if (/github\.event_name\s*!=\s*'pull_request(_target)?'/.test(t)) return true;
  const ev = t.match(/github\.event_name\s*==\s*'([^']+)'/);
  if (ev && !PR_EVENTS.includes(ev[1])) return true;
  return /github\.event\.label\.name\s*==\s*'[^']+'/.test(t);
}

/** True when the job-level `if` skips drafts: every `||` branch has a safe `&&` term. */
export function skipsDraft(ifText) {
  const text = norm(ifText);
  if (!text) return false;
  return text.split("||").every((branch) => branch.split("&&").some(termOk));
}

const prTriggers = (on) => PR_EVENTS.filter((e) => on && e in on);
const typesOf = (cfg) =>
  cfg && typeof cfg === "object" && Array.isArray(cfg.types) ? cfg.types : null;
const triggersOn = (cfg) => {
  const t = typesOf(cfg);
  return t === null || t.some((x) => PR_TYPES.includes(x));
};

/** @param {string} text workflow file text; returns `rule: message` strings. */
export function check(text) {
  const wf = YAML.parse(text);
  const on = wf.on ?? wf[true] ?? {};
  const onObj =
    typeof on === "string"
      ? { [on]: null }
      : Array.isArray(on)
        ? Object.fromEntries(on.map((e) => [e, null]))
        : on;
  const out = [];
  const prs = prTriggers(onObj).filter((e) => triggersOn(onObj[e]));
  const jobs = wf.jobs ?? {};
  if (prs.length) {
    for (const e of prs) {
      const t = typesOf(onObj[e]);
      if (!t || !t.includes("ready_for_review"))
        out.push(`ready_for_review: ${e} types must list ready_for_review`);
    }
    const skipping = new Set(
      Object.keys(jobs).filter((n) => !AGGREGATE.has(n) && skipsDraft(jobs[n].if)),
    );
    for (const [name, job] of Object.entries(jobs)) {
      const cond = norm(job.if);
      if (AGGREGATE.has(name)) {
        if (skipsDraft(job.if)) out.push(`aggregate: ${name} must not skip drafts`);
        if (job.needs) {
          const steps = JSON.stringify(job.steps ?? []);
          const failsOnDraft = /pull_request\.draft/.test(steps) && /exit [123]/.test(steps);
          const checksResult = /needs\.[\w-]+\.result\s*(=|==)\s*\\?["']?success/.test(steps);
          if (!/always\(\)/.test(cond)) out.push(`aggregate: ${name} needs always() in its if`);
          if (!failsOnDraft && !checksResult)
            out.push(`aggregate: ${name} needs a step that fails on a draft`);
        }
        continue;
      }
      if (skipsDraft(job.if)) continue;
      const needs = [].concat(job.needs ?? []);
      if (needs.some((n) => skipping.has(n)) && !/always\(\)|cancelled\(\)|failure\(\)/.test(cond))
        continue;
      const first = JSON.stringify((job.steps ?? [])[0] ?? {});
      if (/pull_request\.draft/.test(first) && /exit [123]/.test(first)) continue;
      out.push(`draft: job ${name} does not skip draft pull requests`);
    }
  }
  const allow = (rule) =>
    new RegExp(`^\\s*#\\s*ci-minutes:\\s*allow\\s+${rule}\\s+\\S`, "m").test(text);
  if ((prTriggers(onObj).length || "push" in onObj) && !allow("concurrency")) {
    const c = wf.concurrency;
    const cip = c && typeof c === "object" ? c["cancel-in-progress"] : undefined;
    if (
      cip === undefined ||
      cip === null ||
      cip === "" ||
      cip === false ||
      String(cip).trim() === "false"
    ) {
      out.push(
        "concurrency: top-level concurrency with a cancel-in-progress that is not false is required",
      );
    }
  }
  if (prs.length && !allow("paths")) {
    const heavy = Object.entries(jobs).filter(
      ([, j]) => /macos|windows/i.test(JSON.stringify(j["runs-on"] ?? "")) || j.strategy?.matrix,
    );
    for (const e of prs) {
      const cfg = onObj[e] ?? {};
      if (heavy.length && !cfg.paths && !cfg["paths-ignore"])
        out.push(`paths: heavy job ${heavy[0][0]} needs paths on ${e}`);
    }
  }
  return out;
}
