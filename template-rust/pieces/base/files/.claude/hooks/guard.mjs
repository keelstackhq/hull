// PreToolUse guard: denies releases, force/tag pushes, pushes to the default branch, gh admin verbs
// (merge without --auto, release, secret, repo edit), secret reads and edits of the guard rail itself
// (.claude/hooks, .claude/settings*.json, release workflows, .splice/lock.toml, .bosun/); asks before
// editing files the template owns. Every deny names the allowed alternative. A guard rail, not a
// sandbox: the real fix is a server-side branch ruleset and environment-gated release.
// Matches the executable and its arguments: heredoc bodies and quoted prose are data (a shell heredoc
// is still scanned). `eval`, `sh`/interpreter fed from a pipe, `-c`/`-e` bodies, `$VAR` or `$(...)` in
// command position and git `-c alias.x=` deny when the text mentions push, publish or release.
// Known gaps: scripts that publish, editing guarded files from an interpreter, `patch -p1 < x.diff`
// (the target is inside the diff), `cd` into a guarded dir, and a default branch that origin/HEAD
// does not name. Node built-ins only.
// An internal error denies when the call mentions push, publish, release, gh, secret or sops (retry),
// else allows and prints one stderr line. Settings deny rules only cover force pushes and publish
// commands: the guard is the one layer for default-branch pushes and secrets.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_SAFE = new Set([".env.example", ".env.sample", ".env.template", ".dev.vars.example"]);
const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "fish"]);
const INTERPRETERS = /^(python[\d.]*|node|nodejs|bun|deno|ruby|perl|php)$/;
const LOCK_RE = /(^|\/)\.splice\/lock\.toml$/i;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FILE_TOOLS = new Set(["Read", "Grep", "Glob", ...EDIT_TOOLS]);
const TAG_READ_RE =
  /^(-l|-n\d*|-v|--(list|verify|contains|no-contains|points-at|merged|no-merged|sort|format|column)(=.*)?)$/;
const RISKY_RE = /\b(push|publish|unpublish|release|dist-tag|gh|secrets?|sops)\b/i;
const EXEC_RE =
  /\b(git|gh|npm|pnpm|yarn|bun|cargo|make|hoist|sops)\b[^\n]*\b(push|publish|unpublish|release|dist-tag|secrets?|merge|decrypt)\b/i;
const INLINE_RE = /^-[a-zA-Z]*[ceEp]$|^--eval$/;
const SECRET_VAR_RE = /\$\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;
const SECRET_DIR_RE =
  /(^|\/)\.(aws|ssh|age)(\/|$)|(^|\/)\.config\/gh(\/|$)|^\/proc\/[^/]+\/environ$/;
const PROTECTED_RES = [
  /(^|\/)\.claude\/hooks(\/|$)/i,
  /(^|\/)\.claude\/settings[^/]*\.json$/i,
  /(^|\/)\.github\/workflows\/release[^/]*\.ya?ml$/i,
  /(^|\/)\.bosun(\/|$)/i,
  /(^|\/)\.claude$/i,
];
const FAIL_CLOSED_RE = /\.claude\/(hooks|settings)|workflows\/release|\.bosun\/|\.splice\/lock/i;
const isProtected = (p) => PROTECTED_RES.some((re) => re.test(p));
const stripTok = (x) =>
  x
    .replace(/^\d*[>&]*/, "")
    .replace(/^(of=)?(\.\/)?/, "")
    .replace(/(.)\/+$/, "$1");

/** Program name without its directory: `/usr/bin/npm` → `npm`. */
const base = (prog) => String(prog).slice(String(prog).lastIndexOf("/") + 1);

