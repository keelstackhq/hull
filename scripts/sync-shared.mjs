#!/usr/bin/env node
// Copies files both templates ship from template/ (the one source) to template-rust/, so they
// stay identical. `--check` changes nothing and exits 1 when a copy is stale (tests run it).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FROM = join(ROOT, "template/pieces/base/files");
const TO = join(ROOT, "template-rust/pieces/base/files");
export const SHARED = [
  "scripts/ready.mjs",
  ".claude/hooks/guard.mjs",
  ".claude/skills/ready/SKILL.md",
  "docs/agents/onboarding.toml",
];

const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

const check = process.argv.includes("--check");
const stale = [];
for (const rel of SHARED) {
  const src = readFileSync(join(FROM, rel), "utf8");
  if (read(join(TO, rel)) === src) continue;
  stale.push(rel);
  if (!check) {
    mkdirSync(dirname(join(TO, rel)), { recursive: true });
    writeFileSync(join(TO, rel), src);
  }
}
if (check && stale.length) {
  process.stdout.write(
    `stale in template-rust: ${stale.join(", ")}; run node scripts/sync-shared.mjs\n`,
  );
  process.exitCode = 1;
}
