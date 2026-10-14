import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";

const CORE = "@voidzero-dev/vite-plus-core";

/**
 * Check that a pnpm lockfile resolves exactly one vite-plus-core and no real `vite`.
 * Reads the keys of `packages:` and `snapshots:` in every YAML document (pnpm 12 may
 * prepend an environment document), strips the `(peer)` suffix and counts each once.
 * @param {string} lockText
 * @returns {{ ok: boolean, coreVersions: string[], viteEntries: string[] }}
 */
export function checkSingleVite(lockText) {
  const keys = new Set();
  for (const doc of parseAllDocuments(lockText)) {
    const data = doc.toJS() ?? {};
    // pnpm 9+ lockfiles split package metadata (packages) from resolved variants (snapshots)
    for (const section of ["packages", "snapshots"]) {
      for (const key of Object.keys(data[section] ?? {})) {
        const paren = key.indexOf("(");
        keys.add(paren === -1 ? key : key.slice(0, paren));
      }
    }
  }
  const coreVersions = [];
  const viteEntries = [];
  for (const key of keys) {
    let at = key.indexOf("@", 1);
    if (at === -1) continue;
    let name = key.slice(0, at);
    let version = key.slice(at + 1);
    if (version.startsWith("npm:")) {
      // alias such as vite@npm:<target>@<version>: judge by the target
      const target = version.slice(4);
      at = target.indexOf("@", 1);
      if (at === -1) continue;
      name = target.slice(0, at);
      version = target.slice(at + 1);
    }
    if (name === CORE) coreVersions.push(version);
    else if (name === "vite") viteEntries.push(key);
  }
  coreVersions.sort();
  viteEntries.sort();
  return { ok: coreVersions.length === 1 && viteEntries.length === 0, coreVersions, viteEntries };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: check-single-vite.mjs <repoDir>");
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(join(dir, "pnpm-lock.yaml"), "utf8");
  } catch {
    console.error(`cannot read ${join(dir, "pnpm-lock.yaml")}`);
    process.exit(2);
  }
  const r = checkSingleVite(text);
  if (r.ok) console.log(`ok: single vite (${CORE}@${r.coreVersions[0]})`);
  else {
    console.error(
      `not a single vite: core versions [${r.coreVersions.join(", ")}], vite entries [${r.viteEntries.join(", ")}]`,
    );
    process.exit(1);
  }
}
