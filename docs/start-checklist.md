# Project start checklist

Every human step before agents can work autonomously on a new repo rendered from hull, in order:
computer steps first, then phone steps (D-009), each with how an agent verifies it. In a rendered
repo, the `ready` skill (`node scripts/ready.mjs`) runs the automatable checks and links each line
here, at the hull tag the repo was rendered from. Agents start autonomous work only when it exits
0 and the owner has confirmed every `manual` item. `TODO(owner)` marks facts not yet written down.

<a id="repo"></a>

### 1. Create the GitHub repo · computer · ready: auto

Create the repo under the `keelstackhq` org (D-001).
Private repos need GitHub Pro/Team for rulesets (item 5).

Check: `gh repo view` names the repo.

<a id="apps"></a>

### 2. Install the GitHub Apps · computer · ready: manual

Install on the new repo:

- Claude: github.com → Settings → Applications → Claude → Configure → add the repo.
- Renovate: add the repo to the Renovate App. `renovate.json` extends
  `github>keelstackhq/hull//renovate/default`. TODO(owner): which Renovate App installation.
- Update bot (splice), pick one (the generated `README.md`, "Update bot: pick a token mode"):
  an App with Contents, Pull requests and Workflows write, with variable `SPLICE_APP_CLIENT_ID`
  and secret `SPLICE_APP_KEY` in environment `splice-bot`; or a PAT `SPLICE_BOT_TOKEN` in that
  environment; or session mode, repository variable `SPLICE_BOT=off`.
- Secrets read App `keelstackhq-secrets-read`, only with the `secrets` piece: it is installed on
  the secrets repo, not here; add the new repo to the selected repositories of the org variable
  `SECRETS_READ_APP_ID` and org secret `SECRETS_READ_APP_KEY`.
- Release App: only for repos released by hoist (template-rust: `HOIST_RELEASE_APP_CLIENT_ID`
  variable, `HOIST_RELEASE_APP_KEY` secret, Contents write). TODO(owner): App name.
- bosun App, if bosun is adopted. TODO(owner): App name and permissions.

Check: manual. An agent cannot list a repo's App installations; the owner confirms.

<a id="environment"></a>

### 3. Set up the Claude Code web environment · computer · ready: auto

In claude.ai/code, create or pick the environment and note its env ID for the orchestrator.
Attach the repo. The setup script installs Node 24, pnpm 12 (the `packageManager` pin in
`package.json`), splice, plus Rust (`rust-toolchain.toml`) with Rust pieces, hoist with the
`secrets` piece and bosun when adopted. TODO(owner): the network policy (npm, crates.io and
GitHub hosts at least) and the install commands for hoist and bosun.

Check: the tools are on PATH; node major ≥ 24; pnpm major matches `packageManager`.

<a id="actions"></a>

### 4. Allow GitHub Actions · computer · ready: auto

Settings → Actions → General: Actions enabled for the repo. Workflows set their own
`permissions:`. TODO(owner): allowed-actions policy and the default workflow token permissions.

Check: `gh api repos/OWNER/REPO/actions/permissions` reports `enabled`.

<a id="rulesets"></a>

### 5. Add the rulesets · computer · ready: auto

- Branch ruleset on `main`: require a pull request, require status check `ci-ok` (D-008, D-011),
  block force pushes.
- Tag ruleset `release-tags` (hull spec §0 P2): Active, bypass Repository admin only (plus the
  release App, item 2, where one tags), include `*-v*`, restrict creations, updates and
  deletions, block force pushes.

hull's `bash scripts/owner/bootstrap-secrets.sh --check-rulesets OWNER/REPO` checks the tag
ruleset from a hull clone.

Check: the rules on `main` require `ci-ok`; an active tag ruleset `release-tags` exists.

<a id="environments"></a>

### 6. Create the environments · computer · ready: auto

Create every environment the rendered workflows name (`environment:` in `.github/workflows/`),
before their first run: a first run would auto-create an unprotected one. Deployment branches and
tags = Selected: `release` (always; `release.yml` runs on tag pushes) gets the tag rule `*-v*` and
the owner as required reviewer (D-008); every other one gets branch `main`: `splice-bot` (update
bot), `preview` (web pieces), `prod` (`secrets` piece); template-rust adds `release-pr`.
TODO(owner): reviewers on `prod` (`preview` and `splice-bot` run unattended, so no reviewer).

Check: each named environment exists; `release` deploys from tag `*-v*` with a required reviewer,
the others from branch `main`.

<a id="secrets"></a>

### 7. Provide the secrets · computer · ready: auto

Only when pieces need them. With the `secrets` piece (D-010): the bundles live sops+age-encrypted
in a private secrets repo; the owner grants each environment its age key with
`hoist secrets grant <repo> --env <env>` (or hull's `scripts/owner/bootstrap-secrets.sh`), which
sets the environment secret `SOPS_AGE_KEY`. `secrets.toml` maps `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` from the bundles. Without it: those two are secrets of the `preview` (and
prod deploy) environment, never repository secrets. Agents never hold age keys or see values.

Check: `hoist secrets check` passes when `secrets.toml` exists.

<a id="bosun"></a>

### 8. Set up bosun · computer · ready: auto

Only if bosun is adopted. Add the orchestrator's public key to the bosun approvers so it can post
signed approvals (D-012). TODO(owner): the approvers file (`approvers.toml`?) path and format, and
how `.bosun/` is rendered.

Check: `bosun doctor` passes when `.bosun/` exists.

<a id="render"></a>

### 9. Render the hull template · phone · ready: auto

Ask the first agent to render it, or do it on a computer:
`pnpm dlx @keelstackhq/splice new gh:keelstackhq/hull//template <repo> --ref vX.Y.Z --piece <id>[:<name>] ...`
(base is always rendered), then commit `.splice/lock.toml` with the files and push.

Check: `.splice/lock.toml` exists and `splice check --offline` passes.

<a id="plan"></a>

### 10. Give the plan or brief · phone · ready: auto

Send the brief in chat. The agent writes it as a spec in `docs/superpowers/specs/` and a plan in
`docs/superpowers/plans/`, or, for a small project, as a `## Steps` list in
`docs/agents/project.md`. Plans end with an owner-steps section (D-009).

Check: a `.md` file in either directory, or a `## Steps` list in `docs/agents/project.md`.

<a id="approvals"></a>

### 11. Confirm how approvals work · phone · ready: manual

D-012: owner approvals are asked as a Claude Code chat form naming repo, PR and head SHA; the
orchestrator posts the signed bosun approval. Bootstrap mode until 2026-11-30 UTC: the
orchestrator may approve gated PRs itself after green checks and an independent review of that
head; environments, tags, releases, decisions merges, branch rules and secrets still need the
owner (release-environment taps on the phone).

Check: manual. The owner confirms in chat.
