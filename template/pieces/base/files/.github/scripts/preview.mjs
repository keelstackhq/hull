// PR previews: runs `turbo run deploy:preview --affected` and writes the job summary.
// A Worker that was never deployed cannot take a preview version (`wrangler versions upload`
// refuses it); such apps are skipped with a notice that names the one-time first deploy. Any other
// failure fails the job. Never deploys production. Node built-ins only.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TURBO_ARGS = [
  "turbo",
  "run",
  "deploy:preview",
  "--affected",
  "--continue",
  "--log-prefix=task",
];

const NOT_CREATED = /cannot upload a new version of a Worker that does not yet exist/;

/**
 * @param {string} log turbo output (ANSI allowed)
 * @param {number} exitCode turbo exit code
 */
export function report(log, exitCode) {
  const text = log.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const urls = [...new Set(text.match(/https:\/\/[^\s)]*\.workers\.dev[^\s)]*/g) ?? [])].sort();
  const notCreated = [
    ...new Set(
      text
        .split("\n")
        .filter((l) => NOT_CREATED.test(l))
        .map((l) => /^(\S+):deploy:preview: /.exec(l)?.[1])
        .filter((p) => p !== undefined),
    ),
  ].sort();
  const failedLine = /^Failed:\s+(.+)$/m.exec(text);
  const failed = failedLine ? failedLine[1].split(",").map((s) => s.trim()) : [];
  const ok =
    exitCode === 0 ||
    (failed.length > 0 &&
      failed.every((t) => t.endsWith("#deploy:preview") && notCreated.includes(t.slice(0, -15))));

  let summary = "## Preview deployments\n\n";
  summary += urls.length ? urls.map((u) => `- ${u}`).join("\n") + "\n" : "No preview URLs.\n";
  /** @type {string[]} */
  const notices = [];
  if (notCreated.length) {
    summary +=
      "\n### Skipped: Worker does not exist yet\n\n" +
      "Previews are versions of an existing Worker. Deploy each app below once, from a machine " +
      "logged in to Cloudflare (`wrangler login`); later PRs get previews.\n\n";
    for (const p of notCreated) {
      summary += `- \`${p}\`: \`pnpm turbo run deploy --filter=${p}\`\n`;
      notices.push(
        `::notice title=Preview skipped::${p}: its Worker does not exist yet. Run \`pnpm turbo run deploy --filter=${p}\` once.`,
      );
    }
  }
  return { ok, urls, notCreated, failed, notices, summary };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const child = spawn("pnpm", TURBO_ARGS, { stdio: ["ignore", "pipe", "pipe"] });
  // One log for both streams: a garbled line can only turn a skip into a failure (fail closed).
  let log = "";
  for (const [from, to] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    from.on("data", (/** @type {Buffer} */ b) => {
      log += b.toString();
      to.write(b);
    });
  }
  child.on("error", (e) => {
    console.error(`preview: ${e.message}`);
    process.exit(1);
  });
  child.on("close", (code) => {
    const r = report(log, code ?? 1);
    for (const n of r.notices) console.log(n);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, r.summary);
    process.exit(r.ok ? 0 : 1);
  });
}
