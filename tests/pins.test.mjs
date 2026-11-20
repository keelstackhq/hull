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
  assert.match(run(d, "--shell").stdout, new RegExp(`^PIN_RUST='${pins.rust}'\\nPIN_NEXTEST=`));
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

test("pins.mjs --check also catches drift in the sha-pinned CircleCI downloads", async () => {
  const d = await sandbox();
  await mkdir(join(d, ".circleci/src/jobs"), { recursive: true });
  const cc = await readFile(CC, "utf8");
  await writeFile(join(d, ".circleci/src/jobs/ci-ok.yml"), cc);
  assert.equal(run(d, "--check").status, 0);
  await writeFile(
    join(d, ".circleci/src/jobs/ci-ok.yml"),
    cc.replaceAll(`cargo-nextest-${pins.nextest}`, "cargo-nextest-0.0.1"),
  );
  const r = run(d, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ci-ok\.yml.*nextest 0\.0\.1/);
});

test("pins.mjs refuses a value that is not an exact X.Y.Z (no npm alias or range)", async () => {
  for (const bad of ["npm:evil@1.0.0", "^0.5.1", "0.5", "latest", "0.5.1 && x"]) {
    const d = await sandbox({
      "pins.toml": (await read("pins.toml")).replace(`hoist = "${pins.hoist}"`, `hoist = "${bad}"`),
    });
    for (const flag of ["--github-output", "--shell", "--check", "hoist"]) {
      const r = run(d, flag);
      assert.equal(r.status, 1, `${bad} ${flag}`);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /hoist .*not an exact version/);
    }
  }
});

test("pins.mjs --shell quotes each value", async () => {
  const r = run(await sandbox(), "--shell");
  assert.match(r.stdout, new RegExp(`^PIN_HOIST='${pins.hoist.replaceAll(".", "\\.")}'$`, "m"));
});

test("pins.mjs exits 1 when a key release.yml or CI reads is missing", async () => {
  const d = await sandbox({
    "pins.toml": (await read("pins.toml")).replace(/^hoist = .*\n/m, ""),
  });
  for (const flag of ["--github-output", "--shell", "--check"]) {
    const r = run(d, flag);
    assert.equal(r.status, 1, flag);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /missing pin hoist/);
  }
});

const crates = parseToml(await read("pins.toml")).crates;
const SERVICE_CARGO = (vers = crates) =>
  `[package]\nname = "svc"\n\n[dependencies]\ntokio = { version = "=${vers.tokio}", features = ["net"] }\naxum = "=${vers.axum}"\nserde = "=1.0.1"\n`;

test("pins.toml [crates] holds exact versions of the service crates, apart from [pins]", () => {
  assert.deepEqual(Object.keys(crates), ["tokio", "axum", "tower"]);
  for (const v of Object.values(crates)) assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(parsePins(`[pins]\na = "1.0.0"\n[crates]\nb-c = "2.0.0"\n`, "crates"), {
    "b-c": "2.0.0",
  });
});

test("pins.mjs --check passes a crate that pins [crates] versions, fails on a drifted pin", async () => {
  const d = await sandbox();
  await mkdir(join(d, "crates/svc"), { recursive: true });
  await writeFile(join(d, "crates/svc/Cargo.toml"), SERVICE_CARGO());
  assert.equal(run(d, "--check").status, 0);
  await writeFile(
    join(d, "crates/svc/Cargo.toml"),
    SERVICE_CARGO({ tokio: "0.0.1", axum: crates.axum }),
  );
  const r = run(d, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /crates\/svc\/Cargo\.toml pins tokio to =0\.0\.1.*=\d+\.\d+\.\d+/);
});

test("pins.mjs refuses a [crates] value that is not an exact X.Y.Z", async () => {
  const d = await sandbox({
    "pins.toml": (await read("pins.toml")).replace(`tokio = "${crates.tokio}"`, 'tokio = "^1"'),
  });
  const r = run(d, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tokio .*not an exact version/);
});

test("pins.mjs --check also checks the root Cargo.toml [workspace.dependencies] crate pins", async () => {
  const cargo = await read("Cargo.toml");
  const toml = (await read("pins.toml")).replace(/^\[crates\]\n/m, '[crates]\ntokio = "1.54.1"\n');
  const ok = await sandbox({
    "pins.toml": toml,
    "Cargo.toml": `${cargo}\n[workspace.dependencies]\ntokio = { version = "=1.54.1", features = ["rt"] }\n`,
  });
  assert.equal(run(ok, "--check").status, 0);
  const bad = await sandbox({
    "pins.toml": toml,
    "Cargo.toml": `${cargo}\n[workspace.dependencies]\ntokio = "=1.0.0"\n`,
  });
  const r = run(bad, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Cargo\.toml pins tokio to =1\.0\.0/);
});
