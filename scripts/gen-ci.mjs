#!/usr/bin/env node
// Writes the GitHub Actions workflow and the CircleCI `ci-ok` job of generated repos from CI_PLAN
// (secrets-ci design §6.2). `--check` exits 1 when a checked-in file differs from the generated one.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CI_PLAN } from "./lib/ci-tasks.mjs";
import { isMain } from "./lib/is-main.mjs";

export const GITHUB_CI_PATH = fileURLToPath(
  new URL("../template/pieces/base/files/.github/workflows/ci.yml", import.meta.url),
);

export const CIRCLECI_OK_PATH = fileURLToPath(
  new URL("../template/pieces/circleci/files/.circleci/src/jobs/ci-ok.yml", import.meta.url),
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

/** The CircleCI `ci-ok` job (body of `.circleci/src/jobs/ci-ok.yml`) for `CI_PLAN`. */
export function circleciOk(plan = CI_PLAN) {
  const steps = plan.map((s) => `  # step: ${s.id}\n${s.circleci}`).join("");
  return `executor: node\nsteps:\n${steps}`;
}

async function main() {
  const files = [
    [GITHUB_CI_PATH, githubCi(), "ci.yml"],
    [CIRCLECI_OK_PATH, circleciOk(), "ci-ok.yml"],
  ];
  if (process.argv.includes("--check")) {
    for (const [path, text, name] of files) {
      const current = await readFile(path, "utf8").catch(() => "");
      if (current !== text) {
        console.error(`${name} is out of date; run \`pnpm gen:ci\``);
        process.exit(1);
      }
    }
    return;
  }
  for (const [path, text] of files) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
}

if (isMain(import.meta.url)) await main();
