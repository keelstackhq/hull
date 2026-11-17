#!/usr/bin/env node
// Writes THIRD_PARTY_LICENSES.md and third-party-licenses.json: the license of every dependency in
// pnpm-lock.yaml (`pnpm licenses list`, needs `pnpm install`) and Cargo.lock (`cargo metadata`).
// Sorted, no timestamps: a diff shows only real changes. `--check` needs no install: it exits 1
// when a lockfile or this script changed since the list was written (the JSON records sha256s).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const JSON_FILE = "third-party-licenses.json";
const MD_FILE = "THIRD_PARTY_LICENSES.md";
const LOCKS = ["pnpm-lock.yaml", "Cargo.lock"];
const FIX = `run \`node scripts/licenses.mjs\` (after installing) and commit ${MD_FILE} and ${JSON_FILE}`;

const sha = (f) =>
  createHash("sha256").update(readFileSync(f, "utf8").replaceAll("\r\n", "\n")).digest("hex");
const lockHashes = () => Object.fromEntries(LOCKS.filter(existsSync).map((f) => [f, sha(f)]));
const inputs = () => ({
  ...lockHashes(),
  "scripts/licenses.mjs": sha(fileURLToPath(import.meta.url)),
});
const fail = (msg) => {
  process.stderr.write(`licenses: ${msg}; ${FIX}\n`);
  process.exit(1);
};
// pnpm is a .cmd on Windows, which execFileSync starts only through a shell (args are constant).
function run(cmd, args) {
  try {
    const shell = process.platform === "win32";
    return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, shell });
  } catch (e) {
    const why = e.code === "ENOENT" ? "not found" : `failed (${(e.stderr ?? "").trim()})`;
    fail(`\`${cmd} ${args.join(" ")}\` ${why}`);
  }
}
const license = (l) => (typeof l === "string" && l && !/^unknown$/i.test(l) ? l : "UNKNOWN");

// Platform builds (lockfile `packages` entries with cpu/os/libc) mapped to the package that lists
// them under `optionalDependencies` in `snapshots`. pnpm installs only this machine's, so they
// are listed from the lockfile with the parent's license: the same list on every machine.
export function platformBuilds(text) {
  const builds = new Map();
  const parentOf = new Map();
  let section = "";
  let key = "";
  let optional = false;
  const nameOf = (k) => k.slice(0, k.indexOf("@", 1));
  // the last YAML doc: pnpm 12 puts the packageManager env (pnpm's own builds) in a first one
  for (const line of text
    .split(/^---\r?$/m)
    .at(-1)
    .split(/\r?\n/)) {
    let m;
    if (/^\S/.test(line)) section = line.replace(/:.*$/, "");
    else if ((m = /^  '?([^' ][^']*?)'?:$/.exec(line))) [key, optional] = [m[1], false];
    else if (/^    \S/.test(line)) {
      optional = line === "    optionalDependencies:";
      if (section === "packages" && /^    (cpu|os|libc):/.test(line)) builds.set(key, null);
    } else if (optional && (m = /^      '?([^':]+)'?: ([^(\s]+)/.exec(line))) {
      const child = `${m[1]}@${m[2]}`;
      if (!parentOf.has(child)) parentOf.set(child, nameOf(key));
    }
  }
  // no parent (a direct optional dep, an os-restricted dep): pnpm's own entry stays
  return new Map(
    [...builds.keys()].filter((k) => parentOf.has(k)).map((k) => [k, parentOf.get(k)]),
  );
}

function npmPackages() {
  if (!existsSync("node_modules/.modules.yaml")) fail("node_modules is missing: run pnpm install");
  const builds = platformBuilds(readFileSync("pnpm-lock.yaml", "utf8"));
  // direct: name@version from a workspace package's manifest; a local (file:) dep by name
  const direct = new Set();
  const local = new Set();
  for (const p of JSON.parse(run("pnpm", ["ls", "-r", "--json", "--depth", "0"])))
    for (const k of ["dependencies", "devDependencies"])
      for (const [n, d] of Object.entries(p[k] ?? {}))
        (direct.add(`${n}@${d.version}`), local.add(n));
  const out = new Map();
  for (const dev of [false, true]) {
    const text = run("pnpm", ["licenses", "list", "--json", dev ? "--dev" : "--prod"]);
    const byLicense = text.trim().startsWith("{") ? JSON.parse(text) : {};
    for (const list of Object.values(byLicense))
      for (const p of list)
        for (const v of p.versions) {
          const version = v ?? "local";
          const key = `${p.name}@${version}`;
          if (out.has(key) || builds.has(key)) continue;
          const source = p.homepage ?? "";
          const lic = license(p.license);
          out.set(key, {
            ecosystem: "npm",
            name: p.name,
            version,
            license: lic,
            source,
            direct: direct.has(key) || (v == null && local.has(p.name)),
            dev,
          });
        }
  }
  const byName = new Map([...out.values()].map((p) => [p.name, p]));
  for (const [key, parent] of builds) {
    const of = byName.get(parent);
    const at = key.indexOf("@", 1);
    out.set(key, {
      ecosystem: "npm",
      name: key.slice(0, at),
      version: key.slice(at + 1),
      license: of?.license ?? "UNKNOWN",
      source: `platform build of ${parent}`,
      direct: false,
      dev: of?.dev ?? true,
    });
  }
  return [...out.values()];
}

