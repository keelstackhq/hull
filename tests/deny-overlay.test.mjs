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
const { mergeAllow } = await import(SCRIPT);

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
const run = (cwd, bin, args) =>
  execFileSync("node", [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

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
