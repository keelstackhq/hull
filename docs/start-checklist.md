# Project start checklist

Every human step before agents can work autonomously on a new repo rendered from hull, in order:
computer steps first, then phone steps (D-009), each with how an agent verifies it. In a rendered
repo, the `ready` skill (`node scripts/ready.mjs`) runs the automatable checks and links each line
here, at the hull tag the repo was rendered from. Agents start autonomous work only when it exits
0 and the owner has confirmed every `manual` item. `TODO(owner)` marks facts not yet written down.

## Onboarding questions

`ready` first asks these as Claude Code forms (at most 4 per form; the first option is the
recommended default) and records the answers in `docs/agents/onboarding.toml` (seed). An item is
`ask` until its questions are answered, and `skipped (chosen: …)` when an answer turns it off.

| Question     | Asks                                               | Options (first = recommended)             | Decides items  |
| ------------ | -------------------------------------------------- | ----------------------------------------- | -------------- |
| `pieces`     | What will this repo hold?                          | `web`, `site`, `lib`, `cli`               | `render`       |
| `ci`         | Which CI provider runs ci-ok?                      | `github`, `circleci`, `both`              | `render`       |
| `update_bot` | Who opens the weekly splice update PRs?            | `app`, `pat`, `session`                   | `environments` |
| `approvals`  | How are gated PRs approved?                        | `bootstrap`, `owner`                      | `approvals`    |
| `apps`       | Which GitHub Apps are installed on the repo?       | `claude`, `renovate`, `splice`, `secrets` | `apps`         |
| `secrets`    | Does the repo need secrets, such as deploy tokens? | `hoist`, `none`                           | `secrets`      |
| `bosun`      | Adopt bosun governance now?                        | `yes`, `no`                               | `bosun`        |

<a id="repo"></a>

### 1. Create the GitHub repo · computer · ready: auto · required

Create the repo under the `keelstackhq` org (D-001).
Private repos need GitHub Pro/Team for rulesets (item 5).

Check: `gh repo view` names the repo.

<a id="apps"></a>

### 2. Install the GitHub Apps · computer · ready: auto · required

Org Settings → GitHub Apps (github.com/organizations/keelstackhq/settings/installations) →
Configure each App → add the new repo:

- Claude.
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
- bosun: no App yet (designed, not built); it uses the Claude App.
- While hoist is private: hoist → Settings → Actions → Access → the keelstackhq org (once).

Check: the owner's answer to `apps`; with update bot `app`, `splice` must be among them.

<a id="environment"></a>

### 3. Set up the Claude Code web environment · computer · ready: auto · required

In claude.ai/code, create or pick the environment and note its env ID for the orchestrator.
Attach the repo. The setup script installs Node 24, pnpm 12 (the `packageManager` pin in
`package.json`), splice, plus Rust (`rust-toolchain.toml`) with Rust pieces, hoist with the
`secrets` piece and bosun when adopted. TODO(owner): the network policy (npm, crates.io and
GitHub hosts at least) and the install commands for hoist and bosun.

Check: the tools are on PATH; node major ≥ 24; pnpm major matches `packageManager`.

<a id="actions"></a>

### 4. Allow GitHub Actions · computer · ready: auto · required

Settings → Actions → General: Actions enabled for the repo. Workflows set their own
`permissions:`. TODO(owner): allowed-actions policy and the default workflow token permissions.

Faster: `hoist apply --yes` sets repo settings, Actions permissions (read), the ruleset
"hoist: default branch" requiring `ci-ok`, the environments with branch policies, and the
Cloudflare deploy token and account id secrets. The `release-tags` ruleset (item 5) and the
`release` reviewer (item 6) stay manual. Its token: GitHub Administration, Secrets, Environments
and Actions write, Contents read, repo admin; Cloudflare API Tokens Edit and Pages/Workers write,
plus `CLOUDFLARE_ACCOUNT_ID`. Check with `hoist auth check`, then `hoist check` (exit 0 = done;
exit 2 lists the human steps, as `hoist plan` does).

Check: `gh api repos/OWNER/REPO/actions/permissions` reports `enabled`.

<a id="rulesets"></a>

### 5. Add the rulesets · computer · ready: auto · required

- Branch ruleset on `main`: require a pull request, require status check `ci-ok` (D-008, D-011),
  block force pushes.
- Tag ruleset `release-tags` (hull spec §0 P2): Active, bypass Repository admin only (plus the
  release App, item 2, where one tags), include `*-v*`, restrict creations, updates and
  deletions, block force pushes.

