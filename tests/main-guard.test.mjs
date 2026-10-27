import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderNew } from "../scripts/render.mjs";
import { renderCombo } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUST = join(ROOT, "template-rust");

async function renderRust(t) {
  const base = await mkdtemp(join(tmpdir(), "hull-rust-main-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, "out");
  await renderNew({ template: RUST, out: dir, pieces: [], vars: {} });
  return dir;
}

async function link(dir, t) {
  const base = await mkdtemp(join(tmpdir(), "hull-link-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const l = join(base, "link");
  symlinkSync(dir, l);
  return l;
}

const denyInput = JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm publish" } });

function assertDenies(dir, nodeOptions) {
  const r = spawnSync("node", [join(dir, ".claude/hooks/guard.mjs")], {
    input: denyInput,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      CLAUDE_PROJECT_DIR: "/r",
      ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}),
    },
  });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
}

test("guard.mjs still denies when the checkout is opened through a symlink", async (t) => {
  const { dir } = await renderCombo([]);
  t.after(() => rm(join(dir, ".."), { recursive: true, force: true }));
  assertDenies(dir);
  assertDenies(await link(dir, t));
  assertDenies(await link(dir, t), "--preserve-symlinks-main");
});

test("template-rust guard.mjs still denies through a symlink", async (t) => {
  const dir = await renderRust(t);
  assertDenies(await link(dir, t));
  assertDenies(await link(dir, t), "--preserve-symlinks-main");
});

test("agents-index.mjs --check runs through a symlink", async (t) => {
  const { dir } = await renderCombo([]);
  t.after(() => rm(join(dir, ".."), { recursive: true, force: true }));
  const r = spawnSync("node", [join(await link(dir, t), "scripts/agents-index.mjs"), "--check"], {
    encoding: "utf8",
  });
  assert.match(`${r.stdout}${r.stderr}`, /\S/, "script produced no output: main did not run");
});

test("template-rust docs-only.mjs prints its decision through a symlink", async (t) => {
  const l = await link(await renderRust(t), t);
  const r = spawnSync("node", [join(l, ".github/scripts/docs-only.mjs")], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(r.stdout, "skip=false\n");
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.mjs(\.jinja)?$/.test(name)) out.push(p);
  }
  return out;
}

test("every argv[1] entry check in the templates resolves real paths", () => {
  const files = ["template", "template-rust", "rigging"].flatMap((d) => walk(join(ROOT, d)));
  let seen = 0;
  for (const f of files) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.includes("process.argv[1]")) continue;
      seen++;
      assert.match(line, /realpathSync\(process\.argv\[1\]/, `${f}: ${line.trim()}`);
    }
  }
  assert.ok(seen >= 12, `expected at least 12 guards, saw ${seen}`);
});
