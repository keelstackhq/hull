#!/usr/bin/env node
// `cargo deny` with a local overlay and a default check list. deny.toml is owned (splice update
// rewrites it), so what a repo needs beyond the template's policy goes in the seed
// `deny.local.toml` next to it:
//   [licenses]
//   allow = ["MPL-2.0"]
//   [advisories]
//   ignore = [{ id = "RUSTSEC-2024-0001", reason = "not reachable", expires = "2027-01-31" }]
// This script merges both into a temporary copy of deny.toml (ignores as { id, reason }: cargo-deny
// has no `expires`) and runs `cargo deny --config <copy> <args>`. An ignore without `reason` or a
// valid `expires`, or one that has expired (UTC), fails with exit 1 before cargo-deny runs, but only
// when `advisories` is among the checks run (an expired ignore must not fail a push to main).
// Without deny.local.toml it runs `cargo deny <args>` as is.
// Usage: node scripts/deny.mjs [cargo deny args]  (an explicit --config <file> is honoured).
// No args = `--locked check advisories bans licenses sources`; on a push to the default branch
// (GITHUB_EVENT_NAME=push, or CircleCI on `main`/DENY_DEFAULT_BRANCH without CIRCLE_PULL_REQUEST)
// `advisories` is dropped, since
// the weekly scan covers main and a new advisory must not turn it red.
// Node built-ins only.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const quoted = (text) => [...text.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)].map((m) => m[1] ?? m[2]);
const ALLOW = /^allow\s*=\s*\[([\s\S]*?)\]/m;
const FAIL =
  'deny.local.toml: only `[licenses] allow = ["..."]` and `[advisories] ignore = [{ id, reason, expires }]` are merged; edit deny.toml for the rest';

