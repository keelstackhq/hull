# Rust tool

A crate in the root Cargo workspace (`Cargo.toml`, `crates/*`), run by Turborepo through package scripts.

- Scripts always pass `-p <crate>`; never `--workspace` (it would pull in `src-tauri`, which needs webkit2gtk).
- `build` is `cargo build --release -p <crate>`; Turbo caches `$TURBO_ROOT$/target/release/<crate>`.
- Lint is `cargo clippy -D warnings`, format is `cargo fmt --check`, tests run with `cargo nextest`.
- `typecheck` is `cargo check -p <crate> --all-targets`.
- `Cargo.lock` lives at the repo root and is committed; edit dependencies with `cargo add -p <crate>`.
