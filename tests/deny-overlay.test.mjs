import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("../template/pieces/base/files/scripts/deny.mjs", import.meta.url),
);
const { mergeAllow, mergeOverlay } = await import(SCRIPT);

const BASE = `[licenses]
allow = ["MIT", "ISC"]
private = { ignore = true }

[bans]
multiple-versions = "allow"
`;

test("mergeAllow appends the overlay's licenses once, keeping the rest of the file", () => {
  const local = `# extra\n[licenses]\nallow = ["MPL-2.0", "MIT"] # why\n`;
  const out = mergeAllow(BASE, local);
  assert.match(out, /^allow = \["MIT", "ISC", "MPL-2\.0"\]$/m);
  assert.match(out, /private = \{ ignore = true \}/);
  assert.match(out, /\[bans\]/);
});

test("mergeAllow handles a multi-line base list and an empty overlay", () => {
  const base = `[licenses]\nallow = [\n  "MIT",\n  "ISC",\n]\n`;
  assert.match(mergeAllow(base, `[licenses]\nallow = ["Zlib"]\n`), /"MIT",\s*"ISC",?\s*"Zlib"/);
  assert.equal(mergeAllow(BASE, `[licenses]\nallow = []\n`), BASE);
  assert.equal(mergeAllow(BASE, ""), BASE);
});

test("mergeAllow rejects an overlay with a table it cannot merge", () => {
  assert.throws(
    () => mergeAllow(BASE, `[bans]\nmultiple-versions = "deny"\n`),
    /deny\.local\.toml/,
  );
});

async function shim() {
  const bin = await mkdtemp(join(tmpdir(), "deny-bin-"));
  const log = join(bin, "log.txt");
  await writeFile(
    join(bin, "cargo"),
    `#!/bin/sh\necho "$@" > "${log}"\ni=0; for a in "$@"; do i=$((i+1)); if [ "$a" = --config ]; then shift $i; cat "$1" >> "${log}"; break; fi; done\n`,
  );
  await chmod(join(bin, "cargo"), 0o755);
  return { bin, log };
}
const CLEAN = { ...process.env };
for (const k of [
  "GITHUB_EVENT_NAME",
  "CIRCLECI",
  "CIRCLE_PULL_REQUEST",
  "CIRCLE_BRANCH",
  "DENY_DEFAULT_BRANCH",
])
  delete CLEAN[k];
const run = (cwd, bin, args, env = {}) =>
  execFileSync("node", [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...CLEAN, PATH: `${bin}:${process.env.PATH}`, ...env },
  });
const future = "2999-01-01";

test("deny.mjs: without deny.local.toml it runs cargo deny with the arguments unchanged", async () => {
  const { bin, log } = await shim();
  const d = await mkdtemp(join(tmpdir(), "deny-proj-"));
  await writeFile(join(d, "deny.toml"), BASE);
  run(d, bin, ["--locked", "check", "bans", "licenses", "sources"]);
  assert.equal((await readFile(log, "utf8")).trim(), "deny --locked check bans licenses sources");
});

test("deny.mjs: with deny.local.toml it passes a merged --config", async () => {
  const { bin, log } = await shim();
  const d = await mkdtemp(join(tmpdir(), "deny-proj-"));
  await writeFile(join(d, "deny.toml"), BASE);
  await writeFile(join(d, "deny.local.toml"), `[licenses]\nallow = ["MPL-2.0"]\n`);
  run(d, bin, ["--locked", "check", "licenses"]);
  const out = await readFile(log, "utf8");
  assert.match(out, /^deny --config \S+ --locked check licenses$/m);
  assert.match(out, /allow = \["MIT", "ISC", "MPL-2\.0"\]/);
});

test("deny.mjs: an explicit --config picks the overlay next to it", async () => {
  const { bin, log } = await shim();
  const d = await mkdtemp(join(tmpdir(), "deny-proj-"));
  await mkdir(join(d, "crates/x"), { recursive: true });
  await writeFile(join(d, "crates/x/deny.toml"), BASE);
  await writeFile(join(d, "crates/x/deny.local.toml"), `[licenses]\nallow = ["BSL-1.0"]\n`);
  run(join(d, "crates/x"), bin, ["--config", "deny.toml", "check", "licenses"]);
  const out = await readFile(log, "utf8");
  assert.match(out, /^deny --config \S+ check licenses$/m);
  assert.match(out, /"BSL-1\.0"/);
});