const REASON = {
  publish: "Releases run in CI from a tag a human pushes (release.yml); do not publish from here.",
  force:
    "Push without --force or +refspec; rebase onto the remote branch, or ask the human to rewrite history.",
  tag: "a tag push publishes: push branches only and ask the human to create and push release tags.",
  deleteDefault:
    "never delete the default branch on the remote: delete feature branches only, or ask the human.",
  pushDefault:
    "Never push to the default branch: push a feature branch (git push -u origin <feature-branch>), open a PR (gh pr create) and enable gh pr merge --auto.",
  rewriteDefault:
    "Never delete or rewrite the default branch: work on a feature branch (git switch -c <name>) and sync with git pull --ff-only.",
  secret:
    "Secret files and values are off limits: read .env.example for the variable names, run what needs values as `hoist secrets exec -- <your command>` (never env, printenv or a shell), or ask the human.",
  ghApi:
    "gh api writes are blocked: use plain GET reads, or ask the human for the change (a PR merges by its owner).",
  ghMerge:
    "gh pr merge only with --auto (merges once required checks pass); never --admin or an immediate merge: ask the human.",
  ghAdmin:
    "Releases, repo settings, branch protection, rulesets and secrets belong to the human: ask the human to run it; gh pr create, view, checks and merge --auto stay open.",
  evasion:
    "Hidden or indirect push, publish or release is blocked: run the command directly (git push -u origin <feature-branch>) so the guard can see it.",
  lock: "only splice writes the lock (.splice/lock.toml): run `splice update` or `splice add` instead.",
  protected:
    "Guard rails (.claude/hooks, .claude/settings*.json, release workflows, .bosun/, git hooksPath and aliases) belong to the human: ask the human; put local rules in docs/agents/project.md.",
  failClosed:
    "The guard hit an internal error on a push, publish, release or secret call: retry the call; if it keeps failing, ask the human.",
};

