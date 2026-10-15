#!/usr/bin/env node
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Duration of a job in a `gh run view --json jobs` result. Only successful jobs count: cancelled,
 * skipped or failed jobs have meaningless durations and are ignored (null), not counted as zero.
 * @param {{ jobs?: { name: string, conclusion: string, startedAt: string, completedAt: string }[] }} runJson
 * @param {string} [jobName]
 * @returns {number | null} seconds
 */
export function jobSeconds(runJson, jobName = "ci") {
  const job = (runJson.jobs ?? []).find((j) => j.name === jobName);
  if (!job || job.conclusion !== "success") return null;
  const s = Date.parse(job.startedAt);
  const e = Date.parse(job.completedAt);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return Math.round((e - s) / 1000);
}

/**
 * Nearest-rank percentiles.
 * @param {number[]} seconds
 * @returns {{ n: number, p50: number | null, p90: number | null }}
 */
export function summarize(seconds) {
  const sorted = [...seconds].sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.ceil((p / 100) * sorted.length) - 1] : null);
  return { n: sorted.length, p50: pct(50), p90: pct(90) };
}

const defaultGh = async (args) =>
  (await execFileP("gh", args, { maxBuffer: 64 * 1024 * 1024 })).stdout;

/**
 * @param {string[]} argv
 * @param {{ gh?: (args: string[]) => Promise<string> }} [opts]
 * @returns {Promise<{ code: number, out: string, err: string }>}
 */
export async function run(argv, opts = {}) {
  const gh = opts.gh ?? defaultGh;
  const usage = (msg) => ({
    code: 2,
    out: "",
    err: `${msg}\nusage: ci-timing --repo <owner/repo> [--limit 20] [--budget 45] [--job ci]\n`,
  });
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        repo: { type: "string" },
        limit: { type: "string", default: "20" },
        budget: { type: "string", default: "45" },
        job: { type: "string", default: "ci" },
      },
    }));
  } catch (e) {
    return usage(e.message);
  }
  if (!values.repo || !/^[\w.-]+\/[\w.-]+$/.test(values.repo))
    return usage("--repo must be <owner/repo>");
  const limit = Number(values.limit);
  const budget = Number(values.budget);
  if (!Number.isInteger(limit) || limit < 1) return usage("--limit must be a positive integer");
  if (!Number.isFinite(budget) || budget <= 0) return usage("--budget must be a positive number");

  const seconds = [];
  try {
    const runs = JSON.parse(
      await gh([
        "run",
        "list",
        "-R",
        values.repo,
        "-w",
        "ci.yml",
        "-e",
        "pull_request",
        "-L",
        String(limit),
        "--json",
        "databaseId",
      ]),
    );
    for (const { databaseId } of runs) {
      const view = JSON.parse(
        await gh(["run", "view", String(databaseId), "-R", values.repo, "--json", "jobs"]),
      );
      const s = jobSeconds(view, values.job);
      if (s !== null) seconds.push(s);
    }
  } catch (e) {
    if (e.code === "ENOENT")
      return {
        code: 2,
        out: "",
        err: "gh not found: install the GitHub CLI (https://cli.github.com) and run `gh auth login`\n",
      };
    return { code: 2, out: "", err: `gh failed: ${e.stderr || e.message}\n` };
  }
  const { n, p50, p90 } = summarize(seconds);
  if (n === 0)
    return {
      code: 1,
      out: "",
      err: `no successful '${values.job}' jobs in the last ${limit} runs\n`,
    };
  const over = p50 > budget;
  return {
    code: over ? 1 : 0,
    out: `${values.repo} job ${values.job}: n=${n} p50=${p50}s p90=${p90}s budget=${budget}s ${over ? "OVER" : "ok"}\n`,
    err: "",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await run(process.argv.slice(2));
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exit(r.code);
}
