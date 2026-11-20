// Reads pins.toml. Node built-ins only.
//   node scripts/pins.mjs <key>            print one value (exit 2 on an unknown key)
//   node scripts/pins.mjs --shell          PIN_RUST='1.99.1' lines for eval/source
//   node scripts/pins.mjs --github-output  key=value lines for $GITHUB_OUTPUT
//   node scripts/pins.mjs --check          exit 1 when rust-toolchain.toml or Cargo.toml disagree
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXACT = /^\d+\.\d+\.\d+$/;
export const REQUIRED = ["rust", "nextest", "cargo_deny", "splice", "bosun", "hoist"];

/** Parses the `[pins]` table: `key = "value"` lines. */
export function parsePins(text) {
  const pins = {};
  let inPins = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inPins = line === "[pins]";
      continue;
    }
    const m = inPins && /^([a-z_][a-z0-9_]*)\s*=\s*"([^"]*)"\s*(#.*)?$/.exec(line);
    if (m) pins[m[1]] = m[2];
  }
  return pins;
}

/** Problems with rust-toolchain.toml `channel` and Cargo.toml `rust-version` versus `rust`. */
export function checkRust(pins, toolchain, cargo) {
  const problems = [];
  const channel = /^\s*channel\s*=\s*"([^"]*)"/m.exec(toolchain)?.[1];
  const msrv = /^\s*rust-version\s*=\s*"([^"]*)"/m.exec(cargo)?.[1];
  if (channel !== pins.rust)
    problems.push(`rust-toolchain.toml channel is ${channel}, pins.toml rust is ${pins.rust}`);
  if (msrv !== pins.rust)
    problems.push(`Cargo.toml rust-version is ${msrv}, pins.toml rust is ${pins.rust}`);
  return problems;
}

/** CircleCI downloads are sha256-pinned per version (bump them by hand): report drift. */
export function checkCircleci(pins, text, file) {
  const problems = [];
  const want = {
    nextest: /cargo-nextest-(\d+\.\d+\.\d+)/g,
    cargo_deny: /cargo-deny-(\d+\.\d+\.\d+)/g,
  };
  for (const [key, re] of Object.entries(want)) {
    for (const [, v] of text.matchAll(re))
      if (v !== pins[key])
        problems.push(
          `${file} downloads ${key.replace("cargo_", "cargo-")} ${v}, pins.toml has ${pins[key]}`,
        );
  }
  return [...new Set(problems)];
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pins = parsePins(readFileSync(join(root, "pins.toml"), "utf8"));
  // Every key CI and release.yml read must be there: an empty output would install `latest`.
  const missing = REQUIRED.filter((k) => !(k in pins));
  if (missing.length > 0) {
    for (const k of missing) console.error(`pins: missing pin ${k} in pins.toml`);
    return 1;
  }
  // Release workflows install these with release credentials: only an exact X.Y.Z is a pin.
  const bad = Object.entries(pins).filter(([, v]) => !EXACT.test(v));
  if (bad.length > 0) {
    for (const [k, v] of bad) console.error(`pins: ${k} = "${v}" is not an exact version (X.Y.Z)`);
    return 1;
  }
  const flags = argv.filter((a) => a.startsWith("--"));
  const keys = argv.filter((a) => !a.startsWith("--"));
  let out = "";
  if (flags.includes("--check")) {
    const problems = checkRust(
      pins,
      readFileSync(join(root, "rust-toolchain.toml"), "utf8"),
      readFileSync(join(root, "Cargo.toml"), "utf8"),
    );
    for (const f of [".circleci/src/jobs/ci-ok.yml", ".circleci/config.yml"]) {
      if (existsSync(join(root, f)))
        problems.push(...checkCircleci(pins, readFileSync(join(root, f), "utf8"), f));
    }
    if (problems.length > 0) {
      for (const p of problems)
        console.error(`pins: ${p} (fix: make them equal; CircleCI urls need new sha256 sums)`);
      return 1;
    }
  }
  if (flags.includes("--shell"))
    for (const [k, v] of Object.entries(pins)) out += `PIN_${k.toUpperCase()}='${v}'\n`;
  if (flags.includes("--github-output"))
    for (const [k, v] of Object.entries(pins)) out += `${k}=${v}\n`;
  for (const k of keys) {
    if (!(k in pins)) {
      console.error(`pins: unknown key ${k}`);
      return 2;
    }
    out += `${pins[k]}\n`;
  }
  process.stdout.write(out);
  return 0;
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main(process.argv.slice(2));
