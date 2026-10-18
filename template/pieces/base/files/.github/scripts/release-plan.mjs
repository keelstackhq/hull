// Release plan for a pushed tag `<instance>-v<semver>`: which package to release and how.
// Reads GITHUB_REF_NAME, prints `kind=`, `dir=`, `package=`, `bin=`, `version=`, `npm_dirs=` lines for
// $GITHUB_OUTPUT; exit 1 with the reason on stderr when nothing may publish. Node built-ins only.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TAG_RE = /^(.+)-v(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/;

const PRIMARY = new Set(["rust-cli", "ts-lib"]);
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * Values of `name` and `version` in the `[package]` table and the first `[[bin]]` name.
 * @param {string} text Cargo.toml text
 */
function cargoInfo(text) {
  /** @type {Record<string, Record<string, string>>} */
  const tables = {};
  let table = "";
  for (const line of text.split("\n")) {
    const header = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(line);
    if (header) {
      table = header[1].trim();
      continue;
    }
    const kv = /^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/.exec(line);
    if (kv && !(tables[table] ?? {})[kv[1]]) (tables[table] ??= {})[kv[1]] = kv[2];
  }
  const pkg = tables.package ?? {};
  return { name: pkg.name, version: pkg.version, bin: tables.bin?.name ?? pkg.name };
}

/**
 * @param {{ read(rel: string): string | null }} fs
 * @param {string} rel
 * @returns {any}
 */
function readJson(fs, rel) {
  const text = fs.read(rel);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${rel} is not valid JSON`);
  }
}

/** @param {any} pkg */
const binOf = (pkg) => Object.keys(pkg?.bin ?? {})[0] ?? "";

/**
 * @param {string} tag
 * @param {string} version
 * @param {string} file
 * @param {string | undefined} found
 */
function sameVersion(tag, version, file, found) {
  if (found !== version)
    throw new Error(`tag ${tag} is version ${version} but ${file} has ${found}`);
}

/**
 * Decide what a release tag publishes.
 * @param {string} tag e.g. `cli-v1.2.0`
 * @param {{ read(rel: string): string | null, list(rel: string): string[] }} fs paths relative to the repo root
 * @returns {{ kind: "rust-cli" | "ts-lib", dir: string, package: string, bin: string, version: string, npm_dirs: string[] }}
 */
export function plan(tag, fs) {
  const m = TAG_RE.exec(tag);
  if (!m || !SAFE_NAME.test(m[1])) throw new Error(`unknown tag ${tag}`);
  const [, instance, version] = m;

  const candidates = [`crates/${instance}`, `packages/${instance}`]
    .map((dir) => ({ dir, pkg: readJson(fs, `${dir}/package.json`) }))
    .filter((c) => typeof c.pkg?.hull?.release === "string");
  const primaries = candidates.filter((c) => PRIMARY.has(c.pkg.hull.release));
  if (primaries.length > 1) throw new Error(`ambiguous: ${primaries.map((c) => c.dir).join(", ")}`);
  const primary = primaries[0];

  if (!primary) {
    const npm = candidates.find((c) => c.pkg.hull.release === "npm-cli");
    if (npm) {
      throw new Error(
        `${npm.dir} is an npm-cli package: push ${binOf(npm.pkg)}-v${version} to release it with its crate`,
      );
    }
    throw new Error(`unknown tag ${tag}`);
  }

  if (primary.pkg.hull.release === "ts-lib") {
    sameVersion(tag, version, `${primary.dir}/package.json`, primary.pkg.version);
    return {
      kind: "ts-lib",
      dir: primary.dir,
      package: "",
      bin: "",
      version,
      npm_dirs: [primary.dir],
    };
  }

  const cargoFile = `${primary.dir}/Cargo.toml`;
  const cargo = fs.read(cargoFile);
  if (cargo === null) throw new Error(`${cargoFile} is missing`);
  const info = cargoInfo(cargo);
  sameVersion(tag, version, cargoFile, info.version);
  const bin = info.bin ?? instance;

  for (const c of candidates) {
    if (c.pkg.hull.release === "npm-cli" && binOf(c.pkg) !== bin) {
      throw new Error(`ambiguous: ${primary.dir}, ${c.dir} (bin ${binOf(c.pkg)}, not ${bin})`);
    }
  }
  const npmDirs = [];
  for (const name of [...fs.list("packages")].sort()) {
    if (!SAFE_NAME.test(name)) continue;
    const dir = `packages/${name}`;
    const pkg = readJson(fs, `${dir}/package.json`);
    if (pkg?.hull?.release !== "npm-cli" || binOf(pkg) !== bin) continue;
    sameVersion(tag, version, `${dir}/package.json`, pkg.version);
    npmDirs.push(dir);
  }
  return {
    kind: "rust-cli",
    dir: primary.dir,
    package: info.name ?? instance,
    bin,
    version,
    npm_dirs: npmDirs,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd();
  const fs = {
    /** @param {string} rel */
    read(rel) {
      try {
        return readFileSync(join(root, rel), "utf8");
      } catch {
        return null;
      }
    },
    /** @param {string} rel */
    list(rel) {
      try {
        return readdirSync(join(root, rel), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        return [];
      }
    },
  };
  try {
    const p = plan(process.env.GITHUB_REF_NAME ?? "", fs);
    process.stdout.write(
      `kind=${p.kind}\ndir=${p.dir}\npackage=${p.package}\nbin=${p.bin}\nversion=${p.version}\nnpm_dirs=${JSON.stringify(p.npm_dirs)}\n`,
    );
  } catch (e) {
    process.stderr.write(`release-plan: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
