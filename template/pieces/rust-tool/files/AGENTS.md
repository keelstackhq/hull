# Rust tool

A crate in the root Cargo workspace (`Cargo.toml`, `crates/*`), run by Turborepo through package scripts.

- Scripts always pass `-p <crate>`; never `--workspace` (it would pull in `src-tauri`, which needs webkit2gtk).
- `build` is `cargo build --release -p <crate>`; Turbo caches `$TURBO_ROOT$/target/release/<crate>`.
- Lint is `cargo clippy -D warnings`, format is `cargo fmt --check`, tests run with `cargo nextest`.
- `typecheck` is `cargo check -p <crate> --all-targets`.
- `Cargo.lock` lives at the repo root and is committed; edit dependencies with `cargo add -p <crate>`.
- This is for in-repo tools. For a distributed CLI (npm, GitHub release) use `rust-cli`.
- One integration-test binary per crate: `tests/it/main.rs` with `mod` per topic, not one file per test (each top-level file in `tests/` links its own binary and slows CI).
- Crate graph: split a kitchen-sink crate whose parts change apart; keep proc-macro crates and
  heavy derive deps at the leaves, not in a crate everything depends on. Local rebuilds: set
  `RUSTC_WRAPPER=sccache` if you have it (CI restores `target/` with its cache instead).