/** Drops a `# comment` that is not inside a string. */
function stripComments(line) {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

/** `{ licenses, ignores }` from deny.local.toml; throws on anything else. */
function parseOverlay(local) {
  const sections = {};
  let cur = null;
  for (const raw of local.split("\n")) {
    const l = stripComments(raw).trim();
    if (!l) continue;
    const h = l.match(/^\[([a-z]+)\]$/);
    if (h) {
      if (!["licenses", "advisories"].includes(h[1]) || h[1] in sections) throw new Error(FAIL);
      cur = h[1];
      sections[cur] = [];
    } else if (cur) sections[cur].push(l);
    else throw new Error(FAIL);
  }
  const licenses = [];
  const body = (sections.licenses ?? []).join("\n");
  if (body) {
    const m = body.match(/^allow\s*=\s*\[([^\]]*)\]$/);
    if (!m) throw new Error(FAIL);
    licenses.push(...quoted(m[1]));
    if (m[1].replace(/[\s,]/g, "") !== "" && licenses.length === 0) throw new Error(FAIL);
  }
  const ignores = [];
  const adv = (sections.advisories ?? []).join("\n");
  if (adv) {
    const m = adv.match(/^ignore\s*=\s*\[([\s\S]*)\]$/);
    if (!m) throw new Error(FAIL);
    const rest = m[1].replace(/\{([^{}]*)\}/g, (_, inner) => {
      const e = {};
      for (const kv of inner.matchAll(/([a-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        e[kv[1]] = kv[2] ?? kv[3];
      }
      ignores.push(e);
      return "";
    });
    for (const bare of quoted(rest)) ignores.push({ id: bare });
    if (rest.replace(/"[^"]*"|'[^']*'|[\s,]/g, "") !== "") throw new Error(FAIL);
  }
  return { licenses, ignores };
}

/** Throws (naming the id) unless each ignore has `id`, `reason` and an `expires` date not before `today`. */
function checkIgnores(ignores, today) {
  for (const e of ignores) {
    const id = e.id ?? "(no id)";
    const bad = (why) => {
      throw new Error(`deny.local.toml: advisory ignore ${id}: ${why}`);
    };
    if (!e.id) bad("missing `id`");
    if (!e.reason?.trim()) bad("missing `reason`");
    const d = /^\d{4}-\d{2}-\d{2}$/.test(e.expires ?? "")
      ? new Date(`${e.expires}T00:00:00Z`)
      : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== e.expires) {
      bad("missing or invalid `expires` (YYYY-MM-DD)");
    }
    if (e.expires < today) bad(`expired on ${e.expires}; fix the advisory or renew the entry`);
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

function extendAllow(base, extraAll) {
  const extra = extraAll.filter((l) => !quoted(base.match(ALLOW)?.[1] ?? "").includes(l));
  if (extra.length === 0) return base;
  const m = base.match(ALLOW);
  if (!m) throw new Error("deny.toml has no `allow = [...]` list to extend");
  const inner = m[1].replace(/[\s,]+$/, "");
  const sep = inner.trim() === "" ? "" : ", ";
  const list = extra.map((l) => `"${l}"`).join(", ");
  return base.replace(ALLOW, () => `allow = [${inner}${sep}${list}]`);
}

/** Index of the `]` closing the array whose `[` is at `open` (quote-aware), or -1. */
function closeOf(text, open) {
  let quote = "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return -1;
}

/** `text` with `entries` (TOML inline tables) added to `[advisories] ignore`, creating what is missing. */
function addIgnores(text, entries) {
  const list = entries.join(", ");
  const header = /^\[advisories\][ \t]*(?:#.*)?$/m.exec(text);
  if (!header) return `${text.replace(/\n*$/, "\n")}\n[advisories]\nignore = [${list}]\n`;
  const start = header.index + header[0].length;
  const next = /^\[/m.exec(text.slice(start));
  const end = next ? start + next.index : text.length;
  const existing = /^ignore\s*=\s*\[/m.exec(text.slice(start, end));
  if (!existing) return `${text.slice(0, start)}\nignore = [${list}]${text.slice(start)}`;
  const open = start + existing.index + existing[0].length - 1;
  const close = closeOf(text, open);
  if (close === -1 || close > end) throw new Error("deny.toml: unterminated `ignore = [...]`");
  const inner = text.slice(open + 1, close).replace(/[\s,]+$/, "");
  const sep = inner.trim() === "" ? "" : ", ";
  return `${text.slice(0, open + 1)}${inner}${sep}${list}${text.slice(close)}`;
}

/**
 * `deny.toml` text with the overlay's licenses and advisory ignores merged in. Ignores are only
 * validated (reason, expires, expiry) when `advisories` is among the checks being run.
 */
export function mergeOverlay(base, local, today = todayUtc(), advisories = true) {
  const { licenses, ignores } = parseOverlay(local);
  if (advisories) checkIgnores(ignores, today);
  let out = extendAllow(base, licenses);
  if (ignores.length > 0) {
    out = addIgnores(
      out,
      ignores.map(
        (e) => `{ id = ${JSON.stringify(e.id)}, reason = ${JSON.stringify(e.reason ?? "")} }`,
      ),
    );
  }
  return out;
}

/** `deny.toml` text with the overlay's licenses appended to `[licenses] allow`. */
export function mergeAllow(base, local) {
  return mergeOverlay(base, local);
}

/**
 * True on a push to the default branch, where advisories are not checked: GitHub push events, or
 * CircleCI on the default branch (`main`, or DENY_DEFAULT_BRANCH) without a pull request. Merge
 * queue branches (gh-readonly-queue/*) are not the default branch, so they check advisories.
 */
export function isDefaultBranchPush(env = process.env) {
  if (env.GITHUB_EVENT_NAME) return env.GITHUB_EVENT_NAME === "push";
  return (
    env.CIRCLECI === "true" &&
    !env.CIRCLE_PULL_REQUEST &&
    env.CIRCLE_BRANCH === (env.DENY_DEFAULT_BRANCH || "main")
  );
}

/** Arguments when none are given: every check, minus advisories on a push to the default branch. */
export function defaultArgs(env = process.env) {
  const push = isDefaultBranchPush(env);
  const checks = ["advisories", "bans", "licenses", "sources"].filter(
    (c) => !(push && c === "advisories"),
  );
  return ["--locked", "check", ...checks];
}

/** True when `cargo deny <args>` runs the advisories check (`check` with no names runs all). */
export function runsAdvisories(args) {
  const i = args.indexOf("check");
  if (i === -1) return false;
  const names = args.slice(i + 1).filter((a) => !a.startsWith("-"));
  return names.length === 0 || names.includes("advisories");
}

/** Splits `--config <file>` out of the arguments. */
function configOf(args) {
  const i = args.indexOf("--config");
  if (i === -1 || i === args.length - 1) return { file: "deny.toml", rest: args };
  return { file: args[i + 1], rest: [...args.slice(0, i), ...args.slice(i + 2)] };
}

function main(argv) {
  const args = argv.length === 0 ? defaultArgs() : argv;
  const { file, rest } = configOf(args);
  const local = join(dirname(resolve(file)), "deny.local.toml");
  let cmd = ["deny", ...args];
  let tmp = null;
  if (existsSync(file) && existsSync(local)) {
    const merged = mergeOverlay(
      readFileSync(file, "utf8"),
      readFileSync(local, "utf8"),
      todayUtc(),
      runsAdvisories(rest),
    );
    tmp = mkdtempSync(join(tmpdir(), "deny-"));
    const path = join(tmp, "deny.toml");
    writeFileSync(path, merged);
    cmd = ["deny", "--config", path, ...rest];
  }
  const r = spawnSync("cargo", cmd, { stdio: "inherit" });
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  process.exitCode = r.status ?? 1;
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
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}