// prod = reachable from a workspace member without a dev-dependency edge; the rest is dev.
function cargoPackages() {
  const m = JSON.parse(run("cargo", ["metadata", "--format-version", "1", "--locked"]));
  const members = new Set(m.workspace_members);
  const nodes = new Map(m.resolve.nodes.map((n) => [n.id, n]));
  const reach = (prodOnly) => {
    const seen = new Set(members);
    const stack = [...members];
    while (stack.length)
      for (const d of nodes.get(stack.pop())?.deps ?? []) {
        if (prodOnly && d.dep_kinds.every((k) => k.kind === "dev")) continue;
        if (!seen.has(d.pkg)) (seen.add(d.pkg), stack.push(d.pkg));
      }
    return seen;
  };
  const prod = reach(true);
  const all = reach(false);
  const direct = new Set(
    [...members].flatMap((id) => (nodes.get(id)?.deps ?? []).map((d) => d.pkg)),
  );
  return m.packages
    .filter((p) => all.has(p.id) && !members.has(p.id))
    .map((p) => ({
      ecosystem: "cargo",
      name: p.name,
      version: p.version,
      license:
        p.license_file && !p.license ? `LicenseRef-file:${p.license_file}` : license(p.license),
      source: p.repository ?? p.source ?? "",
      direct: direct.has(p.id),
      dev: !prod.has(p.id),
    }));
}

const cell = (s) => String(s).replaceAll("|", "\\|");
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function markdown(locks, packages) {
  const counts = new Map();
  for (const p of packages) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);
  const yn = (b) => (b ? "yes" : "no");
  return [
    "# Third-party licenses",
    "",
    `Generated by \`node scripts/licenses.mjs\` from ${Object.keys(locks).join(", ") || "no lockfile"}; do not edit.`,
    `Machine-readable: \`${JSON_FILE}\`. Dev: only needed to build or test. UNKNOWN: no license declared.`,
    "",
    "| License | Packages |",
    "| ------- | -------- |",
    ...[...counts].sort((a, b) => cmp(a[0], b[0])).map(([l, n]) => `| ${cell(l)} | ${n} |`),
    "",
    "| Ecosystem | Name | Version | License | Direct | Dev | Source |",
    "| --------- | ---- | ------- | ------- | ------ | --- | ------ |",
    ...packages.map(
      (p) =>
        `| ${p.ecosystem} | ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license)} | ${yn(p.direct)} | ${yn(p.dev)} | ${cell(p.source)} |`,
    ),
    "",
  ].join("\n");
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
if (!isMain()) {
  // imported (tests): export only
} else if (process.argv.includes("--check")) {
  const locks = lockHashes();
  let recorded = null;
  try {
    recorded = JSON.parse(readFileSync(JSON_FILE, "utf8")).inputs;
  } catch {}
  const fresh = Object.keys(locks).length === 0 && recorded === null;
  if (!fresh && (JSON.stringify(recorded) !== JSON.stringify(inputs()) || !existsSync(MD_FILE))) {
    process.stdout.write(`${MD_FILE} is stale (a lockfile or the script changed); ${FIX}\n`);
    process.exitCode = 1;
  }
} else {
  const locks = lockHashes();
  const packages = [
    ...(locks["pnpm-lock.yaml"] ? npmPackages() : []),
    ...(locks["Cargo.lock"] ? cargoPackages() : []),
  ].sort(
    (a, b) => cmp(a.ecosystem, b.ecosystem) || cmp(a.name, b.name) || cmp(a.version, b.version),
  );
  // every license UNKNOWN means nothing was read (e.g. a broken install), not a real answer
  for (const eco of ["npm", "cargo"]) {
    const list = packages.filter((p) => p.ecosystem === eco);
    if (list.length > 1 && list.every((p) => p.license === "UNKNOWN"))
      fail(`every ${eco} license is UNKNOWN; is the install complete?`);
  }
  const note = `generated by scripts/licenses.mjs; do not edit; ${FIX.replace("run", "to refresh, run")}`;
  writeFileSync(JSON_FILE, `${JSON.stringify({ note, inputs: inputs(), packages }, null, 2)}\n`);
  writeFileSync(MD_FILE, markdown(locks, packages));
  const unknown = packages.filter((p) => p.license === "UNKNOWN");
  if (unknown.length)
    process.stderr.write(
      `warning: ${unknown.length} dependencies declare no license (listed as UNKNOWN): ${unknown.map((p) => `${p.name}@${p.version}`).join(", ")}\n`,
    );
}
