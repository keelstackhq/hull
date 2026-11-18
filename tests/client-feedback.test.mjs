import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderNew } from "../scripts/render.mjs";
import { REAL_TEMPLATE, renderCombo } from "./helpers.mjs";

const RUST = fileURLToPath(new URL("../template-rust", import.meta.url));
const read = (dir, rel) => readFile(join(dir, rel), "utf8");
async function renderRust(pieces) {
  const dir = join(await mkdtemp(join(tmpdir(), "hull-rust-")), "out");
  await renderNew({ template: RUST, out: dir, pieces, vars: {} });
  return dir;
}

test("base seeds CHANGELOG.md in both templates (bosun fold-fragments needs it)", async () => {
  for (const tpl of [REAL_TEMPLATE, RUST]) {
    const toml = await readFile(join(tpl, "pieces/base/piece.toml"), "utf8");
    assert.match(toml, /^seed = \[.*"CHANGELOG\.md"/m, tpl);
  }
  const { dir } = await renderCombo(["base"]);
  for (const d of [dir, await renderRust(["base"])]) {
    const text = await read(d, "CHANGELOG.md");
    assert.match(text, /^# Changelog\n/);
    assert.match(text, /^## unreleased$/m);
  }
});

test("AGENTS.md says docs-only PRs need no fragment, in both templates", async () => {
  const line = "docs-only PRs need no changelog/progress fragment";
  const { dir } = await renderCombo(["base"]);
  assert.ok((await read(dir, "AGENTS.md")).includes(line));
  assert.ok((await read(await renderRust(["base"]), "AGENTS.md")).includes(line));
});

test("ready skill: npx fallback when bosun is not on PATH, both templates", async () => {
  const cmd = "npx -y @keelstackhq/bosun@$(cat .bosun/version)";
  const { dir } = await renderCombo(["base"]);
  assert.ok((await read(dir, ".claude/skills/ready/SKILL.md")).includes(cmd));
  assert.ok(
    (await read(await renderRust(["base"]), ".claude/skills/ready/SKILL.md")).includes(cmd),
  );
});

test("Rust crate notes: one integration-test binary per crate", async () => {
  const re = /one integration-test binary per crate/i;
  const { dir } = await renderCombo(["base", "rust-tool:tool"]);
  assert.match(await read(dir, "crates/tool/AGENTS.md"), re);
  const c = await renderCombo(["base", "rust-cli:cli"]);
  assert.match(await read(c.dir, "crates/cli/AGENTS.md"), re);
  assert.match(await read(await renderRust(["base", "rust-cli:cli"]), "crates/cli/AGENTS.md"), re);
});

test("root Cargo.toml: dev profile trims debug info, dependencies get none", async () => {
  const check = (text, label) => {
    assert.match(text, /\[profile\.dev\]\ndebug = "line-tables-only"/, label);
    assert.match(text, /\[profile\.dev\.package\."\*"\]\ndebug = false/, label);
  };
  check(await read(await renderRust(["base"]), "Cargo.toml"), "template-rust");
  for (const pieces of [
    ["base", "rust-cli:cli"],
    ["base", "preact-app:web", "tauri-app:desktop"],
  ]) {
    check(await read((await renderCombo(pieces)).dir, "Cargo.toml"), pieces.join("+"));
  }
});

test("Rust crate notes mention proc-macro leaves and sccache", async () => {
  for (const rel of [
    "template/pieces/rust-tool/files/AGENTS.md",
    "template/pieces/rust-cli/files/AGENTS.md",
    "template-rust/pieces/rust-cli/files/AGENTS.md",
  ]) {
    const text = await read(fileURLToPath(new URL("..", import.meta.url)), rel);
    assert.match(text, /proc-macro/, rel);
    assert.match(text, /sccache/, rel);
  }
});

test("no template ships .cargo/config.toml (no linker or rustc-wrapper imposed)", async () => {
  const { dir } = await renderCombo(["base", "rust-cli:cli"]);
  for (const d of [dir, await renderRust(["base", "rust-cli:cli"])]) {
    await assert.rejects(read(d, ".cargo/config.toml"), { code: "ENOENT" });
  }
  for (const tpl of [REAL_TEMPLATE, RUST]) {
    await assert.rejects(read(tpl, "pieces/base/files/.cargo/config.toml"), { code: "ENOENT" });
  }
});

test("CircleCI Rust cache key hashes the root Cargo.toml (a profile change rebuilds the cache)", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const rel of [
    "template/pieces/circleci/files/.circleci/src/jobs/ci-ok.yml",
    "template-rust/pieces/circleci/files/.circleci/src/jobs/ci-ok.yml",
  ]) {
    assert.match(await read(root, rel), /cat Cargo\.lock Cargo\.toml rust-toolchain\.toml/, rel);
  }
});
