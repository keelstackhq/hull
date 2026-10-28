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
const GITHUB_STEPS = [
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
];

// CircleCI bodies (list items of the job's `steps:`, 2-space indent). The GitHub `if: skip` guards
// become `circleci-agent step halt` in `affected`, which ends the job successfully (S§6.4).
const rustOnly = '[ "$RUST" = true ] || exit 0';
const CIRCLECI = {
  timer: yml('  - run: echo "export CI_START=$(date +%s)" >> "$BASH_ENV"'),
  checkout: yml(
    "  - checkout:",
    "      method: blobless",
    "  - run:",
    "      name: Turbo diff base (scm-base.sh)",
    "      command: |",
    "        git fetch --no-tags origin main",
    '        echo "export TURBO_SCM_HEAD=$CIRCLE_SHA1" >> "$BASH_ENV"',
    // Assign first: CircleCI runs bash -eo pipefail, so a failing scm-base.sh stops the job.
    "        base=$(sh .circleci/scripts/scm-base.sh '<< pipeline.git.base_revision >>')",
    '        echo "export TURBO_SCM_BASE=$base" >> "$BASH_ENV"',
  ),
  "agents-index": yml(
    "  - run:",
    "      name: Agents index current?",
    "      command: node scripts/agents-index.mjs --check",
  ),
  affected: yml(
    "  - run:",
    "      name: Anything affected?",
    "      environment:",
    "        TURBO_VERSION: 2.11.8",
    "        # sha256 of the registry tarball linux-64-2.11.8.tgz, computed 2026-10-28",
    "        TURBO_SHA256: 8ddaeded8c2b85a65da10b8214593f255a9c963dc71588b48a1faca0b0eb63db",
    "      command: |",
    '        t="$(mktemp -d)"',
    '        curl -fsSL -o "$t/turbo.tgz" "https://registry.npmjs.org/@turbo/linux-64/-/linux-64-$TURBO_VERSION.tgz"',
    '        echo "$TURBO_SHA256  $t/turbo.tgz" | sha256sum -c - || exit 1',
    '        tar -xzf "$t/turbo.tgz" -C "$t" --strip-components=2 turbo-linux-x64/bin/turbo',
    "        set +e",
    `        "$t/turbo" query affected --tasks ${tasks} > "$t/affected.json"`,
    "        code=$?",
    "        set -e",
    '        if [ "$code" -eq 0 ]; then',
    '          node .github/scripts/affected.mjs < "$t/affected.json" > "$t/out"',
    '          if grep -qx "skip=true" "$t/out"; then circleci-agent step halt; fi',
    "        else",
    '          echo "turbo query affected failed (exit $code); running everything"',
    "        fi",
  ),
  "setup-pnpm-node": yml(
    "  - run:",
    "      name: pnpm (corepack, version from packageManager)",
    "      command: |",
    '        mkdir -p "$HOME/.local/bin"',
    '        corepack enable --install-directory "$HOME/.local/bin"',
    '        echo \'export PATH="$HOME/.local/bin:$PATH"\' >> "$BASH_ENV"',
  ),
  install: yml(
    "  - restore_cache:",
    "      keys:",
    '        - pnpm-v1-{{ checksum "pnpm-lock.yaml" }}',
    "        - pnpm-v1-",
    "  - run:",
    "      name: Install",
    "      command: pnpm install --frozen-lockfile --prefer-offline",
    "  - save_cache:",
    '      key: pnpm-v1-{{ checksum "pnpm-lock.yaml" }}',
    "      paths: [~/.local/share/pnpm/store]",
  ),
  "turbo-cache": yml(
    "  # hoard 0.4.0, verified 2026-10-28; sha256 is the linux-x64 musl archive",
    "  - hoard:",
    "      step: start",
    "      version: 0.4.0",
    "      sha256: aade187a9a04f0273c8f382265116d77cba234977141f91aefe2072610a24484",
  ),
  "rust-affected": yml(
    "  - run:",
    "      name: Rust affected?",
    "      command: |",
    // The cache key file is all the Rust cache steps key on: "skip" when there is no Rust work.
    "        echo skip > .rust-cache-key",
    "        [ -f .github/scripts/rust-affected.mjs ] || exit 0",
    '        t="$(mktemp -d)"',
    "        rust=false",
    '        if pnpm turbo query affected --packages > "$t/rust.json"; then',
    '          node .github/scripts/rust-affected.mjs < "$t/rust.json" > "$t/out"',
    '          if grep -qx "rust=true" "$t/out"; then rust=true; fi',
    "        else",
    '          echo "turbo query affected --packages failed; running Rust steps"',
    "          rust=true",
    "        fi",
    '        if [ "$rust" = true ]; then',
    '          echo "export RUST=true" >> "$BASH_ENV"',
    // Missing files are fine (cat exits 1, so `|| true` keeps bash -eo pipefail alive).
    '          { cat Cargo.lock rust-toolchain.toml 2>/dev/null || true; } | sha256sum | cut -d" " -f1 > .rust-cache-key',
    "        fi",
  ),
  "rust-toolchain": yml(
    "  - run:",
    "      name: Rust toolchain (from rust-toolchain.toml)",
    "      command: |",
    `        ${rustOnly}`,
    "        # rustup 1.29.2, verified 2026-10-28 (static.rust-lang.org rustup-init.sha256)",
    '        curl -fsSL -o /tmp/rustup-init "https://static.rust-lang.org/rustup/archive/1.29.2/x86_64-unknown-linux-gnu/rustup-init"',
    '        echo "5be191e8c70a5007074254cb74d78dbfdd25cd5a61c27de7b8e5410122ec24f4  /tmp/rustup-init" | sha256sum -c - || exit 1',
    "        chmod +x /tmp/rustup-init",
    "        /tmp/rustup-init -y --profile minimal --default-toolchain none",
    '        echo \'export PATH="$HOME/.cargo/bin:$PATH"\' >> "$BASH_ENV"',
    '        . "$HOME/.cargo/env"',
    "        rustup toolchain install",
  ),
  "rust-cache": yml(
    "  - restore_cache:",
    "      keys:",
    '        - rust-v2-{{ checksum ".rust-cache-key" }}',
  ),
  "rust-tools": yml(
    "  - run:",
    "      name: cargo-nextest and cargo-deny",
    "      command: |",
    `        ${rustOnly}`,
    "        # nextest publishes no checksum file, so it stays a pinned source build",
    "        command -v cargo-nextest >/dev/null || cargo install --locked cargo-nextest@0.9.148",
    "        # cargo-deny 0.20.2 musl, sha256 from the release's .sha256 asset, 2026-10-28",
    "        if ! command -v cargo-deny >/dev/null; then",
    '          t="$(mktemp -d)"',
    '          curl -fsSL -o "$t/deny.tgz" "https://github.com/EmbarkStudios/cargo-deny/releases/download/0.20.2/cargo-deny-0.20.2-x86_64-unknown-linux-musl.tar.gz"',
    '          echo "9f12ed4c49936e09b48bf862b595cde2fe64fcbd9d74dfacac6131ca824c8d5f  $t/deny.tgz" | sha256sum -c - || exit 1',
    '          tar -xzf "$t/deny.tgz" -C "$t" --strip-components=1 cargo-deny-0.20.2-x86_64-unknown-linux-musl/cargo-deny',
    '          mkdir -p "$HOME/.cargo/bin"',
    '          install -m 755 "$t/cargo-deny" "$HOME/.cargo/bin/cargo-deny"',
    "        fi",
  ),
  "run-affected": yml(
    "  - run:",
    "      name: Run affected tasks",
    `      command: pnpm turbo run ${tasks} --affected --output-logs=errors-only`,
    "  - run: mkdir -p ~/.cargo/bin ~/.cargo/registry target",
    "  - save_cache:",
    '      key: rust-v2-{{ checksum ".rust-cache-key" }}',
    "      paths: [~/.cargo/bin, ~/.cargo/registry, target]",
  ),
  duration: yml(
    "  - hoard:",
    "      step: stop",
    "      version: 0.4.0",
    "  - run:",
    "      name: Job duration",
    "      when: always",
    "      command: |",
    "        secs=$(( $(date +%s) - ${CI_START:-$(date +%s)} ))",
    '        echo "ci job: ${secs} s (budget: 75 s typical PR, 30 s docs-only)"',
  ),
};

export const CI_PLAN = Object.freeze(
  GITHUB_STEPS.map((s) => Object.freeze({ ...s, circleci: CIRCLECI[s.id] })),
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