test("mergeAllow rejects a second table after the allow list (no merging bans into licenses)", () => {
  const local = `[licenses]\nallow = ["A"]\n[bans]\ndeny = [{ crate = "openssl" }]\n`;
  assert.throws(() => mergeAllow(BASE, local), /deny\.local\.toml/);
});

test("mergeAllow accepts TOML literal strings and keeps `$` in a name literal", () => {
  const out = mergeAllow(BASE, `[licenses]\nallow = ['MPL-2.0', "A$&B"]\n`);
  assert.match(out, /"MPL-2\.0", "A\$&B"\]/);
});

test("mergeAllow throws when the list has entries but none is a string", () => {
  assert.throws(() => mergeAllow(BASE, `[licenses]\nallow = [MPL]\n`), /deny\.local\.toml/);
});

const ADV = `[advisories]\nignore = [\n  { id = "RUSTSEC-2024-0001", reason = "not reachable # here", expires = "${future}" },\n]\n`;

test("mergeOverlay merges advisories ignores as { id, reason } without expires", () => {
  const base = `[advisories]\nyanked = "deny"\n\n[licenses]\nallow = ["MIT"]\n`;
  const out = mergeOverlay(base, `[licenses]\nallow = ["Zlib"]\n${ADV}`, "2026-11-20");
  assert.match(
    out,
    /\[advisories\]\nignore = \[\{ id = "RUSTSEC-2024-0001", reason = "not reachable # here" \}\]/,
  );
  assert.doesNotMatch(out, /expires/);
  assert.match(out, /allow = \["MIT", "Zlib"\]/);
});

test("mergeOverlay rejects an ignore without reason or valid expires, or expired, naming the id", () => {
  const mk = (body) => `[advisories]\nignore = [${body}]\n`;
  const today = "2026-11-20";
  const bad = [
    `{ id = "RUSTSEC-1", expires = "${future}" }`,
    `{ id = "RUSTSEC-2", reason = "x" }`,
    `{ id = "RUSTSEC-3", reason = "x", expires = "soon" }`,
    `{ id = "RUSTSEC-4", reason = "x", expires = "2026-11-19" }`,
    `{ id = "RUSTSEC-5", reason = "x", expires = "2026-13-40" }`,
  ];
  for (const b of bad) {
    const id = b.match(/RUSTSEC-\d/)[0];
    assert.throws(() => mergeOverlay(BASE, mk(b), today), new RegExp(id));
  }
  assert.doesNotThrow(() =>
    mergeOverlay(BASE, mk(`{ id = "A", reason = "x", expires = "${today}" }`), today),
  );
});

test("deny.mjs: no arguments run all four checks with --locked", async () => {
  const { bin, log } = await shim();
  const d = await mkdtemp(join(tmpdir(), "deny-proj-"));
  await writeFile(join(d, "deny.toml"), BASE);
  run(d, bin, []);
  assert.equal(
    (await readFile(log, "utf8")).trim(),
    "deny --locked check advisories bans licenses sources",
  );
});

test("deny.mjs: on a push to the default branch advisories are dropped from the default list", async () => {
  const { bin, log } = await shim();
  const d = await mkdtemp(join(tmpdir(), "deny-proj-"));
  await writeFile(join(d, "deny.toml"), BASE);
  const want = "deny --locked check bans licenses sources";
  run(d, bin, [], { GITHUB_EVENT_NAME: "push" });
  assert.equal((await readFile(log, "utf8")).trim(), want);
  run(d, bin, [], { CIRCLECI: "true", CIRCLE_BRANCH: "main" });
  assert.equal((await readFile(log, "utf8")).trim(), want);
  run(d, bin, [], { CIRCLECI: "true", CIRCLE_BRANCH: "trunk", DENY_DEFAULT_BRANCH: "trunk" });
  assert.equal((await readFile(log, "utf8")).trim(), want);
  for (const env of [
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "merge_group" },
    { CIRCLECI: "true", CIRCLE_BRANCH: "feature" },
    { CIRCLECI: "true", CIRCLE_BRANCH: "gh-readonly-queue/main/pr-1-abc" },
    { CIRCLECI: "true" },
    {
      CIRCLECI: "true",
      CIRCLE_BRANCH: "main",
      CIRCLE_PULL_REQUEST: "https://github.com/o/r/pull/1",
    },
  ]) {
    run(d, bin, [], env);
    assert.match(await readFile(log, "utf8"), /check advisories bans/);
  }
  run(d, bin, ["--locked", "check", "advisories"], { GITHUB_EVENT_NAME: "push" });
  assert.equal((await readFile(log, "utf8")).trim(), "deny --locked check advisories");
});