hull's `bash scripts/owner/bootstrap-secrets.sh --check-rulesets OWNER/REPO` checks the tag
ruleset from a hull clone.

Check: the rules on `main` require `ci-ok`; an active tag ruleset `release-tags` exists.

<a id="environments"></a>

### 6. Create the environments · computer · ready: auto · required

Create every environment the rendered workflows name (`environment:` in `.github/workflows/`),
before their first run: a first run would auto-create an unprotected one. Deployment branches and
tags = Selected: `release` (always; `release.yml` runs on tag pushes) gets the tag rule `*-v*` and
the owner as required reviewer (D-008); every other one gets branch `main`: `splice-bot` (update
bot), `preview` (web pieces), `prod` (`secrets` piece); template-rust adds `release-pr`.
TODO(owner): reviewers on `prod` (`preview` and `splice-bot` run unattended, so no reviewer).

Check: each named environment exists; `release` deploys from tag `*-v*` with a required reviewer,
the others from branch `main`.

<a id="secrets"></a>

### 7. Provide the secrets · computer · ready: auto · optional: secrets

Only when pieces need them. With the `secrets` piece (D-010): the bundles live sops+age-encrypted
in a private secrets repo; the owner grants each environment its age key with
`hoist secrets grant <owner/repo> --env <env>` in the secrets repo (or hull's
`scripts/owner/bootstrap-secrets.sh`), which sets the environment secret `SOPS_AGE_KEY`; the
environment must exist first (item 6), and the printed git commands go in as a secrets-repo PR. `secrets.toml` maps `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` from the bundles. Without it: those two are secrets of the `preview` (and
prod deploy) environment, never repository secrets. Agents never hold age keys or see values.

Check: with `secrets` = `hoist`, `secrets.toml` exists and `hoist secrets check` passes (the
owner also runs `hoist secrets check` in the secrets repo, then `--remote` here).

<a id="bosun"></a>

### 8. Set up bosun · computer · ready: auto · optional: bosun

Only with `bosun` = `yes`. `bosun init --owner <login>` opens the setup PR with the channel files;
fill `governance/owners.toml`. `hoist apply` adds branch protection, auto-merge and the required
checks `ci-ok`, `risk-check`, `review-verdict`, `main-open`; then environment `splice-bot` (main
only) with secret `SPLICE_BOT_TOKEN`, and `gh label create bosun:halt --color B60205`. The owner
approves the setup PR's head (`/bosun approve <sha>` or a review) and merges it: the gates cannot
run before main has the workflows. Paste bosun's `docs/setup-script.sh` into the Claude Code
environment (item 3) and create the Routines (janitor, curator, notify). Optional:
`.bosun/approvers.toml` with the orchestrator's public key (role owner), enrolled by an R-gov PR
the owner approves on GitHub; after that, approvals go through the Claude Code form. Bootstrap
mode needs bosun ≥ 0.3.0 pinned.

Check: with `bosun` = `yes`, `bosun doctor` passes (the owner also runs `bosun doctor --remote`).

<a id="render"></a>

### 9. Render the hull template · phone · ready: auto · required

Ask the first agent to render it, or do it on a computer:
`pnpm dlx @keelstackhq/splice new gh:keelstackhq/hull//template <repo> --ref vX.Y.Z --piece <id>[:<name>] ...`
(base is always rendered), then commit `.splice/lock.toml` with the files and push.

Check: `.splice/lock.toml` exists and `splice check --offline` passes.

<a id="plan"></a>

### 10. Give the plan or brief · phone · ready: auto · required

Send the brief in chat. The agent writes it as a spec in `docs/superpowers/specs/` and a plan in
`docs/superpowers/plans/`, or, for a small project, as a `## Steps` list in
`docs/agents/project.md`. Plans end with an owner-steps section (D-009).

Check: a `.md` file in either directory, or a `## Steps` list in `docs/agents/project.md`.

<a id="approvals"></a>

### 11. Confirm how approvals work · phone · ready: auto · required

D-012: owner approvals are asked as a Claude Code chat form naming repo, PR and head SHA; the
orchestrator posts the signed bosun approval. Bootstrap mode until 2026-11-30 UTC: the
orchestrator may approve gated PRs itself after green checks and an independent review of that
head; environments, tags, releases, decisions merges, branch rules and secrets still need the
owner (release-environment taps on the phone).

Check: the owner's answer to `approvals`.
