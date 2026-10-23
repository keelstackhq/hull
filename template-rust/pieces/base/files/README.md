# Rust workspace

Generated from hull's `template-rust` (`splice new gh:keelstackhq/hull//template-rust`): a Cargo
workspace with a pinned toolchain, cargo-deny, cargo-nextest, one CI job, releases through hoist
and an AI layer (`AGENTS.md`, `CLAUDE.md`, `.claude/`). No Node toolchain is needed to build.

## After `splice new`

Add the subagents and the org decisions as splice channels (D-004), then refresh the index:

```bash
splice channel add gh:keelstackhq/hull//rigging --piece claude
splice channel add gh:keelstackhq/decisions//channel --track main --piece import-project
node scripts/agents-index.mjs
```

`.github/workflows/splice.yml` keeps the template and both channels fresh (weekly PR).

## Measure CI time

Budget for job `ci`: 45 s on a typical PR, 15 s docs-only. Measure the last 20 runs:

```bash
gh run list -w ci.yml -L 20 --json databaseId
gh run view <id> --json jobs   # completedAt - startedAt of job "ci"
```

## Releasing

`release.yml` runs hoist on every push to `main`. It does nothing until the repository variable
`HOIST_RELEASE` is `enabled`. One-time human steps are in `docs/agents/project.md` (Blocked).
