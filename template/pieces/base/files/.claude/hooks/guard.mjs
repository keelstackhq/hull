// PreToolUse guard: denies releases, force/tag pushes, deleting main/master on the remote, secret
// reads and lock edits; asks before editing files the template owns. A guard rail, not a sandbox.
// Known gaps: `eval`, `$(...)` and backticks, scripts that publish, editing owned files through
// Bash, and a default branch not named main or master. Node built-ins only.
// Any internal error allows the call and prints one stderr line; settings deny rules stay as the
// second layer.
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_SAFE = new Set([".env.example", ".env.sample", ".env.template", ".dev.vars.example"]);
const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SHELLS = new Set(["bash", "sh", "zsh"]);
const LOCK_RE = /(^|\/)\.splice\/lock\.toml$/;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FILE_TOOLS = new Set(["Read", "Grep", "Glob", ...EDIT_TOOLS]);
const DEFAULT_BRANCH_RE = /^(refs\/heads\/)?(main|master)$/;

/** Program name without its directory: `/usr/bin/npm` → `npm`. */
const base = (prog) => String(prog).slice(String(prog).lastIndexOf("/") + 1);

const REASON = {
  publish: "Releases run in CI from a tag a human pushes (release.yml); do not publish from here.",
  force:
    "Push without --force or +refspec; rebase onto the remote branch, or ask the human to rewrite history.",
  tag: "a tag push publishes: push branches only and ask the human to push release tags.",
  deleteDefault:
    "never delete the default branch on the remote: delete feature branches only, or ask the human.",
  secret:
    "Secret files are off limits: read .env.example for the variable names, or ask the human.",
  lock: "only splice writes the lock (.splice/lock.toml): run `splice update` or `splice add` instead.",
  owned:
    "owned by the template: `splice update` overwrites it; put local changes in seed files or docs/agents/project.md",
};

/** Tool argument that names a file: `file_path ?? notebook_path ?? path`. */
export function targetPath(toolInput) {
  return toolInput?.file_path ?? toolInput?.notebook_path ?? toolInput?.path;
}

/** Repo-relative paths with `class = "owned"` in the `[files]` table of `.splice/lock.toml`. */
export function ownedPaths(lockText) {
  const owned = new Set();
  let inFiles = false;
  for (const line of String(lockText ?? "").split("\n")) {
    const header = /^\s*\[([^\]]*)\]\s*$/.exec(line);
    if (header) {
      inFiles = header[1].trim() === "files";
      continue;
    }
    if (!inFiles) continue;
    const m = /^\s*"([^"]+)"\s*=\s*\{[^}]*\bclass\s*=\s*"owned"/.exec(line);
    if (m) owned.add(m[1]);
  }
  return owned;
}

/** Split a command line into simple commands (token lists), ignoring quotes' content for splitting. */
function split(cmd) {
  const segments = [];
  let tokens = [];
  let cur = "";
  let has = false;
  let quote = "";
  const endToken = () => {
    if (has) tokens.push(cur);
    cur = "";
    has = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < cmd.length) {
      cur += cmd[++i];
      has = true;
    } else if (c === ";" || c === "|" || c === "\n") {
      endSegment();
    } else if (c === "&" && !cur.endsWith(">") && !cur.endsWith("<")) {
      endSegment();
    } else if (c === " " || c === "\t") {
      endToken();
    } else {
      cur += c;
      has = true;
    }
  }
  endSegment();
  return segments;
}

