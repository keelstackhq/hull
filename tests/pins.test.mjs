import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { parsePins } from "../template-rust/pieces/base/files/scripts/pins.mjs";

const BASE = fileURLToPath(new URL("../template-rust/pieces/base/files", import.meta.url));
const CC = fileURLToPath(
  new URL("../template-rust/pieces/circleci/files/.circleci/src/jobs/ci-ok.yml", import.meta.url),
);
const read = (p) => readFile(join(BASE, p), "utf8");
const pins = parseToml(await read("pins.toml")).pins;

async function sandbox(edit = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pins-"));
  await mkdir(join(dir, "scripts"));
  for (const f of ["pins.toml", "rust-toolchain.toml", "Cargo.toml", "scripts/pins.mjs"])
    await writeFile(join(dir, f), edit[f] ?? (await read(f)));
  return dir;
}
const run = (dir, ...args) =>
  spawnSync("node", [join(dir, "scripts/pins.mjs"), ...args], { encoding: "utf8" });

test("parsePins reads only the [pins] table", () => {
  assert.deepEqual(
    parsePins('# c\n[other]\na = "1"\n[pins]\nrust = "1.2.3" # x\ncargo_deny = "0.1.0"\n'),
    {
      rust: "1.2.3",
      cargo_deny: "0.1.0",
    },
  );
});

test("pins.toml has the agreed keys", () => {
  assert.deepEqual(Object.keys(pins), [
    "rust",
    "nextest",
    "cargo_deny",
    "splice",
    "bosun",
    "hoist",
  ]);
});

test("pins.mjs prints a key, exits 2 on an unknown key", async () => {
  const d = await sandbox();
  assert.equal(run(d, "rust").stdout, `${pins.rust}\n`);
  assert.equal(run(d, "nope").status, 2);
});

test("pins.mjs --shell and --github-output", async () => {
  const d = await sandbox();
  assert.match(run(d, "--shell").stdout, new RegExp(`^PIN_RUST=${pins.rust}\\nPIN_NEXTEST=`));
  assert.match(run(d, "--github-output").stdout, new RegExp(`^rust=${pins.rust}\\nnextest=`));
});

test("pins.mjs --check passes, and fails on a drifted toolchain or rust-version; flags combine", async () => {
  const d = await sandbox();
  const ok = run(d, "--check", "--github-output");
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^rust=/);
  const bad = await sandbox({
    "rust-toolchain.toml": (await read("rust-toolchain.toml")).replace(pins.rust, "1.0.0"),
    "Cargo.toml": (await read("Cargo.toml")).replace(pins.rust, "1.0.1"),
  });
  const r = run(bad, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /channel is 1\.0\.0/);
  assert.match(r.stderr, /rust-version is 1\.0\.1/);
});

test("pins.toml equals rust-toolchain.toml, Cargo.toml and the CircleCI ci-ok.yml", async () => {
  assert.equal(parseToml(await read("rust-toolchain.toml")).toolchain.channel, pins.rust);
  assert.equal(parseToml(await read("Cargo.toml")).workspace.package["rust-version"], pins.rust);
  const cc = await readFile(CC, "utf8");
  assert.match(cc, new RegExp(`cargo-nextest-${pins.nextest.replaceAll(".", "\\.")}-x86_64`));
  assert.match(
    cc,
    new RegExp(`cargo-deny/releases/download/${pins.cargo_deny.replaceAll(".", "\\.")}/`),
  );
  assert.deepEqual(
    [...new Set(cc.match(/cargo-nextest-\d+\.\d+\.\d+/g))],
    [`cargo-nextest-${pins.nextest}`],
  );
  assert.deepEqual(
    [...new Set(cc.match(/cargo-deny-\d+\.\d+\.\d+/g))],
    [`cargo-deny-${pins.cargo_deny}`],
  );
});

test("no template-rust workflow hardcodes nextest, cargo-deny or hoist versions", async () => {
  const dirs = ["base", "circleci-only", "circleci"].map((p) =>
    fileURLToPath(new URL(`../template-rust/pieces/${p}/files/.github/workflows`, import.meta.url)),
  );
  for (const dir of dirs) {
    const names = await readdir(dir).catch(() => []);
    for (const n of names) {
      const text = await readFile(join(dir, n), "utf8");
      assert.doesNotMatch(text, /cargo-(nextest|deny)@\d/, n);
      assert.doesNotMatch(text, /HOIST_VERSION:\s*\d/, n);
      assert.doesNotMatch(text, /hoist@\d/, n);
    }
  }
});