/** The `ask` text for an owned file: name the place local changes go. */
const ownedReason = (rel) =>
  rel === ".github/workflows/ci.yml"
    ? "owned by the template: `splice update` overwrites it; put repo checks in scripts/ci-extra.sh (runs last in CI)"
    : "owned by the template: `splice update` overwrites it; put local changes in docs/agents/project.md or a seed file";

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
  let pending = [];
  let docs = [];
  const endToken = () => {
    if (has) tokens.push(cur);
    cur = "";
    has = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length) {
      if (docs.length) tokens.docs = docs;
      segments.push(tokens);
    }
    tokens = [];
    docs = [];
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
    } else if (c === "<" && cmd.startsWith("<<<", i)) {
      endToken(); // a here-string: its word is data fed to the command
      cur = "<<<";
      has = true;
      i += 2;
    } else if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] !== "<") {
      const m = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([^\s;&|<>()]+))/.exec(cmd.slice(i));
      if (m) {
        endToken();
        pending.push({ strip: m[1] === "-", word: m[2] ?? m[3] ?? m[4] });
        i += m[0].length - 1;
      } else {
        cur += c;
        has = true;
      }
    } else if (c === "\n" && pending.length) {
      // Heredoc bodies are data, not commands; keep them only for a shell that reads them.
      let at = i + 1;
      for (const { strip, word } of pending) {
        let body = "";
        while (at < cmd.length) {
          let end = cmd.indexOf("\n", at);
          if (end < 0) end = cmd.length;
          const line = cmd.slice(at, end);
          at = end + 1;
          if ((strip ? line.replace(/^\t+/, "") : line) === word) break;
          body += `${line}\n`;
        }
        docs.push(body);
      }
      pending = [];
      i = at - 1;
      endSegment();
    } else if (c === "|" && cur.endsWith(">")) {
      cur += c; // `>|` forces a redirect
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
    else if (
      [
        "then",
        "do",
        "else",
        "elif",
        "!",
        "exec",
        "command",
        "builtin",
        "time",
        "nohup",
        "setsid",
      ].includes(a)
    ) {
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
    } else if (a === "ionice") {
      t = t.slice(1);
      skipOptions(["-c", "-n", "-p", "-P", "-u", "--class", "--classdata", "--pid"]);
    } else if (a === "stdbuf") {
      t = t.slice(1);
      skipOptions(["-i", "-o", "-e", "--input", "--output", "--error"]);
    } else if (a === "doas") {
      t = t.slice(1);
      skipOptions(["-u", "-C"]);
    } else if (a === "busybox") {
      t = t.slice(1);
    } else if (a === "watch") {
      t = t.slice(1);
      skipOptions(["-n", "--interval"]);
      if (t.length === 1 && /\s/.test(t[0])) t = split(t[0]).flat();
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

/** Simple commands in `cmd` as token lists, prefixes stripped, `bash -c '<s>'` expanded recursively.
 * Pseudo-commands `@evade` (text with a risky word is refused) and `@evade-exec` (same, for code
 * bodies) mark constructs the guard cannot read. */
export function commands(cmd) {
  const text = String(cmd ?? "");
  const out = [];
  const DUMP_RE = /process\.env(?![.[\w])|os\.environ(?![.[\w])|\bENVIRON\b/;
  const secretTokens = (body) => {
    if (DUMP_RE.test(body)) out.push(["printenv"]);
    for (const m of body.matchAll(/[^\s"'`()<>=,;:{}[\]]+/g)) {
      if (secretLike(m[0])) out.push(["cat", m[0]]);
    }
  };
  for (const seg of split(text)) {
    const t = stripPrefixes(seg);
    if (!t.length) {
      // A bare `env` (options and assignments only) prints the environment.
      if (base(seg[0].replace(/^[({]+/, "")) === "env") out.push(["printenv"]);
      continue;
    }
    if (seg.docs) t.docs = seg.docs;
    out.push(t);
    const prog = base(t[0]);
    const segText = seg.join(" ");
    // `xargs git ...` takes its last arguments from stdin; `find -exec cmd ... ;` runs cmd.
    if (base(seg[0].replace(/^[({]+/, "")) === "xargs") out.push(["@evade", segText]);
    if (prog === "find") {
      const e = t.findIndex((x) => x === "-exec" || x === "-execdir" || x === "-ok");
      if (e >= 0) {
        const end = t.findIndex((x, n) => n > e && (x === ";" || x === "+"));
        const inner = stripPrefixes(t.slice(e + 1, end < 0 ? undefined : end));
        if (inner.length) out.push(inner);
        const ci = inner.findIndex((x, n) => n > 0 && /^-[a-z]*c$/.test(x));
        if (SHELLS.has(base(inner[0] ?? "")) && ci > 0 && inner[ci + 1] !== undefined)
          for (const x of commands(inner[ci + 1])) out.push(x);
      }
    }
    if (/^[$`]|\$\(/.test(t[0])) out.push(["@evade", segText]);
    // `git $SUB ...` hides the subcommand.
    if (prog === "git" && t.slice(1, 4).some((x) => /^[$`]|\$\(/.test(x)))
      out.push(["@evade", text]);
    if (prog === "eval") {
      const body = t.slice(1).join(" ");
      out.push(["@evade", body]);
      for (const inner of commands(body)) out.push(inner);
    }
    const noArgs = t.slice(1).every((x) => x === "-" || x === "-s") && !seg.docs?.length;
    // `bash <<< 'cmd'`: the here-string is evaluated.
    const hs = t.findIndex((x) => x.startsWith("<<<"));
    if (hs >= 0 && (SHELLS.has(prog) || INTERPRETERS.test(prog))) {
      const body = t[hs].length > 3 ? t[hs].slice(3) : (t[hs + 1] ?? "");
      if (SHELLS.has(prog)) for (const inner of commands(body)) out.push(inner);
      out.push(["@evade", body], ["@evade-exec", body]);
    }
    if (INTERPRETERS.test(prog)) {
      const i = t.findIndex((x, n) => n > 0 && INLINE_RE.test(x));
      if (i > 0 && t[i + 1] !== undefined) {
        out.push(["@evade", t[i + 1]]);
        secretTokens(t[i + 1]);
      } else if (noArgs) out.push(["@evade", text]); // code fed on stdin
      // Heredoc code is not scanned like a shell, only for reads of secret files and exec text.
      for (const body of seg.docs ?? []) {
        out.push(["@evade-exec", body]);
        secretTokens(body);
      }
    }
    if (SHELLS.has(prog)) {
      for (const body of seg.docs ?? []) {
        for (const inner of commands(body)) out.push(inner);
      }
      const i = t.findIndex((x, n) => n > 0 && /^-[a-z]*c$/.test(x));
      if (i > 0 && t[i + 1] !== undefined) {
        for (const inner of commands(t[i + 1])) out.push(inner);
      } else if (noArgs) out.push(["@evade", text]); // script fed on stdin
    }
  }
  return out;
}

function isSecretName(name) {
  if (!name || SECRET_SAFE.has(name)) return false;
  if (name === ".env" || name.startsWith(".env.") || name === ".envrc") return true;
  if (name === ".dev.vars" || name.startsWith(".dev.vars.")) return true;
  if (/^[\w-]+\.env$/.test(name) && !/^(process|Deno|Bun)\.env$/.test(name)) return true;
  if (name.endsWith(".pem") || name === "keys.txt" || /^id_[a-z0-9]+$/.test(name)) return true;
  if (/[*?[{]/.test(name)) {
    const prefix = name.slice(0, name.search(/[*?[{]/));
    if (prefix.length >= 2 && (".env".startsWith(prefix) || ".dev.vars".startsWith(prefix)))
      return true; // `.e*`, `.en?` can expand to .env
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
  const variants = [clean, clean.slice(clean.lastIndexOf("=") + 1), clean.split(/[<>]/).pop()];
  for (const v of new Set(variants)) {
    if (isSecretName(v.slice(v.lastIndexOf("/") + 1)) || SECRET_DIR_RE.test(v.replace(/\/+$/, "")))
      return true;
  }
  return false;
}

function gitSub(t) {
  let i = 1;
  const cfg = [];
  while (i < t.length && t[i].startsWith("-")) {
    const takesValue = ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(t[i]);
    if (t[i] === "-c" && t[i + 1] !== undefined) cfg.push(t[i + 1]);
    i += takesValue ? 2 : 1;
  }
  return { sub: t[i], args: t.slice(i + 1), cfg };
}

/** Directories that hold refs: the repo's .git (or a worktree's gitdir and its common dir). */
function gitDirs(projectDir) {
  const dirs = [];
  try {
    const dot = resolve(projectDir, ".git");
    if (statSync(dot).isDirectory()) dirs.push(dot);
    else {
      const gd = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"))?.[1];
      if (gd) {
        const dir = resolve(projectDir, gd.trim());
        dirs.push(dir);
        const cd = resolve(dir, readFileSync(resolve(dir, "commondir"), "utf8").trim());
        dirs.push(cd);
      }
    }
  } catch {
    // not a git checkout, or unreadable: no known tags
  }
  return dirs;
}

/** True when `name` is an existing tag (loose ref or packed-refs); a bare push dst can be one. */
function isTagName(name, projectDir) {
  if (!name || name.includes("..") || name.startsWith("/")) return false;
  const short = name.replace(/^refs\/tags\//, "");
  for (const dir of gitDirs(projectDir)) {
    if (existsSync(resolve(dir, "refs/tags", short))) return true;
    try {
      const packed = readFileSync(resolve(dir, "packed-refs"), "utf8");
      if (packed.split("\n").some((l) => l.endsWith(` refs/tags/${short}`))) return true;
    } catch {
      // no packed-refs
    }
  }
  return false;
}

/** `main`, `master` and the branch origin/HEAD points at. */
function isDefault(name, projectDir) {
  const n = String(name)
    .replace(/^\+/, "")
    .replace(/^refs\/heads\//, "");
  if (n === "main" || n === "master") return true;
  for (const dir of gitDirs(projectDir)) {
    try {
      const head = readFileSync(resolve(dir, "refs/remotes/origin/HEAD"), "utf8");
      if (/^ref:\s*refs\/remotes\/[^/\s]+\/(.+)$/m.exec(head)?.[1].trim() === n) return true;
    } catch {
      // no origin/HEAD
    }
  }
  return false;
}

/** Branch HEAD points at, or undefined (detached, not a checkout). */
function currentBranch(projectDir) {
  const dir = gitDirs(projectDir)[0];
  try {
    return /^ref:\s*refs\/heads\/(.+)$/m
      .exec(readFileSync(resolve(dir, "HEAD"), "utf8"))?.[1]
      .trim();
  } catch {
    return undefined;
  }
}

function pushRule(args, projectDir) {
  let tag = false;
  let del = false;
  const refs = [];
  for (const a of args) {
    if (a === "--prune" || a === "--all") return "pushDefault";
    if (a === "--mirror" || a === "--force" || a.startsWith("--force-") || a.startsWith("--force="))
      return "force";
    if (/^-[A-Za-z]*f[A-Za-z]*$/.test(a)) return "force";
    if (a.startsWith("+")) return "force";
    if (a === "--tags" || a === "--follow-tags") tag = true;
    if (a === "tag" && refs.length === 1) tag = true; // `git push <remote> tag <name>`
    if (a === "--delete" || /^-[A-Za-z]*d[A-Za-z]*$/.test(a)) del = true;
    if (!a.startsWith("-")) {
      refs.push(a);
      const dst = a.slice(a.lastIndexOf(":") + 1);
      if (a.startsWith(":") && isDefault(dst, projectDir)) return "deleteDefault";
      if (dst.startsWith("refs/tags/") || isTagName(dst, projectDir)) tag = true;
      // A tag src with an unqualified dst (`tmp:name`) still pushes a tag.
      const src = a.includes(":") ? a.slice(0, a.indexOf(":")).replace(/^\+/, "") : "";
      if (src && (src.startsWith("refs/tags/") || isTagName(src, projectDir))) tag = true;
    }
  }
  if (del && refs.some((r) => isDefault(r, projectDir))) return "deleteDefault";
  if (tag) return "tag";
  // refs[0] is the remote; every later positional is a refspec whose dst must not be the default.
  for (const r of refs.slice(1)) {
    const spec = r.replace(/^\+/, "");
    if (spec.startsWith(":")) continue;
    let dst = spec.slice(spec.lastIndexOf(":") + 1);
    if (dst === "HEAD" || dst === "@") dst = currentBranch(projectDir) ?? dst;
    if (isDefault(dst, projectDir)) return "pushDefault";
  }
  // No refspec: push.default pushes the current branch.
  if (refs.length <= 1 && !del) {
    const cur = currentBranch(projectDir);
    if (cur && isDefault(cur, projectDir)) return "pushDefault";
  }
  return null;
}

/** True when the command `t` writes, moves or deletes its operand at index `i`. */
function writesTarget(t, i) {
  const tok = t[i];
  if (/^\d*>[>|]?/.test(tok) || /^&>>?/.test(tok)) return true;
  if (/^\d*>[>|]?$|^&>>?$/.test(t[i - 1] ?? "")) return true;
  const prog = base(t[0]);
  if (
    ["tee", "mv", "rm", "truncate", "touch", "chmod", "chown", "shred", "unlink", "rmdir"].includes(
      prog,
    )
  )
    return true;
  if (prog === "dd") return tok.startsWith("of=");
  if (["ex", "vi", "vim", "nvim", "ed", "patch"].includes(prog)) return true;
  if (["awk", "gawk"].includes(prog) && t.includes("inplace")) return true;
  if (["cp", "install", "ln", "rsync"].includes(prog)) {
    let last = t.length - 1;
    while (last > 0 && t[last].startsWith("-")) last--;
    return i === last;
  }
  if (prog === "git") return t.some((x) => ["rm", "mv", "checkout", "restore"].includes(x));
  return (
    (prog === "sed" || prog === "perl") &&
    t.some((x) => /^-[A-Za-z]*i/.test(x) || /^--in-place/.test(x))
  );
}

/** `gh api` that writes: a non-GET method, a body/field flag (these imply POST) or a mutation. */
function ghApiWrites(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let method;
    if (a === "-X" || a === "--method") method = args[i + 1];
    else if (a.startsWith("--method=")) method = a.slice(9);
    else if (/^-X./.test(a)) method = a.slice(2);
    if (method !== undefined && method.toUpperCase() !== "GET") return true;
    if (/^(-[fF]|--field|--raw-field|--input)(=|$)/.test(a) || /^-[fF][^-]/.test(a)) return true;
  }
  return args.includes("graphql") && args.some((a) => /\bmutation\b/i.test(a));
}

const ADMIN_API_RE =
  /\/(branches\/[^/\s]+\/protection|rulesets?|environments|actions\/(secrets|variables|permissions)|hooks|keys|collaborators|transfer|rename)\b/;

function bashRule(t, projectDir, cwd = projectDir) {
  const prog = base(t[0]);
  const args = t.slice(1);
  if (prog === "@evade") return RISKY_RE.test(t[1]) ? "evasion" : null;
  if (prog === "@evade-exec") return EXEC_RE.test(t[1]) ? "evasion" : null;
  if (["cd", "pushd"].includes(prog) || (prog === "git" && t.includes("-C"))) {
    const dirs = prog === "git" ? [t[t.indexOf("-C") + 1]] : args.filter((a) => !a.startsWith("-"));
    if (dirs.some((d) => d && guardedDir(d, projectDir, cwd))) return "protected";
  }
  if (prog === "patch" || (prog === "git" && gitSub(t).sub === "apply")) {
    // The diff names the files it writes: read it (file operand, <redirect or heredoc). Piped or
    // unreadable input cannot be checked, so it is refused; apply it from a file in the repo.
    const texts = [...(t.docs ?? [])];
    let read = texts.length > 0;
    for (const f of args.map((x) => x.replace(/^<+/, "")).filter((x) => x && !x.startsWith("-"))) {
      try {
        texts.push(readFileSync(resolve(cwd, f), "utf8"));
        read = true;
      } catch {
        // a value such as the 1 of `-p 1`, or a missing file
      }
    }
    if (!read || texts.some(patchTouchesProtected)) return "protected";
  }
  const run = args.findIndex((a) => a === "run" || a === "run-script");
  if (
    MANAGERS.has(prog) &&
    (args.some((a) => a === "publish" || a === "unpublish" || a === "dist-tag") ||
      args[0] === "release" ||
      (run >= 0 && args[run + 1] === "release"))
  )
    return "publish";
  if (
    prog === "cargo" &&
    (args.includes("publish") || args.find((a) => !a.startsWith("+")) === "release")
  )
    return "publish";
  if (
    ["make", "gmake", "just", "task"].includes(prog) &&
    args.some((a) => /^(publish|release)$/.test(a))
  )
    return "publish";
  if (prog === "changeset" && args.includes("publish")) return "publish";
  if (prog === "gh") {
    const [a0, a1] = args;
    if (a0 === "api" && ghApiWrites(args.slice(1)))
      return args.slice(1).some((a) => ADMIN_API_RE.test(a)) ? "ghAdmin" : "ghApi";
    if (a0 === "pr" && a1 === "merge") {
      if (args.includes("--admin")) return "ghMerge";
      if (!args.includes("--auto") && !args.includes("--disable-auto")) return "ghMerge";
    }
    if (a0 === "release" && ["create", "upload"].includes(a1)) return "publish";
    if (a0 === "release" && !["list", "view", "download", undefined].includes(a1)) return "ghAdmin";
    if (a0 === "workflow" && ["run", "enable", "disable"].includes(a1))
      return args.slice(2).some((a) => /release/i.test(a)) ? "publish" : null;
    if (a0 === "secret") return "ghAdmin";
    if (a0 === "repo" && ["edit", "delete", "archive", "rename", "transfer"].includes(a1))
      return "ghAdmin";
    if (a0 === "auth" && a1 === "token") return "secret";
  }
  if (prog === "git") {
    const { sub, args: rest, cfg } = gitSub(t);
    if (cfg.some((c) => /^core\.hookspath=/i.test(c))) return "protected";
    if (sub === "push" && cfg.some((c) => /^(remote\.[^=]*\.push|push\.default)=/i.test(c)))
      return "pushDefault";
    const alias = cfg
      .map((c) => /^alias\.([^=]+)=(.*)$/i.exec(c))
      .find((m) => m && m[1].toLowerCase() === String(sub).toLowerCase());
    if (alias) {
      if (alias[2].startsWith("!")) {
        for (const inner of commands(`${alias[2].slice(1)} ${rest.join(" ")}`)) {
          const r = bashRule(inner, projectDir);
          if (r) return r;
        }
        return null;
      }
      return bashRule(["git", ...split(alias[2]).flat(), ...rest], projectDir);
    }
    if (sub === "push") return pushRule(rest, projectDir);
    if (sub === "config" && rest.some((a) => /^(core\.hookspath|alias\.)/i.test(a)))
      return "protected";
    if (sub === "update-ref") {
      if (rest.some((a) => a === "--stdin" || a.startsWith("refs/tags/"))) return "tag";
      if (rest.some((a) => a.startsWith("refs/heads/") && isDefault(a, projectDir)))
        return "rewriteDefault";
    }
    if (sub === "tag" && rest.length && !TAG_READ_RE.test(rest[0])) return "tag";
    const names = rest.filter((a) => !a.startsWith("-"));
    if (
      sub === "branch" &&
      rest.some(
        (a) => /^-[A-Za-z]*[dDfmMcC][A-Za-z]*$/.test(a) || /^--(delete|force|move|copy)$/.test(a),
      ) &&
      names.some((n) => isDefault(n, projectDir))
    )
      return "rewriteDefault";
    if (
      (sub === "checkout" || sub === "switch") &&
      rest.some((a) => ["-B", "-C", "--force-create"].includes(a)) &&
      names.some((n) => isDefault(n, projectDir))
    )
      return "rewriteDefault";
    if (sub === "reset" && rest.includes("--hard")) {
      const cur = currentBranch(projectDir);
      if (cur && isDefault(cur, projectDir)) return "rewriteDefault";
    }
  }
  if (["echo", "printf"].includes(prog) && args.some((a) => SECRET_VAR_RE.test(a))) return "secret";
  if (
    prog === "printenv" &&
    (args.length === 0 || args.some((a) => /KEY|TOKEN|SECRET|PASSW|CREDENTIAL/i.test(a)))
  )
    return "secret";
  if (prog === "export" && (args.length === 0 || args.includes("-p"))) return "secret";
  if (
    (prog === "declare" || prog === "typeset") &&
    args.some((a) => /^-[a-z]*[xp]/.test(a)) &&
    args.every((a) => a.startsWith("-"))
  )
    return "secret";
  if (prog === "set" && args.length === 0) return "secret";
  if (
    prog === "sops" &&
    args.some((a) => ["-d", "--decrypt", "decrypt", "exec-env", "exec-file"].includes(a))
  )
    return "secret";
  if (prog === "age" && args.some((a) => a === "-d" || a === "--decrypt")) return "secret";
  if (prog === "hoist" && args[0] === "secrets" && args[1] === "exec") {
    const dd = args.indexOf("--");
    const inner = dd >= 0 ? args.slice(dd + 1) : args.slice(2);
    const it = stripPrefixes(inner);
    const SHELLISH = [
      "env",
      "printenv",
      "export",
      "set",
      "declare",
      "sh",
      "bash",
      "zsh",
      "dash",
      "ksh",
    ];
    if (
      inner.slice(0, 4).some((x) => SHELLISH.includes(base(x))) ||
      (INTERPRETERS.test(base(it[0] ?? "")) && it.some((a, n) => n > 0 && INLINE_RE.test(a))) ||
      /ENVIRON|environ|process\.env/.test(inner.join(" "))
    )
      return "secret";
  }
  // A token with whitespace is prose (a quoted message or label), not a file name.
  const firstOperand = t.findIndex((y, m) => m > 0 && !y.startsWith("-"));
  const files = ["grep", "egrep", "fgrep", "rg", "ag"].includes(prog)
    ? t.filter((x, n) => n === 0 || x.startsWith("-") || n > firstOperand) // the first operand is the pattern
    : t;
  if (files.some((x) => !/\s/.test(x) && secretLike(x))) return "secret";
  for (let i = 0; i < t.length; i++) {
    const x = stripTok(t[i]);
    if (LOCK_RE.test(x) && writesTarget(t, i)) return "lock";
    if (!writesTarget(t, i)) continue;
    if (isProtected(x)) return "protected";
    const real = realRel(x, projectDir, cwd);
    if (real && LOCK_RE.test(real)) return "lock";
    if (real && isProtected(real)) return "protected";
  }
  return null;
}

const GUARDED_DIR_RE = /^(\.claude(\/hooks)?|\.bosun(\/.*)?|\.github\/workflows)\/?$/i;

/** `cd`/`git -C` into a guarded dir would turn later relative writes into unguarded names. */
function guardedDir(d, projectDir, cwd) {
  const x = stripTok(d);
  return [x, realRel(x, projectDir, cwd)].some(
    (r) => r && (GUARDED_DIR_RE.test(r) || isProtected(r) || LOCK_RE.test(r)),
  );
}

/** True when a unified diff or patch writes a protected path (any `-p` strip level). */
function patchTouchesProtected(text) {
  for (const m of String(text).matchAll(
    /^(?:\+\+\+|---|diff --git|rename (?:to|from)|copy (?:to|from)|\*\*\*)[ \t]+(.*)$/gm,
  )) {
    for (const path of m[1].split(/[ \t]+/)) {
      const parts = path.replaceAll("\\", "/").split("/");
      for (let i = 0; i < parts.length; i++) {
        const sub = parts.slice(i).join("/");
        if (isProtected(sub) || LOCK_RE.test(sub)) return true;
      }
    }
  }
  return false;
}

/** Repo-relative path with symlinks resolved through the deepest existing ancestor, or undefined. */
function realRel(p, projectDir, cwd = projectDir) {
  try {
    let cur = resolve(cwd, String(p));
    const tail = [];
    while (!existsSync(cur) && dirname(cur) !== cur) {
      tail.unshift(basename(cur));
      cur = dirname(cur);
    }
    return posix.relative(realpathSync(projectDir), join(realpathSync(cur), ...tail));
  } catch {
    return undefined;
  }
}

function relPath(p, projectDir, cwd = projectDir) {
  const rel = posix.relative(
    posix.resolve(projectDir),
    posix.resolve(cwd, String(p).replaceAll("\\", "/")),
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
  const cwd = [ctx.cwd, input?.cwd].find((x) => typeof x === "string" && x) ?? ctx.projectDir;
  if (name === "Bash") {
    for (const t of commands(ti.command)) {
      const rule = bashRule(t, ctx.projectDir, cwd);
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
  const rel = relPath(target, ctx.projectDir, cwd);
  if (LOCK_RE.test(rel)) return deny("lock");
  if (isProtected(rel)) return deny("protected");
  const real = realRel(target, ctx.projectDir, cwd);
  if (real && LOCK_RE.test(real)) return deny("lock");
  if (real && isProtected(real)) return deny("protected");
  if (ctx.lockText && ownedPaths(ctx.lockText).has(rel)) {
    return { decision: "ask", reason: ownedReason(rel) };
  }
  return null;
}

/** True when a call that failed inside the guard still looks like push, publish, release or secrets. */
export function failClosed(raw) {
  return RISKY_RE.test(String(raw ?? "")) || FAIL_CLOSED_RE.test(String(raw ?? ""));
}

const emit = (decision, reason) =>
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })}\n`,
  );

function main() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
    const input = JSON.parse(raw);
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let lockText;
    try {
      lockText = readFileSync(resolve(projectDir, ".splice/lock.toml"), "utf8");
    } catch {
      lockText = undefined;
    }
    const d = decide(input, { lockText, projectDir });
    if (d) emit(d.decision, d.reason);
  } catch (err) {
    process.stderr.write(
      `guard.mjs: internal error: ${String(err?.message ?? err).split("\n")[0]}\n`,
    );
    if (failClosed(raw)) emit("deny", REASON.failClosed);
  }
}

/** Entry check, fail-safe: only a different real file (an import) skips main(). */
const isMain = () => {
  const entry = process.argv[1];
  if (!entry) return true;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
};
if (isMain()) main();
