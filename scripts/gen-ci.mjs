#!/usr/bin/env node
// Writes the GitHub Actions workflow of generated repos from CI_PLAN (secrets-ci design §6.2).
// `--check` exits 1 when the checked-in file differs from the generated one.
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CI_PLAN } from "./lib/ci-tasks.mjs";

export const GITHUB_CI_PATH = fileURLToPath(
  new URL("../template/pieces/base/files/.github/workflows/ci.yml", import.meta.url),
);

const header = `name: ci

on:
  pull_request:
  merge_group:
  push:
    branches: [main]

concurrency:
  group: ci-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      TURBO_SCM_BASE: \${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before }}
      TURBO_SCM_HEAD: \${{ github.sha }}
    steps:
`;

const footer = `
  ci-ok:
    needs: [ci]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Require ci success
        run: |
          if [ "\${{ needs.ci.result }}" != "success" ]; then
            echo "ci result: \${{ needs.ci.result }}"
            exit 1
          fi
`;

/** The full GitHub workflow text for `CI_PLAN`. */
export function githubCi(plan = CI_PLAN) {
  const steps = plan.map((s) => `      # step: ${s.id}\n${s.github}`).join("");
  return `${header}${steps}${footer}`;
}

async function main() {
  const text = githubCi();
  if (process.argv.includes("--check")) {
    const current = await readFile(GITHUB_CI_PATH, "utf8").catch(() => "");
    if (current !== text) {
      console.error("ci.yml is out of date; run `pnpm gen:ci`");
      process.exit(1);
    }
    return;
  }
  await writeFile(GITHUB_CI_PATH, text);
}

// Compare real paths: import.meta.url has symlinks resolved, argv[1] does not.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
