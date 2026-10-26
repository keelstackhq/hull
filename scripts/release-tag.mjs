// Release decision for a push to main. The version comes from the first `## v<X.Y.Z> — <rest>`
// heading of CHANGELOG.md; `<rest>` is a date (released) or `unreleased` (accumulating).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HEADING = /^## v(\S+) — (.*)$/;
const PLAIN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** First `## v<X.Y.Z> — <date|unreleased>` section of the changelog text. */
export function changelogRelease(text) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("## "));
  if (at < 0) throw new Error("CHANGELOG.md has no `## v<X.Y.Z> — <date|unreleased>` heading");
  const m = HEADING.exec(lines[at].trimEnd());
  if (!m) {
    throw new Error(
      `CHANGELOG.md top heading is not \`## v<X.Y.Z> — <date|unreleased>\`: ${lines[at]}`,
    );
  }
  const [, version, rest] = m;
  if (!PLAIN.test(version)) {
    throw new Error(`CHANGELOG.md top version "${version}" is not a plain X.Y.Z semver`);
  }
  let date = null;
  if (rest !== "unreleased") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rest)) {
      throw new Error(
        `CHANGELOG.md top heading must end in YYYY-MM-DD or "unreleased", got "${rest}"`,
      );
    }
    date = rest;
  }
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (l.startsWith("## ")) break;
    body.push(l);
  }
  return { version, date, notes: `${body.join("\n").trim()}\n` };
}

/**
 * `remoteTags` is `git ls-remote --tags` output (plain and peeled `^{}` lines). Returns the tag and
 * whether to create it: a missing tag is created; a tag on `sha` (the run's own commit) is
 * released again without creating it only on a re-run (`attempt` > 1). Otherwise nothing releases.
 */
export function releaseTag({ version, remoteTags, sha, attempt = 1 }) {
  const tag = `v${version}`;
  const ref = `refs/tags/${tag}`;
  let plain = null;
  let peeled = null;
  for (const line of remoteTags.split("\n")) {
    const [commit, name] = line.split("\t");
    if (name === ref) plain = commit;
    if (name === `${ref}^{}`) peeled = commit;
  }
  const at = peeled ?? plain;
  if (at === null) return { tag, create: true };
  if (sha && at === sha && attempt > 1) return { tag, create: false };
  return { tag: "", create: false };
}

/** Highest plain `vX.Y.Z` tag strictly below `version`, or "". */
export function previousTag(version, remoteTags) {
  const parse = (v) => PLAIN.exec(v)?.slice(1).map(Number);
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const target = parse(version);
  let best = null;
  for (const line of remoteTags.split("\n")) {
    const name = line.split("\t")[1];
    const m = /^refs\/tags\/v(\d+\.\d+\.\d+)$/.exec(name ?? "");
    const v = m && parse(m[1]);
    if (!v || cmp(v, target) >= 0) continue;
    if (!best || cmp(v, best) > 0) best = v;
  }
  return best ? `v${best.join(".")}` : "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const i = process.argv.indexOf("--changelog");
    const path = i > 0 ? process.argv[i + 1] : new URL("../CHANGELOG.md", import.meta.url);
    const text = readFileSync(path, "utf8");
    const { version, date, notes } = changelogRelease(text);
    if (process.argv.includes("--notes")) {
      process.stdout.write(notes);
    } else {
      let tag = "";
      let create = false;
      let previous = "";
      if (date === null) {
        console.log(`v${version} is unreleased in CHANGELOG.md: nothing to release`);
      } else {
        const remoteTags = execFileSync("git", ["ls-remote", "--tags", "origin", "refs/tags/v*"], {
          encoding: "utf8",
        });
        const sha = process.env.GITHUB_SHA ?? "";
        const attempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? "1");
        ({ tag, create } = releaseTag({ version, remoteTags, sha, attempt }));
        previous = previousTag(version, remoteTags);
        console.log(
          create
            ? `${tag} is not tagged yet: tag and release it`
            : tag
              ? `${tag} already tags this commit: release it again (a re-run)`
              : `v${version} is already tagged (by a person or an earlier run): nothing to release`,
        );
      }
      if (process.env.GITHUB_OUTPUT) {
        appendFileSync(
          process.env.GITHUB_OUTPUT,
          `version=${version}\ntag=${tag}\ncreate=${create}\nrelease=${tag !== ""}\nprevious=${previous}\n`,
        );
      }
    }
  } catch (e) {
    console.error(`release-tag: ${e.message}`);
    process.exit(1);
  }
}
