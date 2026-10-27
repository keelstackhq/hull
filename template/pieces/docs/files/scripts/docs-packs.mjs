#!/usr/bin/env node
// Report which docspack packs listed in docs/packs.json are installed. Read-only: never edits files.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Ask npm whether a package exists. `unpublished` only on a 404; any other failure is `unknown`.
 * @param {string} name
 * @param {typeof spawnSync} [run] injectable for tests
 * @returns {"published" | "unpublished" | "unknown" | "invalid"}
 */
export function lookupPublished(name, run = spawnSync) {
  if (!NAME_RE.test(name)) return "invalid";
  const r = run("npm", ["view", "--", name, "version"], { encoding: "utf8", timeout: 15000 });
  if (r.error) return "unknown";
  if (r.status === 0) return r.stdout?.trim() ? "published" : "unknown";
  return /E404|ENOTFOUND|404 Not Found/.test(r.stderr ?? "") ? "unpublished" : "unknown";
}

/**
 * @param {Record<string, { package: string, source: string, build?: string, recipe?: string }>} packs
 * @param {Set<string>} installed
 * @param {{ unpublished?: Set<string> }} [opts] package names npm answered 404 for (--online)
 * @returns {{ tool: string, package: string, state: "installed" | "missing" | "unpublished" | "invalid" }[]}
 */
export function docsPacksReport(packs, installed, opts = {}) {
  return Object.entries(packs).map(([tool, p]) => {
    let state = "missing";
    if (!NAME_RE.test(p.package)) state = "invalid";
    else if (installed.has(p.package)) state = "installed";
    else if (opts.unpublished?.has(p.package)) state = "unpublished";
    return { tool, package: p.package, state };
  });
}

function main(argv) {
  const root = process.cwd();
  const online = argv.includes("--online");
  const doc = JSON.parse(readFileSync(join(root, "docs/packs.json"), "utf8"));
  const packs = doc.packs ?? {};
  const installed = new Set(
    Object.values(packs)
      .map((p) => p.package)
      .filter(
        (name) =>
          NAME_RE.test(name) && existsSync(join(root, "node_modules", name, "package.json")),
      ),
  );
  const unpublished = new Set();
  if (online) {
    for (const p of Object.values(packs)) {
      if (!installed.has(p.package) && lookupPublished(p.package) === "unpublished") {
        unpublished.add(p.package);
      }
    }
  }
  for (const r of docsPacksReport(packs, installed, { unpublished })) {
    const note =
      r.state === "missing"
        ? `  run: pnpm add -D ${r.package}`
        : r.state === "unpublished"
          ? "  not on npm yet; see the pack's source in docs/packs.json"
          : r.state === "invalid"
            ? "  invalid package name in docs/packs.json"
            : "";
    console.log(`${r.state.padEnd(11)} ${r.tool} (${r.package})${note}`);
  }
}

/** True when this file is the entry script; symlink-safe (Node resolves import.meta.url). */
const isMain = () => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (isMain()) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.log(`docs:packs: ${e.message}`);
  }
}
