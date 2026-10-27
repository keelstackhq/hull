/** Tasks every generated repo's CI runs, in order (spec §8.1). */
export const CI_TASKS = Object.freeze(["lint", "format:check", "typecheck", "test", "build"]);

const yml = (...lines) => `${lines.join("\n")}\n`;
const tasks = CI_TASKS.join(" ");
const notSkipped = "steps.affected.outputs.skip != 'true'";
const ifRust = `${notSkipped} && steps.rust.outputs.rust == 'true'`;

/**
 * Steps of the generated CI job, in order (secrets-ci design §6.2). `github` is the YAML text of
 * the step as it appears in the GitHub Actions workflow (6-space indent, trailing newline).
 * `scripts/gen-ci.mjs` writes the workflow from this list; `# step: <id>` comments mark each step.
 */
export const CI_PLAN = Object.freeze(
  [
    {
      id: "timer",
      github: yml(
        "      - name: Start timer",
        '        run: echo "CI_START=$(date +%s)" >> "$GITHUB_ENV"',
      ),
    },
    {
      id: "checkout",
      github: yml(
        "      - uses: actions/checkout@v5",
        "        with:",
        "          fetch-depth: 0",
        "          filter: blob:none",
      ),
    },
    {
      id: "agents-index",
      github: yml(
        "      - name: Agents index current?",
        "        run: node scripts/agents-index.mjs --check",
      ),
    },
    {
      id: "affected",
      github: yml(
        "      - name: Anything affected?",
        "        id: affected",
        "        env:",
        "          TURBO_VERSION: 2.11.8",
        "        run: |",
        "          set +e",
        '          curl -fsSL "https://registry.npmjs.org/@turbo/linux-64/-/linux-64-$TURBO_VERSION.tgz" \\',
        '            | tar -xz -C "$RUNNER_TEMP" --strip-components=2 turbo-linux-x64/bin/turbo',
        `          "$RUNNER_TEMP/turbo" query affected --tasks ${tasks} > "$RUNNER_TEMP/affected.json"`,
        "          code=$?",
        "          set -e",
        '          if [ "$code" -eq 0 ]; then',
        '            node .github/scripts/affected.mjs < "$RUNNER_TEMP/affected.json" >> "$GITHUB_OUTPUT"',
        "          else",
        '            echo "::warning::turbo query affected failed (exit $code); running everything"',
        '            echo "skip=false" >> "$GITHUB_OUTPUT"',
        "          fi",
      ),
    },
    {
      id: "setup-pnpm-node",
      github: yml(
        "      - uses: pnpm/action-setup@v4",
        `        if: ${notSkipped}`,
        "      - uses: actions/setup-node@v5",
        `        if: ${notSkipped}`,
        "        with:",
        "          node-version-file: .node-version",
        "          cache: pnpm",
      ),
    },
    {
      id: "install",
      github: yml(
        "      - name: Install",
        `        if: ${notSkipped}`,
        "        run: pnpm install --frozen-lockfile --prefer-offline",
      ),
    },
    {
      id: "turbo-cache",
      github: yml(
        "      # Turborepo remote cache in the GitHub Actions cache; exports TURBO_API/TURBO_TOKEN/TURBO_TEAM",
        "      - uses: keelstackhq/hoard@v0",
        `        if: ${notSkipped}`,
      ),
    },
    {
      id: "rust-affected",
      github: yml(
        "      - name: Rust affected?",
        "        id: rust",
        `        if: ${notSkipped} && hashFiles('.github/scripts/rust-affected.mjs') != ''`,
        "        run: |",
        "          set +e",
        '          pnpm turbo query affected --packages > "$RUNNER_TEMP/rust.json"',
        "          code=$?",
        "          set -e",
        '          if [ "$code" -eq 0 ]; then',
        '            node .github/scripts/rust-affected.mjs < "$RUNNER_TEMP/rust.json" >> "$GITHUB_OUTPUT"',
        "          else",
        '            echo "::warning::turbo query affected --packages failed (exit $code); running Rust steps"',
        '            echo "rust=true" >> "$GITHUB_OUTPUT"',
        "          fi",
      ),
    },
    {
      id: "rust-toolchain",
      github: yml(
        "      - name: Rust toolchain (from rust-toolchain.toml)",
        "        id: toolchain",
        `        if: ${ifRust}`,
        "        run: rustup toolchain install",
      ),
    },
    {
      id: "rust-cache",
      github: yml(
        "      - uses: Swatinem/rust-cache@v2",
        `        if: ${ifRust}`,
        "        with:",
        "          key: ${{ hashFiles('rust-toolchain.toml') }}",
      ),
    },
    {
      id: "rust-tools",
      github: yml(
        "      - uses: taiki-e/install-action@v2",
        `        if: ${ifRust}`,
        "        with:",
        "          tool: cargo-nextest@0.9.148,cargo-deny@0.20.2",
      ),
    },
    {
      id: "run-affected",
      github: yml(
        "      - name: Run affected tasks",
        `        if: ${notSkipped}`,
        `        run: pnpm turbo run ${tasks} --affected --output-logs=errors-only`,
      ),
    },
    {
      id: "duration",
      github: yml(
        "      - name: Job duration",
        "        if: always()",
        "        continue-on-error: true",
        "        run: |",
        "          secs=$(( $(date +%s) - ${CI_START:-$(date +%s)} ))",
        '          echo "ci job: ${secs} s (budget: 45 s typical PR, 15 s docs-only)" >> "$GITHUB_STEP_SUMMARY"',
      ),
    },
  ].map((s) => Object.freeze(s)),
);

/**
 * Commands the CI of a `template-rust` repo runs, in order (spec §15). The generated ci.yml,
 * the generated AGENTS.md, the verify skill and dogfood all run exactly these.
 */
export const RUST_CI_STEPS = Object.freeze([
  "cargo fmt --all --check",
  "cargo clippy --workspace --all-targets --locked -- -D warnings",
  "cargo deny --locked check bans licenses sources",
  "cargo nextest run --workspace --locked --profile ci",
  "cargo test --workspace --doc --locked",
]);
