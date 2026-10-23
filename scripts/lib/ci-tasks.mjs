/** Tasks every generated repo's CI runs, in order (spec §8.1). */
export const CI_TASKS = Object.freeze(["lint", "format:check", "typecheck", "test", "build"]);

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
