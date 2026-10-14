// Decides whether CI can skip. Reads `turbo query affected --tasks ...` JSON on stdin and prints
// `skip=true` or `skip=false`. Turbo is package based: any root file change marks the root package
// `//` affected, which would make docs-only PRs install everything. So root tasks are ignored here
// and the root counts as affected only when a root config file changed (git diff BASE...HEAD).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Keep in sync with the `//#format:check` inputs in turbo.json (a subset: docs and AI files are
// formatted by `pnpm format:check` locally and in full runs, but never trigger a run alone).
export const ROOT_TRIGGERS = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "turbo.json",
  "tsconfig.base.json",
  "vite.config.ts",
  ".node-version",
  ".npmrc",
];

// Anything under these prefixes (workflows, scripts) also forces a run.
export const ROOT_PREFIXES = [".github/"];

/** True when CI must run. */
export function decide(turboJson, changedFiles) {
  const items = turboJson?.data?.affectedTasks?.items ?? [];
  if (items.some((t) => t.package?.name !== "//")) return true;
  return changedFiles.some(
    (f) => ROOT_TRIGGERS.includes(f) || ROOT_PREFIXES.some((p) => f.startsWith(p)),
  );
}

function main() {
  try {
    const turbo = JSON.parse(readFileSync(0, "utf8"));
    const base = process.env.TURBO_SCM_BASE;
    const head = process.env.TURBO_SCM_HEAD || "HEAD";
    const changed = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    console.log(`skip=${!decide(turbo, changed)}`);
  } catch (e) {
    console.error(`::warning::affected.mjs failed (${e.message}); running everything`);
    console.log("skip=false");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
