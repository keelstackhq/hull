import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";

/** The splice release hull renders with (hull CI installs exactly this version). */
export const SPLICE_VERSION = "0.2.0";

/** `SPLICE_BIN` when set, else `pnpm dlx @keelstackhq/splice@<SPLICE_VERSION>`. */
export function spliceCommand(env = process.env) {
  return env.SPLICE_BIN
    ? [env.SPLICE_BIN]
    : ["pnpm", "dlx", `@keelstackhq/splice@${SPLICE_VERSION}`];
}

const GIT_ID = [
  "-c",
  "user.name=hull",
  "-c",
  "user.email=hull@localhost",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "tag.gpgsign=false",
];

/** Run git in `cwd` with a fixed identity; throws with git's stderr on failure. */
export function git(cwd, ...args) {
  const r = spawnSync("git", [...GIT_ID, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr || r.error}`);
  return r.stdout;
}

/**
 * Commit a copy of `template` (the working tree, uncommitted edits included) to a fresh git repo
 * under `root`, since splice reads templates from git. Returns the splice source `<repo>//<name>`,
 * where `<name>` is the template directory's name (`template`, `template-rust`).
 */
export async function snapshotTemplate(template, root) {
  const name = basename(template);
  const repo = join(root, name === "template" ? "template-src" : `${name}-src`);
  await rm(repo, { recursive: true, force: true });
  await mkdir(repo, { recursive: true });
  await cp(template, join(repo, name), { recursive: true, verbatimSymlinks: true });
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "template snapshot");
  return `${repo}//${name}`;
}

/** Arguments for `splice new` of a combo; `base` is implicit in splice. */
export function spliceNewArgs(source, dest, pieces, vars, extra = []) {
  return [
    "new",
    source,
    dest,
    "--ref",
    "HEAD",
    ...pieces.filter((p) => p !== "base").flatMap((p) => ["--piece", p]),
    ...Object.entries(vars).flatMap(([k, v]) => ["--data", `${k}=${v}`]),
    "--yes",
    "--json",
    ...extra,
  ];
}
