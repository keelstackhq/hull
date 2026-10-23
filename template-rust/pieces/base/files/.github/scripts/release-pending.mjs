// Release helper for release.yml (spec §15). Node built-ins only; runs on every runner's node.
//   node .github/scripts/release-pending.mjs detect          → pending=true|false, packages=[…]
//   node .github/scripts/release-pending.mjs stage <target>  → copies each workspace binary to
//                                                              dist/<bin>-<target>[.exe]
// `detect` uses hoist's rules: a crate is a package unless `publish` is false or empty or it has
// no `version`; tags are `[release] tag_format` from hoist.toml, else `{name}@{version}` (a
// virtual workspace); a package is pending when its tag is missing or points at HEAD.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Value of a TOML string, boolean or (single- or multi-line) array of strings; else undefined. */
function value(v) {
  if (v.startsWith('"') || v.startsWith("'")) return v.slice(1, v.indexOf(v[0], 1));
  if (v === "true" || v === "false") return v === "true";
  if (v.startsWith("[")) return [...v.matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2]);
  return undefined;
}

/** Top-level `key = value` pairs of one `[table]` of a TOML file (strings, booleans, arrays).
 * Dotted keys stay dotted (`version.workspace`). Enough for Cargo.toml and hoist.toml. */
export function tomlTable(text, table) {
  const out = {};
  let inside = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, "").trim();
    if (line.startsWith("[") && !/^\[[^\]]*=/.test(line)) {
      inside = line === `[${table}]`;
      continue;
    }
    if (!inside) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!m) continue;
    let v = m[2].trim();
    // a multi-line array: join lines up to the closing bracket
    while (v.startsWith("[") && !v.includes("]") && i + 1 < lines.length) {
      v += ` ${lines[++i].replace(/\s+#.*$/, "").trim()}`;
    }
    const parsed = value(v);
    if (parsed !== undefined) out[m[1]] = parsed;
  }
  return out;
}

/** Crate directories from `[workspace] members` (`dir/*` globs and plain paths) minus `exclude`;
 * entries without a Cargo.toml are skipped. */
export function memberDirs(root) {
  const ws = tomlTable(readFileSync(join(root, "Cargo.toml"), "utf8"), "workspace");
  const exclude = new Set(ws.exclude ?? []);
  const dirs = [];
  for (const m of ws.members ?? []) {
    const found = [];
    if (m.endsWith("/*")) {
      const parent = m.slice(0, -2);
      if (existsSync(join(root, parent))) {
        for (const name of readdirSync(join(root, parent)).sort()) found.push(`${parent}/${name}`);
      }
    } else {
      found.push(m);
    }
    for (const d of found) {
      if (!exclude.has(d) && existsSync(join(root, d, "Cargo.toml"))) dirs.push(d);
    }
  }
  return dirs;
}

/** Publishable packages `{ name, version, tag }` of the workspace at `root`. */
export function packages(root) {
  const hoist = join(root, "hoist.toml");
  const format =
    (existsSync(hoist) && tomlTable(readFileSync(hoist, "utf8"), "release").tag_format) ||
    "{name}@{version}";
  const shared = tomlTable(readFileSync(join(root, "Cargo.toml"), "utf8"), "workspace.package");
  const out = [];
  for (const dir of memberDirs(root)) {
    const pkg = tomlTable(readFileSync(join(root, dir, "Cargo.toml"), "utf8"), "package");
    if (pkg["version.workspace"] === true) pkg.version = shared.version;
    const unpublished =
      pkg.publish === false || (Array.isArray(pkg.publish) && pkg.publish.length === 0);
    if (unpublished || typeof pkg.version !== "string" || !pkg.name) continue;
    const tag = format.replace("{name}", pkg.name).replace("{version}", pkg.version);
    out.push({ name: pkg.name, version: pkg.version, tag });
  }
  return out;
}

/** The packages that still need a release; `tagSha(tag)` is the tag's commit or null. */
export function pending(pkgs, tagSha, head) {
  return pkgs.filter((p) => {
    const sha = tagSha(p.tag);
    return sha === null || sha === head;
  });
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function tagSha(tag) {
  try {
    return git("rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`);
  } catch {
    return null;
  }
}

function stage(target) {
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  const ext = target.includes("windows") ? ".exe" : "";
  mkdirSync("dist", { recursive: true });
  for (const p of meta.packages) {
    for (const t of p.targets.filter((x) => x.kind.includes("bin"))) {
      const from = join("target", target, "release", `${t.name}${ext}`);
      const to = join("dist", `${t.name}-${target}${ext}`);
      copyFileSync(from, to);
      process.stdout.write(`${to}\n`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "detect") {
    const list = pending(packages("."), tagSha, git("rev-parse", "HEAD"));
    process.stdout.write(`pending=${list.length > 0}\npackages=${JSON.stringify(list)}\n`);
  } else if (cmd === "stage" && arg) {
    stage(arg);
  } else {
    process.stderr.write("usage: release-pending.mjs detect | stage <target>\n");
    process.exit(2);
  }
}