test("deny.mjs: an expired ignore exits 1 naming the id before cargo deny runs", async () => {
  const { bin, log } = await shim();
  const d = await mkdtemp(join(tmpdir(), "deny-proj-"));
  await writeFile(join(d, "deny.toml"), BASE);
  await writeFile(
    join(d, "deny.local.toml"),
    `[advisories]\nignore = [{ id = "RUSTSEC-9", reason = "r", expires = "2020-01-01" }]\n`,
  );
  assert.throws(
    () => run(d, bin, []),
    (e) => e.status === 1 && /RUSTSEC-9/.test(e.stderr),
  );
  await assert.rejects(readFile(log, "utf8"));
});

test("hull: the owned deny.toml keeps no advisory ignores and no file names a bare cargo deny", async () => {
  const root = fileURLToPath(new URL("../template-rust/pieces/base/files/", import.meta.url));
  assert.doesNotMatch(await readFile(join(root, "deny.toml"), "utf8"), /^\s*ignore\s*=/m);
  const { RUST_CI_STEPS } = await import("../scripts/lib/ci-tasks.mjs");
  assert.ok(RUST_CI_STEPS.includes("node scripts/deny.mjs"));
  const { execFileSync: ex } = await import("node:child_process");
  const hits = ex("grep", ["-rIl", "cargo deny", "."], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && f !== "./scripts/deny.mjs");
  assert.deepEqual(hits, []);
  const rel = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  assert.match(rel, /node scripts\/deny\.mjs --locked check advisories/);
});

test("an expired ignore only fails when advisories is among the checks run", async () => {
  const { bin, log } = await shim();
  const d = await mkdtemp(join(tmpdir(), "deny-proj-"));
  await writeFile(join(d, "deny.toml"), BASE);
  await writeFile(
    join(d, "deny.local.toml"),
    `[advisories]\nignore = [{ id = "RUSTSEC-9", reason = "r", expires = "2020-01-01" }]\n`,
  );
  run(d, bin, [], { GITHUB_EVENT_NAME: "push" });
  assert.match(await readFile(log, "utf8"), /check bans licenses sources/);
  run(d, bin, ["--locked", "check", "bans"]);
  for (const args of [
    ["--locked", "check"],
    ["--locked", "check", "advisories", "bans"],
  ]) {
    assert.throws(
      () => run(d, bin, args),
      (e) => e.status === 1 && /RUSTSEC-9/.test(e.stderr),
    );
  }
});

test("mergeOverlay appends to an existing ignore list and finds a commented header", () => {
  const add = `[advisories]\nignore = [{ id = "RUSTSEC-2", reason = "r", expires = "${future}" }]\n`;
  const base = `[advisories] # policy\nyanked = "deny"\nignore = [\n  "RUSTSEC-1", # old ]\n]\n\n[licenses]\nallow = ["MIT"]\n`;
  const out = mergeOverlay(base, add, "2026-11-20");
  assert.equal(out.match(/\[advisories\]/g).length, 1);
  assert.equal(out.match(/^ignore\s*=/gm).length, 1);
  assert.match(
    out,
    /"RUSTSEC-1", # old \]\n?\s*, ?\{ id = "RUSTSEC-2"|"RUSTSEC-1"[\s\S]*\{ id = "RUSTSEC-2", reason = "r" \}\]/,
  );
  const bare = mergeOverlay(`[advisories] # x\nyanked = "deny"\n`, add, "2026-11-20");
  assert.equal(bare.match(/\[advisories\]/g).length, 1);
  assert.match(bare, /\[advisories\] # x\nignore = \[\{ id = "RUSTSEC-2"/);
});
