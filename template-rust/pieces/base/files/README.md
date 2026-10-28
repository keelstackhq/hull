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

## Secrets

Create the `splice-bot` and `release-pr` environments first (Deployment branches = Selected →
`main`); a first run would auto-create unprotected ones. Then store `SPLICE_BOT_TOKEN`
(`splice.yml`) and `HOIST_RELEASE_TOKEN` (`release.yml`, job `prepare`) only as secrets of those
environments. Never store them as repository secrets: any pull request that edits a workflow
could read those.

### Update bot and release PR: pick a token mode

A PR opened with `github.token` gets no CI (events by `GITHUB_TOKEN` trigger no workflows), cannot
push changes to `.github/workflows/*` (needs the `workflows` permission), and so cannot merge when
a ruleset requires `ci-ok`. Pick one:

1. GitHub App (no personal token): install an App with Contents and Pull requests write, and for
   the update bot Workflows write (required: `splice.yml` requests it, and the token step fails
   without it). In environment `splice-bot`, set the variable `SPLICE_APP_CLIENT_ID` (the App's
   Client ID) and the secret `SPLICE_APP_KEY` (its private key). For the release PR, set
   `HOIST_RELEASE_APP_CLIENT_ID` and `HOIST_RELEASE_APP_KEY` in environment `release-pr`.
2. PAT: `SPLICE_BOT_TOKEN` / `HOIST_RELEASE_TOKEN` as environment secrets (Contents and Pull
   requests write; plus Workflows write for `SPLICE_BOT_TOKEN`).
3. Session mode (update bot only): set the repository variable `SPLICE_BOT=off`. The job is
   skipped (scheduled and manual runs); an agent session runs `splice update --all` on a branch and
   opens the PR itself. Its push is not by `GITHUB_TOKEN`, so CI runs; pushing changes to workflow
   files needs a credential with the workflow scope.

Order: App, then PAT, then `github.token`.
