// Decides whether CI can skip (spec §15). Prints `skip=true` only when `git diff BASE...HEAD` is
// not empty and every changed path is documentation; anything else, an unknown base or a git
// error prints `skip=false`. Node built-ins only: the runner's preinstalled node runs it.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ZERO = /^0+$/;

/** True for paths that cannot change a build or a test. Files under crates/ never count:
 * `include_str!` and `#[doc = include_str!(…)]` can read them. Trade-off (spec §15): a crate that
 * includes a root `*.md` as doc tests gets them checked on `main`, not on a docs-only PR. */
export function isDoc(path) {
  if (path.startsWith("docs/") || path.startsWith(".claude/")) return true;
  if (!path.includes("/")) return path.endsWith(".md") || /^LICENSE/.test(path);
  return false;
}

/** `skip=true|false` for the changed paths (`null` when the diff is unknown). */
export function decide(paths) {
  return paths !== null && paths.length > 0 && paths.every(isDoc);
}

function changed(base) {
  if (!base || ZERO.test(base)) return null;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skip = decide(changed(process.env.BASE));
  process.stdout.write(`skip=${skip}\n`);
}
