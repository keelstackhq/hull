import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("every plain .mjs the templates ship passes `vp fmt --check` (a generated repo runs it)", () => {
  const files = execFileSync("git", ["ls-files", "template/**/*.mjs", "template-rust/**/*.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  assert.ok(files.length > 0);
  const r = spawnSync("pnpm", ["exec", "vp", "fmt", "--check", ...files], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
