// Decides whether CI can skip (spec §15). Prints `skip=true` only when `git diff BASE...HEAD` is
// not empty and every changed path is documentation; anything else, an unknown base or a git
// error prints `skip=false`. Node built-ins only: the runner's preinstalled node runs it.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ZERO = /^0+$/;

/** True for paths that cannot change a build or a test. Files under crates/ never count:
 * `include_str!` and `#[doc = include_str!(…)]` can read them. Trade-off (spec §15): a crate that
 * includes a root `*.md` as doc tests gets them checked on `main`, not on a docs-only PR. */
export function isDoc(path) {
  if (path.startsWith("docs/") || path.startsWith(".claude/")) return true;
  if (path.startsWith("changelog.d/")) return true;
  if (!path.includes("/")) return path.endsWith(".md") || /^LICENSE/.test(path);
  return false;
}

/** `skip=true|false` for the changed paths (`null` when the diff is unknown). */
export function decide(paths) {
  return paths !== null && paths.length > 0 && paths.every(isDoc);
}

/** On a pull_request, actions/checkout builds the merge of the PR into the current base branch, so
 * BASE (the base sha when the PR was opened or last synchronized) is stale: `BASE...HEAD` would
 * include everything merged since. The merge commit's first parent is the current base. */
function effectiveBase(base) {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") return base;
  try {
    const parents = execFileSync("git", ["rev-list", "--parents", "-n", "1", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split(" ");
    return parents.length === 3 ? parents[1] : base;
  } catch {
    return base;
  }
}

function changed(rawBase) {
  if (!rawBase || ZERO.test(rawBase)) return null;
  const base = effectiveBase(rawBase);
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.split("\n").filter(Boolean);
  } catch {
    return null;
  }
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
  const skip = decide(changed(process.env.BASE));
  process.stdout.write(`skip=${skip}\n`);
}
