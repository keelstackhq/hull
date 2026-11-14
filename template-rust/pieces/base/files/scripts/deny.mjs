#!/usr/bin/env node
// `cargo deny` with a local overlay: deny.toml is owned (splice update rewrites it), so licenses a
// repo needs beyond the template's list go in the seed `deny.local.toml` next to it:
//   [licenses]
//   allow = ["MPL-2.0"]
// This script merges that allow list into a temporary copy of deny.toml and runs
// `cargo deny --config <copy> <args>`. Without deny.local.toml it runs `cargo deny <args>` as is.
// Usage: node scripts/deny.mjs [cargo deny args]  (an explicit --config <file> is honoured).
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

/** Licenses the overlay allows; throws for anything else, which cannot be merged here. */
function overlayAllow(local) {
  const lines = local.split("\n").map((l) => l.replace(/#.*$/, "").trim());
  const rest = lines.filter((l) => l && l !== "[licenses]");
  const body = rest.join("\n");
  const fail = () => {
    throw new Error(
      "deny.local.toml: only `[licenses]` with `allow = [\"...\"]` is merged; edit deny.toml for the rest",
    );
  };
  if (!body) return [];
  const m = body.match(/^allow\s*=\s*\[([^\]]*)\]$/);
  if (!m) return fail();
  const names = quoted(m[1]);
  if (m[1].replace(/[\s,]/g, "") !== "" && names.length === 0) fail();
  return names;
}

/** `deny.toml` text with the overlay's licenses appended to `[licenses] allow`. */
export function mergeAllow(base, local) {
  const extra = overlayAllow(local).filter((l) => !quoted(base.match(ALLOW)?.[1] ?? "").includes(l));
  if (extra.length === 0) return base;
  const m = base.match(ALLOW);
  if (!m) throw new Error("deny.toml has no `allow = [...]` list to extend");
  const inner = m[1].replace(/[\s,]+$/, "");
  const sep = inner.trim() === "" ? "" : ", ";
  const list = extra.map((l) => `"${l}"`).join(", ");
  return base.replace(ALLOW, () => `allow = [${inner}${sep}${list}]`);
}

/** Splits `--config <file>` out of the arguments. */
function configOf(args) {
  const i = args.indexOf("--config");
  if (i === -1 || i === args.length - 1) return { file: "deny.toml", rest: args };
  return { file: args[i + 1], rest: [...args.slice(0, i), ...args.slice(i + 2)] };
}

function main(args) {
  const { file, rest } = configOf(args);
  const local = join(dirname(resolve(file)), "deny.local.toml");
  let cmd = ["deny", ...args];
  let tmp = null;
  if (existsSync(file) && existsSync(local)) {
    tmp = mkdtempSync(join(tmpdir(), "deny-"));
    const merged = join(tmp, "deny.toml");
    writeFileSync(merged, mergeAllow(readFileSync(file, "utf8"), readFileSync(local, "utf8")));
    cmd = ["deny", "--config", merged, ...rest];
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
