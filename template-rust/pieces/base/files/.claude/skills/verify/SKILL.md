---
name: verify
description: Run the CI steps (format, clippy, cargo-deny, tests, doc tests) on the workspace and report a short pass/fail summary. Use before claiming any work is done.
---

Run, in order, and keep going after a failure so every step reports:

```bash
node scripts/agents-index.mjs --check
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo deny --locked check bans licenses sources
cargo nextest run --workspace --locked --profile ci
cargo test --workspace --doc --locked
```

If the index check fails, run `node scripts/agents-index.mjs` and include the regenerated
`docs/agents/index.md` in the change.

Report at most 10 lines: pass or fail per step, and for each failure the first error only (file,
line, message). If everything passed, say so in one line. Never report a pass you did not see in
the output. Do not fix anything unless asked.
