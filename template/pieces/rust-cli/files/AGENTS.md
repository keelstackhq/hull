# Rust CLI

Distributable CLI in the root Cargo workspace; the binary is named like the crate directory.

- Output: every command returns a `Report` (`src/output.rs`); only `output::emit` writes stdout.
  `--json` prints exactly one object and `\n`, also for clap usage errors.
- Exit codes (`src/exit.rs`): 0 ok, 1 negative result, 2 usage, 3 config/environment/runtime error.
  Error messages say how to fix the problem.
- Logs go to stderr through `tracing` (`RUST_LOG`, `-v`, `-q`); never `println!` elsewhere.
- Tests build the command with `common::cli()` (cleared env, temp HOME); never set process env
  (`set_var` is unsafe in edition 2024, the workspace forbids unsafe).
- Snapshots are inline; review changes with `cargo insta review`, never blind-accept. `--help`
  snapshots replace the binary name with `[BIN]`.
- Network code uses rustls; `deny.toml` bans openssl and native-tls, `lint` runs `cargo deny`.
- Pin dependencies `=x.y.z`; scripts use `-p <crate>` and `--locked`.
- `build` is a debug build; release binaries come from the release workflow, a human pushes the
  tag `<name>-v<version>` after bumping `version` in `Cargo.toml`.