function stripPrefixes(tokens) {
  let t = tokens
    .map((x, i) => (i === 0 ? x.replace(/^[({]+/, "") : x).replace(/[)}]+$/, ""))
    .filter((x) => x !== "");
  const skipOptions = (valueFlags = []) => {
    while (t[0]?.startsWith("-")) t = t.slice(valueFlags.includes(t[0]) ? 2 : 1);
  };
  const skipEnvOptions = () => {
    while (t[0]?.startsWith("-")) {
      const o = t[0];
      if (o === "-S" || o === "--split-string") {
        t = [...split(t[1] ?? "").flat(), ...t.slice(2)];
        return;
      }
      const inline = /^(?:-S|--split-string=)(.+)$/.exec(o);
      if (inline) {
        t = [...split(inline[1]).flat(), ...t.slice(1)];
        return;
      }
      t = t.slice(["-u", "--unset", "-C", "--chdir"].includes(o) ? 2 : 1);
    }
  };
  for (;;) {
    const raw = t[0];
    if (raw === undefined) return t;
    const a = base(raw);
    const b = t[1];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) t = t.slice(1);
    else if (["then", "do", "else", "elif", "!", "exec", "command", "time", "nohup"].includes(a)) {
      t = t.slice(1);
      skipOptions();
    } else if (a === "env") {
      t = t.slice(1);
      skipEnvOptions();
    } else if (a === "npx") {
      t = t.slice(1);
      skipOptions();
    } else if (a === "sudo") {
      t = t.slice(1);
      skipOptions(["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"]);
    } else if (a === "nice") {
      t = t.slice(1);
      skipOptions(["-n", "--adjustment"]);
    } else if (a === "xargs") {
      t = t.slice(1);
      skipOptions(["-n", "-I", "-L", "-P", "-s", "-d", "-E"]);
    } else if (a === "timeout") {
      t = t.slice(1);
      skipOptions(["-s", "-k"]);
      t = t.slice(1);
    } else if (a === "pnpm" && (b === "exec" || b === "dlx")) {
      t = t.slice(2);
      skipOptions();
    } else return t;
  }
}

/** Simple commands in `cmd` as token lists, prefixes stripped, `bash -c '<s>'` expanded once. */
export function commands(cmd) {
  const out = [];
  for (const seg of split(String(cmd ?? ""))) {
    const t = stripPrefixes(seg);
    if (!t.length) continue;
    out.push(t);
    if (SHELLS.has(base(t[0]))) {
      const i = t.findIndex((x, n) => n > 0 && /^-[a-z]*c$/.test(x));
      if (i > 0 && t[i + 1] !== undefined) {
        for (const inner of split(t[i + 1])) {
          const it = stripPrefixes(inner);
          if (it.length) out.push(it);
        }
      }
    }
  }
  return out;
}

