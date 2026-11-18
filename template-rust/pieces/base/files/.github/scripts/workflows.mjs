#!/usr/bin/env node
// Parses every .github/workflows/*.yml|yaml and exits 1 on a syntax error or a duplicate key:
// GitHub skips a workflow it cannot parse without failing any check. Uses the `yaml` package
// (zero dependencies) from its registry tarball, pinned by version and integrity; Node built-ins
// otherwise. HULL_YAML_DIR names an unpacked yaml package instead (tests, offline);
// HULL_YAML_URL overrides the tarball URL (tests). A failed
// download warns and exits 0, like the turbo step; an integrity mismatch fails.
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export const YAML_VERSION = "2.9.1";
// dist.integrity of yaml-2.9.1.tgz on registry.npmjs.org (npm view yaml@2.9.1), 2026-11-18
export const YAML_INTEGRITY =
  "sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==";

/** npm-style integrity string of a buffer. */
export const integrity = (buf) => `sha512-${createHash("sha512").update(buf).digest("base64")}`;

/** Unpack the regular files of a ustar archive under `dest`; names leaving `dest` are skipped. */
export function untar(buf, dest) {
  const root = resolve(dest);
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (at, n) =>
      h
        .subarray(at, at + n)
        .toString("utf8")
        .replace(/\0[\s\S]*$/, "");
    const name = [str(345, 155), str(0, 100)].filter(Boolean).join("/");
    const size = Number.parseInt(str(124, 12).trim() || "0", 8);
    const type = str(156, 1);
    // pax and GNU long-name entries would rename the next file: fail loudly on a version bump
    if (["x", "g", "L", "K"].includes(type)) throw new Error(`tar: unsupported entry type ${type}`);
    off += 512;
    const path = resolve(root, name);
    if ((type === "0" || type === "") && path.startsWith(root + sep)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buf.subarray(off, off + size));
    }
    off += Math.ceil(size / 512) * 512;
  }
}

/** One line per workflow that does not parse as exactly one YAML document with unique keys. */
export function problems(yaml, root = process.cwd()) {
  const dir = join(root, ".github/workflows");
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => /\.ya?ml$/.test(n));
  } catch {
    return []; // no workflows
  }
  const out = [];
  for (const n of names.sort()) {
    const docs = [...yaml.parseAllDocuments(readFileSync(join(dir, n), "utf8"))];
    const errors = docs.flatMap((d) => d.errors.map((e) => e.message.split("\n")[0]));
    if (!errors.length && docs.length !== 1) errors.push(`${docs.length} YAML documents, want 1`);
    for (const e of errors) out.push(`.github/workflows/${n}: ${e}`);
  }
  return out;
}

async function loadYaml() {
  let dir = process.env.HULL_YAML_DIR;
  if (!dir) {
    const url =
      process.env.HULL_YAML_URL ?? `https://registry.npmjs.org/yaml/-/yaml-${YAML_VERSION}.tgz`;
    let tgz;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      tgz = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.log(`::warning::workflows: could not download yaml ${YAML_VERSION} (${err.message})`);
      return null;
    }
    if (integrity(tgz) !== YAML_INTEGRITY) throw new Error(`${url}: integrity mismatch`);
    const out = mkdtempSync(join(tmpdir(), "yaml-"));
    untar(gunzipSync(tgz), out);
    dir = join(out, "package");
  }
  const mod = await import(pathToFileURL(join(dir, "dist/index.js")).href);
  return mod.parseAllDocuments ? mod : mod.default;
}

/** Entry check, fail-safe: only a different real file (an import) skips the run. */
const isMain = () => {
  const entry = process.argv[1];
  if (!entry) return true;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
};
if (isMain()) {
  const lib = await loadYaml();
  if (lib) {
    const found = problems(lib);
    for (const p of found) console.log(`::error::${p}`);
    if (found.length) process.exit(1);
    console.log("workflows: every .github/workflows file parses");
  }
}