function isSecretName(name) {
  if (!name || SECRET_SAFE.has(name)) return false;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (name === ".dev.vars" || name.startsWith(".dev.vars.")) return true;
  if (/[*?[{]/.test(name)) {
    const prefix = name.slice(0, name.search(/[*?[{]/));
    return (
      prefix.length > 0 &&
      !SECRET_SAFE.has(prefix) &&
      (prefix.startsWith(".env") || prefix.startsWith(".dev.vars"))
    );
  }
  return false;
}

function secretLike(value) {
  if (typeof value !== "string" || !value) return false;
  const clean = value.replace(/^[<>]+/, "");
  for (const v of new Set([clean, clean.slice(clean.lastIndexOf("=") + 1)])) {
    if (isSecretName(v.slice(v.lastIndexOf("/") + 1))) return true;
  }
  return false;
}

function gitSub(t) {
  let i = 1;
  while (i < t.length && t[i].startsWith("-")) {
    const takesValue = ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(t[i]);
    i += takesValue ? 2 : 1;
  }
  return { sub: t[i], args: t.slice(i + 1) };
}

function pushRule(args) {
  let tag = false;
  let del = false;
  const refs = [];
  for (const a of args) {
    if (a === "--mirror" || a === "--force" || a.startsWith("--force-") || a.startsWith("--force="))
      return "force";
    if (/^-[A-Za-z]*f[A-Za-z]*$/.test(a)) return "force";
    if (a.startsWith("+")) return "force";
    if (a === "--tags" || a === "--follow-tags") tag = true;
    if (a === "--delete" || /^-[A-Za-z]*d[A-Za-z]*$/.test(a)) del = true;
    if (!a.startsWith("-")) {
      refs.push(a);
      const dst = a.slice(a.lastIndexOf(":") + 1);
      if (a.startsWith(":") && DEFAULT_BRANCH_RE.test(dst)) return "deleteDefault";
      if (dst.startsWith("refs/tags/") || /^[^/\s]*-v\d/.test(dst)) tag = true;
    }
  }
  if (del && refs.some((r) => DEFAULT_BRANCH_RE.test(r))) return "deleteDefault";
  return tag ? "tag" : null;
}

function writesLock(t, i) {
  const tok = t[i];
  if (/^\d*>>?/.test(tok) || /^&>>?/.test(tok)) return true;
  if (/^\d*>>?$|^&>>?$/.test(t[i - 1] ?? "")) return true;
  if (["tee", "mv", "cp", "rm", "truncate", "install", "ln", "touch"].includes(t[0])) return true;
  return (
    (t[0] === "sed" || t[0] === "perl") &&
    t.some((x) => /^-[A-Za-z]*i/.test(x) || /^--in-place/.test(x))
  );
}

function bashRule(t) {
  const prog = base(t[0]);
  const args = t.slice(1);
  if (
    MANAGERS.has(prog) &&
    args.some((a) => a === "publish" || a === "unpublish" || a === "dist-tag")
  )
    return "publish";
  if (prog === "cargo" && args.includes("publish")) return "publish";
  if (prog === "changeset" && args.includes("publish")) return "publish";
  if (prog === "gh" && args[0] === "release" && ["create", "upload"].includes(args[1]))
    return "publish";
  if (prog === "git") {
    const { sub, args: rest } = gitSub(t);
    if (sub === "push") return pushRule(rest);
  }
  if (t.some(secretLike)) return "secret";
  const li = t.findIndex((x) => LOCK_RE.test(x.replace(/^\d*[>&]*/, "").replace(/^\.\//, "")));
  if (li >= 0 && writesLock(t, li)) return "lock";
  return null;
}

function relPath(p, projectDir) {
  const rel = posix.relative(
    posix.resolve(projectDir),
    posix.resolve(projectDir, String(p).replaceAll("\\", "/")),
  );
  return rel;
}

/**
 * @param {{ tool_name: string, tool_input: Record<string, unknown> }} input
 * @param {{ lockText?: string, projectDir: string }} ctx
 * @returns {null | { decision: "deny" | "ask", reason: string }}
 */
export function decide(input, ctx) {
  const name = input?.tool_name;
  const ti = input?.tool_input ?? {};
  const deny = (key) => ({ decision: "deny", reason: REASON[key] });
  if (name === "Bash") {
    for (const t of commands(ti.command)) {
      const rule = bashRule(t);
      if (rule) return deny(rule);
    }
    return null;
  }
  if (!FILE_TOOLS.has(name)) return null;
  const candidates = [targetPath(ti), ti.glob];
  if (name === "Glob") candidates.push(ti.pattern);
  if (candidates.some(secretLike)) return deny("secret");
  if (!EDIT_TOOLS.has(name)) return null;
  const target = targetPath(ti);
  if (typeof target !== "string" || !target) return null;
  const rel = relPath(target, ctx.projectDir);
  if (rel === ".splice/lock.toml") return deny("lock");
  if (ctx.lockText && ownedPaths(ctx.lockText).has(rel)) {
    return { decision: "ask", reason: REASON.owned };
  }
  return null;
}

function main() {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let lockText;
    try {
      lockText = readFileSync(resolve(projectDir, ".splice/lock.toml"), "utf8");
    } catch {
      lockText = undefined;
    }
    const d = decide(input, { lockText, projectDir });
    if (d) {
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: d.decision,
            permissionDecisionReason: d.reason,
          },
        })}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `guard.mjs: ignored internal error: ${String(err?.message ?? err).split("\n")[0]}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
