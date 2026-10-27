# Secrets repos with SOPS, and CircleCI as a second CI provider (design)

Date: 2026-10-27 · Status: proposed (owner approves; implementation dispatched per repo) · Amends
`2026-10-14-hull-design.md` §5, §6, §8, §10, §13 and the bosun, hoist, hoard and splice specs where
named. Repos: hull, hoist, bosun, hoard, splice, decisions, keelstack.

Owner request (2026-10-27): "implement a mechanism to use one or multiple secrets repos that store
secrets in the repo with sops. There must be predefined GitHub actions/workflows that can use it
that way. Also make sure that circleci is supported as second ci infra tool - all ci jobs must work
with both."

Version facts (checked 2026-10-27 with `git ls-remote --tags`): sops `v3.13.3`, age `v1.3.2`.
Checksums are not in this spec: the task that pins a binary downloads the release's checksum file
and records the SHA-256 values with the date (CLAUDE.md: never guess).

## 0. Owner checklist — every human step, done once, before implementation

Mobile first (D-009): the computer-only steps come first and take one sitting (about 45 min); the rest
can be done on a phone. After step P4 no human step remains except batched chat approvals (§0.3).
"Verify" says how the agents confirm each step; the owner never has to report beyond pasting the
one public verification block from C5.

### 0.1 Needs a computer (in this order)

| # | Step | Where it lives | Agents verify |
|---|---|---|---|
| C1 | Install `sops` 3.13.3 (linux amd64 SHA-256 `e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b`; other platforms from `sops-v3.13.3.checksums.txt`), `age` 1.3.x, `jq`, `gh` (logged in as owner). Run `bash scripts/owner/bootstrap-secrets.sh --self-test` from a hull checkout | owner's computer | the C5 paste includes `self-test ok` (C5 runs it again) |
| C2 | Owner age keys: `age-keygen -o ~/.config/sops/age/keys.txt` (daily key; also save the file in your password manager); `age-keygen` once more and keep that output **offline** (paper or USB in a safe) as the backup key. Note both `age1…` public keys. Never put a private key in a Claude environment, chat or repo | daily key: `~/.config/sops/age/keys.txt` + password manager; backup: offline | both public keys appear as `owner-1`/`owner-2` recipients in every `*.sops.yaml` of the secrets repo (agents read the ciphertext metadata; HU-6's `hoist secrets check` enforces it from then on) |
| C3 | Repos: `gh repo create keelstackhq/secrets-shared --private --add-readme` and `gh repo create keelstackhq/hull-canary-circleci --private --add-readme`. GitHub App `keelstackhq-secrets-read` (org Settings → Developer settings → GitHub Apps → New: no webhook; Repository permissions Contents: read, Metadata: read; "Only on this account"), install it on `secrets-shared` only, generate a private key (.pem). Then: `gh variable set SECRETS_READ_APP_ID --org keelstackhq --visibility selected --repos keelstack,hull-canary-circleci --body <app id>`; `gh secret set SECRETS_READ_APP_KEY --org keelstackhq --visibility selected --repos keelstack,hull-canary-circleci < key.pem`; delete the .pem afterwards (C4 pastes it into CircleCI first) | App key: org secret + CircleCI context `secrets-read` only | repos: `list_repos`/GitHub API show both private. App + key: the first `hoist secrets check --remote` run in the canary (CAN-1) mints a token and reads `secrets-shared`; a failure there points to C3 |
| C4 | CircleCI: sign up at app.circleci.com with GitHub, create org `keelstackhq` **via the GitHub App integration** (no security groups exist for GitHub-App orgs; restrictions are per project + expression, step P3), install the CircleCI GitHub App on `hull-canary-circleci` only, create the project for it. Create context `secrets-read` with `SECRETS_READ_APP_ID` and `SECRETS_READ_APP_KEY` (paste the .pem). Create a personal API token (User settings → Personal API tokens) and note the org ID (Organization settings → Overview) for C5 | CircleCI org + context `secrets-read`; the token only in your shell for C5, then revoke it | CAN-1: the canary's first pipeline reports `ci/circleci: ci-ok` on GitHub (agents read the commit statuses) |
| C5 | Cloudflare: create a preview-only API token (`keelstack-preview`: Workers Scripts Edit + Cloudflare Pages Edit, this account) and have the current prod token and account ID ready. Then run, with `CIRCLECI_TOKEN` and `CIRCLECI_ORG_ID` exported (`read -rs CIRCLECI_TOKEN; export CIRCLECI_TOKEN`): `gh repo clone keelstackhq/secrets-shared ~/src/secrets-shared` and `bash scripts/owner/bootstrap-secrets.sh --secrets-dir ~/src/secrets-shared --owner-pub <daily age1> --owner-pub <backup age1> --consumer keelstackhq/keelstack:preview:github --consumer keelstackhq/keelstack:prod:github --consumer keelstackhq/hull-canary-circleci:prod:circleci --bundle preview/cloudflare=CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID@keelstack-preview --bundle prod/cloudflare=CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID@keelstack-prod --bundle prod/canary=CANARY_SMOKE@hull-canary-circleci-prod --push`. It prompts (hidden) for each value (`CANARY_SMOKE`: any non-secret word), generates the three CI keys and stores each private key straight into the GitHub environment / CircleCI context (never shown), creates `preview`/`prod` environments with a main-only branch rule, writes `access.toml`, `.sops.yaml` and the encrypted bundles, and pushes. Paste the printed "paste into the chat" block (public data only). Revoke the CircleCI token | values: encrypted in `secrets-shared`; CI keys: environment secrets `SOPS_AGE_KEY` (keelstack `preview`, `prod`) and CircleCI context `hull-canary-circleci-prod` | agents compare the pasted public keys with the recipients in `secrets-shared` (`*.sops.yaml` metadata, `access.toml`), check each file is ciphertext, and read the environments' branch policies through the GitHub API; the end-to-end check is HU-4's first `deploy`/`preview-deploy` run and CAN-1's deploy smoke job (`CANARY_SMOKE` non-empty) |

The script is `scripts/owner/bootstrap-secrets.sh` in this PR; its test
(`tests/bootstrap-secrets.test.mjs`) runs it against a stub `gh` with keys generated at test time and
proves: keys go only through stdin, nothing secret lands in the repo, each consumer decrypts only its
bundle. It does the v1 consumers; later consumers use `hoist secrets grant` (HO-3/HO-4), which the
owner runs only when adding a consumer, which is outside this implementation.

### 0.2 Phone is enough (any order, after C3/C4)

| # | Step | Agents verify |
|---|---|---|
| P1 | github.com → Settings → Applications → Claude → Configure: add `secrets-shared` and `hull-canary-circleci` to the Claude GitHub App | `list_repos` lists both; `add_repo` attaches them |
| P2 | Rulesets (repo → Settings → Rules → New branch ruleset, target default branch): `secrets-shared`: require PR + Code Owners review, block force pushes, required check `ci-ok`; `hull-canary-circleci`: require PR, block force pushes, required check `ci-ok` with source "GitHub Actions" | GitHub API `GET /repos/{r}/rulesets` (read access) shows the rules |
| P3 | app.circleci.com → project `hull-canary-circleci` → Project settings: Advanced → enable "dynamic config using setup workflows", "Build forked pull requests" on, "Pass secrets to builds from forked pull requests" off, "Prevent unregistered users from triggering builds" off (merge queue, §12 item 9); Triggers: PRs, default-branch pushes, "Pushes to merge queues". Organization settings → Contexts: `hull-canary-circleci-prod` → Project restriction = the canary project, Expression restriction `pipeline.git.branch == "main"`; `secrets-read` → Project restriction = the canary project | CAN-1: setup+`ci-ok` runs on a PR, on `main` and on a merge-queue branch; a deploy job on a non-main branch fails with a context authorization error (the restriction works) |
| P4 | Repo settings of `hull-canary-circleci` → Merge queue on for `main` (so CAN-1 can test §7.3) | CAN-1 queues a PR and sees `ci-ok` mirrored on the queue SHA |

No first publish is needed: no new npm package, scope or registry account. hoist, hoard and splice
already have release flows.

### 0.3 What stays, as batched chat approvals only

- Approve owner-approval PRs (overview table); the orchestrator records them with `/bosun approve`.
- Merge DEC-1 in `keelstackhq/decisions` (owner-merged, D-002), phone.
- Approve the `release` environment for the hoist and hoard releases (GitHub mobile → Actions → Review
  deployments), phone.
- Optional, off the critical path: tag splice `v0.3.0` (github.com → splice → Releases → Draft new
  release), phone. Only HU-9's `min_splice` bump and switching existing repos to `circleci-only` wait
  for it; nothing else blocks on it.

## 1. Goals and non-goals

Goals:
1. Secrets live encrypted in one or more private **secrets repos** (sops + age). Any consumer repo
   declares which secrets it needs, from which repos, for which environment.
2. One runtime, `hoist secrets exec`, decrypts in CI on both providers. A predefined GitHub
   composite action, a reusable GitHub workflow and a CircleCI command wrap it.
3. Agents (Claude cloud sessions) never hold an age private key and never see plaintext. Code from
   an unmerged PR never runs in a job that can decrypt.
4. A hull-rendered repo picks its CI provider at render time: GitHub Actions (default), CircleCI,
   or both. Every CI job (§7.1) runs on either, from one source of truth, with parity tests.
5. Required check names do not change: `ci-ok` (or `bosun-ok`), `risk-check`, `review-verdict`,
   `main-open`. Rulesets and bosun's required-check list stay as they are.

Non-goals (v1): KMS/Vault/1Password backends (sops supports KMS; §3.10 says how to add it later),
a published CircleCI orb (§6.6), CircleCI for the event-driven governance and release workflows
(§8), automatic value rotation for providers other than Cloudflare, Windows/macOS on the PR path.

## 2. Decisions

Each line: decision, reason, rejected options.

| # | Decision | Reason | Rejected |
|---|---|---|---|
| S1 | sops + age; one age key pair per (consumer repo, environment) plus ≥ 1 human owner key per file | age keys are small, offline, no cloud account; per-consumer keys make revoke exact | GPG (key management pain); KMS as default (cloud account per env); Vault/1Password (a server or paid SaaS); GitHub/CircleCI native secrets as the source of truth (no review, no history, provider lock-in) |
| S2 | Encrypted files are YAML: `<env>/<bundle>.sops.yaml`, flat `KEY: value`; keys stay plaintext, values encrypted | key names are reviewable and checkable without decryption | dotenv (no per-key metadata, no comments); JSON (unreadable diffs); binary (no key selection) |
| S3 | Access is declared in the secrets repo's `access.toml`; `.sops.yaml` is generated from it and CI-checked | one human-edited source; `.sops.yaml` regex rules are easy to get wrong | hand-edited `.sops.yaml`; recipients in each consumer repo |
| S4 | Consumers declare needs in a root `secrets.toml` (not in `hoist.toml`) | not every repo has `hoist.toml`; one exact path for risk rules and globbing | a `[secrets]` table in `hoist.toml`; inputs inlined in each workflow |
| S5 | Sources track a branch (`ref = "main"` default); a commit SHA is allowed | a rotation lands once in the secrets repo, with no PR in every consumer | SHA pin only (N PRs per rotation) |
| S6 | CI reads secrets repos with a GitHub App installation token (`contents: read`, only on secrets repos), minted per job and scoped to the listed sources | one credential for many repos; short-lived; read-only; it only reveals ciphertext | deploy keys (one per secrets repo, a key can be a deploy key on only one repo, N×M rotation); PAT (user-bound, broad); public secrets repos (leaks names and recipients; harvest-now-decrypt-later) |
| S7 | `SOPS_AGE_KEY` is the only CI secret that yields plaintext; the App key yields ciphertext only | keeps the blast radius of each credential clear | one combined credential |
| S8 | Runtime is `hoist secrets exec --env E --keys A,B -- cmd`: values go into the child's environment only, child output is redacted, file secrets go to a 0700 dir on `/dev/shm`, removed on exit | process scope works the same on both providers; CircleCI has no runtime `add-mask`; nothing touches the workspace or `$GITHUB_ENV`/`$BASH_ENV` files | export mode via `$GITHUB_ENV`/`$BASH_ENV` (plaintext in files on disk, no masking on CircleCI); `sops exec-env` (exports every key of a file); a JS action (node deps); bash only (masking bugs are hard to test) |
| S9 | hoist owns all secrets tooling (`hoist secrets …`) | it already seals GitHub secrets, rotates Cloudflare tokens, ships checksummed release binaries and has a GitHub client and `zeroize` | a new tool (another release pipeline); bosun (governance, not provisioning) |
| S10 | hoist shells out to pinned `sops` and `age-keygen`; no sops/age reimplementation | sops' file format and MAC are the security boundary; reuse the reference implementation | Rust crates `age`/a sops port (new deps, a second implementation of the MAC) |
| S11 | The secrets repo template is `template-secrets/` in hull (like `template-rust/`) | hull already hosts several templates with canaries; splice renders it; hull CI dogfoods it | a hull piece (a secrets repo is not a monorepo); a template inside hoist (no render tests there) |
| S12 | Decrypting jobs run only workflow code **and** executed code from a protected ref: `push` to main, release tags, `workflow_dispatch` on main, or `workflow_run` (definition from the default branch) that only deploys a built artifact | a `pull_request` run uses the PR's workflow file, so a same-repo PR (an agent's) could print secrets before any review | environment secrets on `pull_request` with reviewers (every PR waits for the owner); `pull_request_target` (runs with secrets on attacker-influenced input) |
| S13 | Previews become two-phase: `preview` builds on `pull_request` without secrets and uploads an artifact; `preview-deploy` (`workflow_run`, environment `preview`) decrypts and deploys it without running PR code | closes the current hole (`preview.yml` reads `CLOUDFLARE_API_TOKEN` in PR code) | keep the current single job |
| P1 | Provider is chosen with pieces: none = GitHub; `circleci` = both; `circleci` + `circleci-only` = CircleCI | the contract has no comparisons (§9.2) and vars are fixed at `new`; pieces can be added later with `splice add` | a var `ci = "github"|"circleci"|"both"` (cannot branch on its value); two flag vars (cannot change after `new`) |
| P2 | One CI step list, `CI_PLAN` in `scripts/lib/ci-tasks.mjs`; `scripts/gen-ci.mjs` writes the GitHub `ci.yml` and the CircleCI job from it; parity tests compare both to `CI_PLAN` | one source of truth, drift fails a test | hand-written twins; a provider-neutral YAML DSL |
| P3 | CircleCI config is dynamic: an owned setup `.circleci/config.yml` packs `.circleci/src/**` fragments (`circleci config pack`) and continues | hull and the bosun channel each add fragments; no two sources write the same file (owner rule: fragments for shared files) | one generated `config.yml` (hull and bosun would both write it) |
| P4 | In `circleci-only` mode the required `ci-ok`/`bosun-ok` is a commit status that a tiny GitHub workflow mirrors from CircleCI's terminal `ci/circleci: ci-ok` status | the CircleCI GitHub App always reports `ci/circleci: <job>`; mirroring keeps the name; GitHub credentials stay on GitHub | CircleCI posts `ci-ok` itself with a GitHub App key (a same-repo PR build could forge green); renaming required checks (owner rule: names must not change) |
| P5 | In `both` mode GitHub's `ci-ok` stays required; CircleCI runs and reports `ci/circleci: ci-ok` as advisory; no mirror | two writers of one required name would be ambiguous; `both` is a migration/comparison mode | require both; mirror in both mode |
| P6 | Event-driven governance and releases stay on GitHub Actions in every mode (§8) | they need GitHub-only events (`pull_request_target`, `issue_comment`, `pull_request_review`, labels), a write `GITHUB_TOKEN`, environment approvals and npm OIDC | CircleCI API-triggered pipelines from a webhook relay (a server to host, a GitHub write token outside GitHub) |
| P7 | CircleCI turbo cache: hoard with `storage = fs` in a directory saved/restored by CircleCI's cache; `r2` optional | zero accounts, mirrors hoard's GitHub default; R2 lets `both` mode share one cache | CircleCI cache of `.turbo` only (no remote-cache API, misses across tasks); Vercel remote cache (account) |
| P8 | No CircleCI orb in v1; the CircleCI `secrets-exec` command and hoard steps are template fragments, byte-identical to reference copies in hoist and hoard | orbs need a registry namespace and add a third-party trust step; fragments are pinned and parity-tested | publish `keelstackhq/secrets` orb now (owner can add it later, §6.6) |

## 3. Secrets repos

### 3.1 Layout (rendered from `template-secrets/`)

```
README.md              what is here, who may decrypt what, how to rotate (seed)
access.toml            recipients and rules (shared, toml merge) — the only file humans edit for access
.sops.yaml             generated from access.toml by `hoist secrets sync` (owned by hoist, CI-checked)
CODEOWNERS             * @<owner> (owned)
<env>/<bundle>.sops.yaml   encrypted bundles, e.g. prod/cloudflare.sops.yaml, preview/cloudflare.sops.yaml
.github/workflows/check.yml   `hoist secrets check` on pull_request + weekly expiry check (owned)
.circleci/…            only with the `circleci` piece (§7)
```

Each secrets repo is private, has a ruleset (PR required, CODEOWNERS review, no force-push,
`check` required) and contains no plaintext ever. Suggested repos: `keelstackhq/secrets-shared`
(Cloudflare account tokens, shared SaaS) and one `keelstackhq/secrets-<project>` per project with
its own blast radius. A consumer may use several.

### 3.2 `access.toml`

```toml
version = 1

[[recipient]]
name = "owner-2026"            # a human key; the owner keeps the private key offline
kind = "human"
age = "age1…"
expires = "2027-10-27"

[[recipient]]
name = "keelstack-prod"        # one key per (consumer repo, environment)
kind = "ci"
repo = "keelstackhq/keelstack"
env = "prod"
provider = "github"            # github | circleci: where hoist stored the private key
age = "age1…"
expires = "2027-10-27"

[[rule]]
path = "prod/**"
recipients = ["owner-2026", "keelstack-prod"]

[[rule]]
path = "preview/**"
recipients = ["owner-2026", "keelstack-preview"]
```

Rules: names `[a-z0-9-]+`, unique; every rule has ≥ 1 `human` recipient (recovery); a `ci`
recipient appears only in rules whose path starts with its `env/`; globs are evaluated first match
wins, in file order; `expires` ≤ 13 months from `added`. `.sops.yaml` gets one `creation_rules`
entry per rule (path regex derived from the glob, `age` = the recipients' public keys, comma-joined,
in `access.toml` order) so the output is deterministic.

### 3.3 Consumer manifest `secrets.toml` (consumer repo root, seed)

```toml
version = 1

[sources]
shared = { repo = "keelstackhq/secrets-shared" }                 # ref defaults to "main"
site   = { repo = "keelstackhq/secrets-keelstack", ref = "main" }

[env.preview]
CLOUDFLARE_API_TOKEN = "shared:preview/cloudflare.sops.yaml#CLOUDFLARE_API_TOKEN"

[env.prod]
CLOUDFLARE_API_TOKEN = "shared:prod/cloudflare.sops.yaml#CLOUDFLARE_API_TOKEN"
SENTRY_AUTH_TOKEN    = "site:prod/sentry.sops.yaml#token"

[env.prod.files]                                                   # whole value to a file; the
GCP_CREDENTIALS_FILE = "site:prod/gcp.sops.yaml#service_account"   # env var holds its path
```

- Left side: the env var name in the child process (`[A-Z_][A-Z0-9_]*`).
- Right side: `<source>:<path>#<key>`. `<path>` must match `^[a-z0-9-]+/[a-z0-9._-]+\.sops\.yaml$`
  and start with the env name the consumer was granted.
- The environment name (`preview`, `prod`, `release`, …) equals the GitHub environment name and the
  CircleCI context suffix (§5.3), so one name links manifest, key and protection.

### 3.4 Commands (hoist; who may run them)

| Command | What | Runs | Decrypts? |
|---|---|---|---|
| `hoist secrets check` | in a secrets repo: `access.toml` valid, `.sops.yaml` == generated, every `*.sops.yaml` encrypted (sops metadata + MAC present, no plaintext value except `*_unencrypted` keys), each file's `sops.age[].recipient` set == its rule, ≥ 1 human, expiry warnings (30 days). In a consumer repo: `secrets.toml` valid; with `--remote`, every referenced file and key exists (key names are plaintext) | agents, CI | no |
| `hoist secrets sync` | regenerate `.sops.yaml`, then `sops updatekeys -y` on every file whose recipients changed | owner | data key only (needs an owner age key) |
| `hoist secrets grant <repo> --env E [--provider github\|circleci]` | `age-keygen` in memory; private key straight to the consumer's GitHub environment secret `SOPS_AGE_KEY` (sealed box, existing code) or CircleCI context `<repo>-<env>` env var; public key into `access.toml`; `sync`; branch + PR in the secrets repo. Private key is zeroized, never printed or written | owner | data key only |
| `hoist secrets revoke <recipient>` | remove from `access.toml`, `sync`, `sops rotate -i` (new data key) on the affected files, delete the CI secret, then print every key the recipient could read: **those values must be rotated** (git history keeps old ciphertext readable by the revoked key) | owner | yes (owner) |
| `hoist secrets rotate-key <recipient>` | `grant` a new key under the same name + `-YYYYMM`, then `revoke` the old one | owner | yes (owner) |
| `hoist secrets edit <file>` | `sops edit` with the owner's key | owner | yes (owner) |
| `hoist secrets rotate [NAME] --to <src>:<path>#<key>` | existing Cloudflare rotation (mint, verify, revoke old) writes the new value into the sops file instead of a GitHub secret | owner | yes (owner) |
| `hoist secrets repo init <owner/name>` | create the private repo, ruleset, environments none; print the `splice new gh:keelstackhq/hull//template-secrets` command | owner | no |
| `hoist secrets exec --env E --keys A,B [--manifest secrets.toml] -- cmd…` | the CI runtime (§4) | CI only | yes (CI key) |

Every decrypting command refuses to run when `CLAUDECODE` or `CLAUDE_CODE_REMOTE` is set (agent
sessions), exit 2 with "secrets: decryption is owner- or CI-only". `exec` also refuses outside CI
(§4.2). Agents may run `check`, author `access.toml`/`secrets.toml` changes in PRs, and render
`template-secrets`; the owner runs `sync` after merging an access change.

### 3.5 Rotation and revocation

- **Value rotation:** `hoist secrets edit` or `hoist secrets rotate`; consumers pick it up on the
  next run (S5).
- **Data key rotation:** `sops rotate -i` per file; `hoist secrets sync --rotate` for all files;
  yearly, and always after a revoke.
- **Consumer key rotation:** `rotate-key`, yearly via `expires`; the weekly `check` run opens an
  issue `secrets:expiring` 30 days before.
- **Revoking a consumer:** `revoke`, then rotate the listed values at the provider (Cloudflare etc.).
  A revoked key cannot read new ciphertext, but can read old commits; only value rotation ends that.
- **Lost owner key:** a second human recipient (a second owner key in a safe) is recommended;
  `check` warns when a rule has exactly one human recipient.

### 3.6 Optional KMS later

sops `creation_rules` can add `kms`/`gcp_kms`/`azure_keyvault` next to `age`. `access.toml` would
get `kind = "kms"` recipients; `check` treats them like `ci` recipients. Not built in v1.

## 4. The runtime: `hoist secrets exec`

### 4.1 Steps

1. Read `secrets.toml`; select `[env.E]` and `[env.E.files]`; keep only `--keys` (required; an
   unknown key is exit 3). Nothing else is ever fetched.
2. Token: `HOIST_SECRETS_TOKEN` if set (GitHub action passes the token from
   `actions/create-github-app-token`), else mint an installation token from `SECRETS_READ_APP_ID`
   + `SECRETS_READ_APP_KEY` (RS256 JWT, 9 min), restricted to the listed source repos with
   `contents: read`. On CircleCI the second path is used.
3. Fetch each needed file once through the contents API (`Accept: application/vnd.github.raw`) into
   memory. No `git clone`, nothing on disk.
4. Decrypt each file with `sops decrypt --input-type yaml --output-type json /dev/stdin`, the file on
   stdin, `SOPS_AGE_KEY` only in that child's environment; parse JSON in memory; keep only the
   requested keys; zeroize the rest.
5. File secrets: create `/dev/shm/hoist-<random>/` (0700), write each value 0600, set the env var to
   its path. If `/dev/shm` is missing, exit 2 (never fall back to disk).
6. Run `cmd` with the parent environment minus `SOPS_AGE_KEY`, `SECRETS_READ_APP_KEY` and
   `HOIST_SECRETS_TOKEN`, plus the requested values.
7. Redact: child stdout/stderr are read line-buffered and every occurrence of each value, its
   base64 and its URL-encoded form (values ≥ 4 bytes) is replaced by `***` before it reaches the
   log. On GitHub, hoist also prints `::add-mask::` for each value (and each line of multi-line
   values) before starting the child.
8. On exit or signal: remove the shm dir, zeroize, return the child's exit code.

### 4.2 Guards (exit 2, before any fetch)

- `CI` must be `true` and exactly one of `GITHUB_ACTIONS`/`CIRCLECI` set.
- GitHub: `GITHUB_EVENT_NAME` must be one of `push`, `workflow_dispatch`, `workflow_run`,
  `schedule`, `release`; everything else (`pull_request*`, `merge_group`, `issue_comment`,
  `pull_request_review*`, `status`) is refused. `GITHUB_REF` must be the default branch or a release
  tag (`workflow_run` runs with the default-branch ref, so `preview-deploy` passes; a workflow pushed
  on an agent's branch does not). `workflow_run`: the triggering run's head repository must be this
  repository (no fork artifacts).
- CircleCI: refused when `CIRCLE_PR_REPONAME` differs from `CIRCLE_PROJECT_REPONAME` (fork), or when
  `CIRCLE_BRANCH` is not the default branch and `CIRCLE_TAG` is not a release tag. No override flag.
- The guards are defence in depth; the binding controls are the environment branch rules (§5.2) and
  context expression restrictions (§5.3), because a branch-pushed workflow can skip hoist and read
  `SOPS_AGE_KEY` directly if its environment allows that branch.
- Agent session variables (§3.4).

### 4.3 Predefined CI wrappers

**GitHub composite action** `keelstackhq/hoist/secrets` (in the hoist repo, `secrets/action.yml`):

```yaml
- uses: keelstackhq/hoist/secrets@<sha>   # v0.x.y
  with:
    env: prod                         # also the job's `environment:`
    keys: CLOUDFLARE_API_TOKEN,SENTRY_AUTH_TOKEN
    run: pnpm turbo run deploy --filter=./apps/*
    app-id: ${{ vars.SECRETS_READ_APP_ID }}
    app-key: ${{ secrets.SECRETS_READ_APP_KEY }}
    age-key: ${{ secrets.SOPS_AGE_KEY }}
```

Consumers pin it by full commit SHA with the tag in a comment (`@<sha> # v0.x.y`; Renovate bumps
it); a hull test fails on a tag-only reference in a decrypting job. It installs hoist (this action's
release, SHA-256 checked) and sops (pinned version, SHA-256
checked, linux x64/arm64), mints the token with `actions/create-github-app-token` pinned by commit
SHA (`repositories:` = sources from `secrets.toml`, `permission-contents: read`), then runs
`hoist secrets exec`. Inputs go through `env:`, never interpolated into `run:` text.

**Reusable workflow** `keelstackhq/hoist/.github/workflows/secrets-run.yml@<sha>` for job-level use:
inputs `environment`, `keys`, `run`, `ref` (default `github.sha`), `node` (default true:
pnpm/node setup + install); `secrets: inherit`. It sets `environment: ${{ inputs.environment }}`
so environment protection applies to the caller's repo.

**CircleCI command** `secrets-exec` (reference copy `hoist/secrets/circleci/secrets-exec.yml`;
hull's `secrets` piece ships a byte-identical `.circleci/src/commands/secrets-exec.yml` when
`circleci` is present):
parameters `env`, `keys`, `run`; installs pinned hoist + sops with SHA-256 check; reads
`SOPS_AGE_KEY`, `SECRETS_READ_APP_ID`, `SECRETS_READ_APP_KEY` from contexts (§5.3).

### 4.4 Which jobs may decrypt

| Job | GitHub | CircleCI |
|---|---|---|
| `ci-ok` / `bosun-ok` (PR path) | never | never |
| `preview` build | never | never |
| `preview-deploy` | `workflow_run` of `preview`, environment `preview`, same-repo head only, deploys the artifact | not offered: CircleCI cannot run a protected (default-branch) definition for a PR, so previews (build and deploy) stay on GitHub in every mode — §8 |
| `deploy` (prod) | `push` to main, environment `prod` (required reviewer optional, deployment branch `main`) | workflow on `main` only, `type: approval` hold, context `<repo>-prod` with expression restriction `pipeline.git.branch == "main"` |
| `release` | tag push, environment `release` (owner approves, D-008) | GitHub only (§8) |
| `desktop`, Storybook, nightly | never (no secrets needed) | never |

## 5. Security model

### 5.1 Threats and controls

| Threat | Control |
|---|---|
| An agent reads plaintext | agents never get `SOPS_AGE_KEY` (owner never sets it in Claude environments); decrypting hoist commands refuse in agent sessions; bosun hook denies `sops decrypt/-d/edit/exec-*`, `age -d`, `hoist secrets edit|revoke|rotate*|sync`, reads of `keys.txt`, and `printenv`/`echo` of `SOPS_AGE_KEY` (BO-1) |
| A PR changes a workflow to dump secrets | S12: no decrypting job runs PR-controlled workflow code or PR code; `pull_request` jobs have no environment with `SOPS_AGE_KEY` |
| A PR changes the deploy workflow, merged unseen | bosun `R-secrets` and the critical floor make changes to `secrets.toml`, `.sops.yaml`, `access.toml`, `**/*.sops.yaml`, `.github/workflows/**`, `.github/actions/**`, `.circleci/**` owner-approved |
| Fork PR gets secrets | GitHub: no secrets on fork `pull_request`; `preview-deploy` checks head repo. CircleCI: "Pass secrets to builds from forked pull requests" off; contexts project- and expression-restricted |
| `pull_request_target`/`issue_comment` jobs (risk, verdict, main-open) leak | they never reference a secrets environment; `exec` refuses those events; hull test: no template workflow with those triggers has `environment:` or `SOPS_AGE_KEY` |
| PR code runs inside `preview-deploy` | the artifact holds only pre-bundled output (Worker bundle, static assets); `wrangler.jsonc`, `package.json` and the lockfile come from the default-branch checkout; deploy uses `wrangler deploy --no-bundle` / `wrangler pages deploy <dir>` with no build step; the job rejects an artifact containing `wrangler.json*`, `package.json`, `*.toml` or symlinks (hull test) |
| A malicious preview artifact at runtime | it runs only on Cloudflare preview Workers/Pages with preview-only bindings; the preview token is a separate Cloudflare token from prod; prod deploy builds from `main` |
| Values in logs | §4.1 step 7 redaction + GitHub masks; hoist never prints values, even with `-v`; tests feed a fixture value through every error path |
| Plaintext on disk | none in the workspace; file secrets only on `/dev/shm`, removed on exit |
| Stolen App key | ciphertext only (S7); rotate the App key; secrets repos stay private |
| Stolen consumer age key | `revoke` + value rotation (§3.5); per-(repo, env) keys bound the damage |
| Forged `ci-ok` status in circleci-only mode | the mirror (§7.4) trusts only terminal statuses created by the CircleCI app; the ruleset pins `ci-ok`'s expected source to GitHub Actions. That does not stop a same-repo PR from adding a workflow with `statuses: write` that posts `ci-ok` (the same hole as editing `ci.yml` in github mode): the binding control is the required `risk-check`, which makes any `.github/workflows/**` or `.circleci/**` change owner-approved (R-ci, critical floor) |

### 5.2 GitHub setup per consumer

Environments `preview`, `prod`, `release` with secret `SOPS_AGE_KEY` each (written by
`hoist secrets grant`). **Every** secrets environment has deployment-branch rules, otherwise any
workflow pushed on any branch (by an agent, no PR needed) could name the environment and print the
key: `preview` and `prod`: branch `main` only (`preview-deploy` runs via `workflow_run` with the
default-branch ref, so it qualifies); `release`: tags `*-v*`, owner reviewer (D-008). `hoist secrets
grant` creates the environment with these rules and refuses to store a key in an environment that has
none (`check --remote` flags drift). Org variable `SECRETS_READ_APP_ID`, org secret `SECRETS_READ_APP_KEY` restricted to the
consumer repos.

### 5.3 CircleCI setup per consumer

Org context `secrets-read` (`SECRETS_READ_APP_ID`, `SECRETS_READ_APP_KEY`), project restriction
to the consumer projects. Per environment a context `<repo>-<env>` (e.g. `keelstack-prod`) holding
`SOPS_AGE_KEY`, with a project restriction and an expression restriction
`pipeline.git.branch == "main"` on **every** env context (a release context may allow the release
tag pattern instead). Security-group restrictions exist only for OAuth-connected orgs;
GitHub-App orgs use project and expression restrictions (CircleCI docs, 2026). Project settings:
build forked PRs on, pass secrets to forks **off**.

## 6. CircleCI provider

### 6.1 Selection (P1)

| Mode | Pieces | GitHub workflows rendered | CircleCI |
|---|---|---|---|
| github (default) | — | ci, preview‡, preview-deploy*, deploy*, desktop†, release | none |
| both | `circleci` | same as github; `ci-ok` stays required | setup + ci-ok only; advisory |
| circleci | `circleci` + `circleci-only` | release, preview‡, preview-deploy*, `circleci-status` (mirror) | setup + ci-ok, deploy*, desktop†; `ci-ok` mirrored |

\* with the `secrets` piece. † with `tauri-app`. ‡ with a deployable app (`apps/*/wrangler.jsonc`).
Scheduled and deploying jobs run on exactly one provider (GitHub in github and both mode, CircleCI in
circleci mode), so `both` never deploys twice: GitHub `deploy.yml` and `desktop.yml` carry the
`circleci-only` guard below; their CircleCI fragments carry `{% if "circleci-only" in pieces %}`.

`circleci-only` requires `circleci`. Base files that disappear in circleci mode become `.jinja`
with `{% if "circleci-only" in pieces %}{% else %}{% raw %}…{% endraw %}{% endif %}`; an empty
render is not written (contract §4). The `{% raw %}` needs `min_splice` 0.2.0 (hull's manifest
moves from 0.1.0; splice 0.2.1 is current). Switching an existing repo to `circleci-only` later needs
splice to delete an owned file whose re-render is empty: new contract rule 9.27 (§10), splice 0.3.0.
Until splice 0.3.0 is released, `circleci-only` is supported at `new` only; HU-9 raises hull's
`min_splice` to 0.3.0 once it is, and the docs then describe `splice add circleci` /
`splice add circleci-only` as the way to switch.

`template-rust` gets the same two pieces with `RUST_CI_STEPS` (HU-7).

### 6.2 One source of truth (P2)

`scripts/lib/ci-tasks.mjs` keeps `CI_TASKS` and `RUST_CI_STEPS` and adds `CI_PLAN`: an ordered
list of step ids with per-provider bodies:

`timer, checkout, agents-index, affected, setup-pnpm-node, install, turbo-cache, rust-affected,
rust-toolchain, rust-cache, rust-tools, run-affected, duration`.

`scripts/gen-ci.mjs` writes `template/pieces/base/files/.github/workflows/ci.yml.jinja` and
`template/pieces/circleci/files/.circleci/src/jobs/ci-ok.yml` (and the template-rust pair). Both
carry `# step: <id>` comments. Tests: (1) regenerating equals the checked-in files; (2) the step-id
sequence in both equals `CI_PLAN`; (3) the task list in both equals `CI_TASKS` (existing parity
test extended); (4) in HU-1b the generated `ci.yml` equals today's `ci.yml` after stripping the
`# step:` comment lines; HU-3 renames it to `ci.yml.jinja` (guard + raw block).

### 6.3 CircleCI files and which piece owns them

```
circleci piece (owns exactly these paths, no `.circleci/**` glob):
.circleci/config.yml                 setup: true; packs .circleci/src, continues
.circleci/src/@config.yml            version: 2.1
.circleci/src/executors/node.yml     cimg/base pinned by digest, resource_class medium
.circleci/src/commands/hoard.yml     start/stop hoard fs + restore/save cache (= hoard reference)
.circleci/src/jobs/ci-ok.yml         generated (§6.2)
.circleci/src/workflows/ci.yml       ci-ok on every branch incl. gh-readonly-queue/*
.circleci/scripts/scm-base.sh        TURBO_SCM_BASE for CircleCI (§6.4)
.circleci/src/jobs/desktop.yml.jinja + workflows/desktop.yml.jinja
                                     {% if "tauri-app" in pieces %} inside {% if "circleci-only" in pieces %}
                                     (in this piece because tauri-app's files are under apps/<name>/)
secrets piece (root files, no target):
.circleci/src/commands/secrets-exec.yml.jinja   {% if "circleci" in pieces %} (= hoist reference, §4.3)
.circleci/src/jobs/deploy.yml.jinja, workflows/deploy.yml.jinja   {% if "circleci-only" in pieces %}
```

The setup job installs the CircleCI CLI (pinned, SHA-256) and runs `circleci config pack
.circleci/src > /tmp/continue.yml`, then calls the continuation API (`circleci/continuation` is not
used: no orbs, P8). The bosun channel adds `.circleci/src/jobs/bosun-ok.yml` and
`.circleci/src/workflows/bosun.yml`; nothing else.

### 6.4 Behaviour parity

- **Triggers:** CircleCI GitHub App triggers: PR opened/pushed, push to default branch, "pushes to
  merge queues" (makes `gh-readonly-queue/*` report the required check). No path filters.
- **Checkout:** `checkout: method: blobless` (CircleCI's blobless clone), then
  `git fetch origin <default>` so turbo can diff. Unverified (§12).
- **Affected early exit:** the same `affected` step (same turbo binary download, same
  `.github/scripts/affected.mjs`; the script path stays for both providers). `TURBO_SCM_BASE` from
  `scm-base.sh`: merge-queue branch `gh-readonly-queue/<base>/pr-<n>-<sha>` → `<sha>`; default branch
  → `<< pipeline.git.base_revision >>`; else `git merge-base HEAD origin/<default>`.
  `TURBO_SCM_HEAD` = `CIRCLE_SHA1`.
- **Caching:** pnpm store via `restore_cache`/`save_cache` keyed on `pnpm-lock.yaml`; turbo via
  hoard `fs` in `~/.cache/hoard`, cache key `hoard-v1-{{ .Branch }}-{{ .Revision }}` restoring
  `hoard-v1-{{ .Branch }}-` then `hoard-v1-main-` (P7). Rust: `~/.cargo` and `target/` keyed on
  `Cargo.lock` + `rust-toolchain.toml`.
- **Budgets:** GitHub budget unchanged (45 s typical PR, 15 s docs-only). CircleCI: setup + one job,
  docker executor, ≤ 75 s typical PR, ≤ 30 s docs-only (setup adds a container start). D-011
  extends D-007 to CircleCI: one workflow, setup + one job on the PR path, no macOS on the PR path,
  scheduled pipelines at most weekly.
- **Heavy work:** desktop (Tauri) and Storybook builds are CircleCI scheduled pipelines (weekly) and
  manual pipelines, never on the PR path, like GitHub.

### 6.5 bosun on CircleCI

The bosun channel gets pieces `circleci` and `circleci-only` (mirror hull's; `bosun init` reads
`.splice/lock.toml` and picks them; `bosun doctor` fails when they differ from the main template's).
`bosun-ok` (or `ci-ok` when `own_ci` is empty) runs `bosun gates` in a CircleCI job; `bosun gates`
learns CircleCI's env (`CIRCLECI`, `CIRCLE_BRANCH`, base from the same `scm-base` rules; `--all` on
default-branch and merge-queue pipelines). When `own_ci` is empty (repo not rendered from hull), the
channel also ships the setup `config.yml`, `@config.yml` and the mirror, guarded by
`{% if own_ci %}{% else %}…{% endif %}`, byte-identical to hull's (parity test against a vendored
copy at a pinned hull tag).

### 6.6 Orb later

Once the owner creates the CircleCI namespace `keelstackhq`, `secrets-exec` and `hoard` commands can
be published as `keelstackhq/secrets` and `keelstackhq/hoard` orbs from their reference copies. Not
in v1.

## 7. Required checks on CircleCI

### 7.1 What "all CI jobs work with both" means

CI jobs = the jobs that verify or ship code on every change or schedule: `ci-ok` (lint, format,
typecheck, test, build, Rust steps, agents-index check, affected exit), `bosun-ok`/bosun gates,
prod deploy, desktop/Storybook scheduled builds, bosun nightly gates. Each has a GitHub and a
CircleCI implementation from the same step source, and dogfood renders and validates both. Not CI
jobs in this sense, and GitHub-only by design: governance, releases and PR previews (§8).

### 7.2 Names

The CircleCI job is named `ci-ok` (and `bosun-ok`), so it reports `ci/circleci: ci-ok`. In
`circleci` mode the mirror turns that into `ci-ok`. In `both` mode it stays advisory (P5).

### 7.3 Merge queue

GitHub creates `gh-readonly-queue/main/…`; CircleCI's merge-queue trigger runs `ci-ok` on it; the
mirror posts `ci-ok` on that SHA. `merge_group` stays a trigger of the GitHub `ci.yml` in github and
both modes.

### 7.4 The mirror `.github/workflows/circleci-status.yml` (circleci-only mode)

```yaml
on: status
permissions: { statuses: write }
jobs:
  mirror:
    if: >-
      (github.event.context == 'ci/circleci: ci-ok' || github.event.context == 'ci/circleci: bosun-ok')
      && github.event.state != 'pending'
      && github.event.sender.login == 'circleci-app[bot]'
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - run: gh api "repos/$REPO/statuses/$SHA" -f state="$STATE" -f context="${CONTEXT#ci/circleci: }" -f target_url="$URL"
```

(values passed through `env:`.) A `status` workflow always runs the default branch's definition, so
a PR cannot change it. Job-level `if:` means no runner for other statuses (D-007). Cost ≈ one billed
minute per pipeline. Pending is not mirrored: a missing required check already blocks merging.
In circleci mode `main-health.yml` also triggers on `status` (failure of `ci-ok` on main opens
`bosun:main-red`), since `workflow_run` does not fire for CircleCI.

## 8. What stays on GitHub Actions in every mode (cannot be equal)

| Workflow | Why it cannot move |
|---|---|
| `risk.yml` (`risk-check`) | `pull_request_target`, `pull_request_review`, `issue_comment` (`/bosun approve`); no CircleCI trigger exists |
| `verdict.yml` (`review-verdict`) | `issue_comment` |
| `main-open.yml` | `pull_request_target` incl. label events |
| `splice.yml` (update bot) | needs `contents: write` + PR creation; a CircleCI job would need a GitHub write token outside GitHub |
| `main-health.yml` report job | opens/closes issues with `GITHUB_TOKEN`; in circleci mode its trigger is `status` (§7.4), its nightly gates run on CircleCI |
| `release.yml` | environment `release` approval (D-008), npm trusted publishing with OIDC provenance, artifact attestations, macOS/Windows runners only in releases |
| `preview.yml` + `preview-deploy.yml` | the deploy half needs default-branch workflow code for a PR (S12); CircleCI has no equivalent of `workflow_run` with a protected definition, and handing a CircleCI artifact to GitHub would need a CircleCI token on GitHub; the build half stays next to it |
| `circleci-status.yml` | the mirror itself |

Other differences: CircleCI prod approval is a `type: approval` job (anyone with project write
access can approve; GitHub's required reviewers are stricter); no runtime `add-mask` on CircleCI
(hoist redaction covers both); the CircleCI check name has a `ci/circleci: ` prefix (mirror).
GitHub minutes in circleci mode: governance runs as today plus ≈ 1 min per pipeline for the mirror.

## 9. Changes per repo (summary; plans in `docs/superpowers/plans/2026-10-27-*`)

- **hoist:** `secrets.toml`/`access.toml` model, `check`, `exec`, `sync`/`grant`/`revoke`/
  `rotate-key`/`edit`/`repo init`, CircleCI context API, the action, reusable workflow and CircleCI
  command reference. Spec §8 grows a "secrets repos" section.
- **hull:** `CI_PLAN` + generator, combos as fragments, pieces `circleci`, `circleci-only`,
  `secrets`; two-phase previews and `deploy.yml`; `template-secrets/`; template-rust CircleCI
  pieces; contract rule 9.27 text; dogfood validates CircleCI config; CLAUDE.md layout.
- **bosun:** `R-secrets` paths/content, `.circleci/**` in the critical floor and `R-ci`, hook
  deny-list; channel pieces `circleci`/`circleci-only`; `bosun gates` on CircleCI; `init`/`doctor`.
- **hoard:** standalone install script (SHA-256) and `hoard start|stop` for non-Actions runners;
  CircleCI docs; the reference `hoard.yml` command.
- **splice:** rule 9.27 (empty re-render deletes an unchanged owned file; `check` accepts its
  absence), release 0.3.0 (owner tags).
- **decisions:** D-010, D-011 (Appendix A).
- **keelstack:** docs pages `secrets` and `ci-providers`, updates to `ci`, `risk`, `cloud`,
  docspack bump (llms-full.txt is generated from the pages).

## 10. Contract rule 9.27 (proposed text, both repos, same week — D-003)

> 27. **Empty re-render.** On `add` and `update`, an `owned` or `shared` file whose new render is
> empty (§4) is removed under the rule for removed files (§7: deleted only if its on-disk hash equals
> the lock hash, otherwise reported) and dropped from the lock. `check` does not report an owned file
> as missing when its render at the lock's commit is empty. Templates that rely on this set
> `min_splice` ≥ 0.3.0.

`format` stays 1 (D-005): valid templates render the same files; only removal on re-render is new.

## 11. Docs (keelstack.dev)

- New page `/docs/secrets`: secrets repos, `access.toml`, `secrets.toml`, the three wrappers, who may
  decrypt, rotation and revoke, the owner setup checklist.
- New page `/docs/ci-providers`: the three modes, what stays on GitHub and why (§8), required checks
  and the mirror, budgets, CircleCI setup checklist.
- `/docs/ci`, `/docs/risk` (R-secrets, `.circleci/**`), `/docs/cloud` (agents never hold age keys):
  one paragraph each, linking the new pages.
- `src/data/docs.ts` and `docs.test.ts` get both pages; docspack version bump; `llms.txt`,
  `llms-full.txt` and `/docs/<slug>.md` are generated from the pages, so they follow.
- The docspack (`@keelstackhq/docspack`) gets the two pages through the same build.

## 12. Unverified (check during the build; the task that depends on it verifies first)

1. The CircleCI GitHub App status context for a job named `ci-ok` is exactly `ci/circleci: ci-ok`,
   and the sender login of those statuses is `circleci-app[bot]` (a constant in the mirror; CAN-1
   checks it and, if it differs, an agent PR fixes the constant in hull and bosun — no owner step).
2. `checkout: method: blobless` exists and works with `git fetch` of the default branch.
3. `circleci config pack` output + continuation API works without orbs; `circleci config validate`
   runs offline in hull CI (else hull validates against the CircleCI JSON schema from SchemaStore,
   vendored and pinned).
4. `<< pipeline.git.base_revision >>` on GitHub App pipelines for default-branch pushes.
5. Context expression restriction syntax `pipeline.git.branch == "main"`.
6. Verified 2026-10-27 (sops 3.13.3, age 1.1.1 and 1.3.x keys): `sops encrypt --filename-override P
   --input-type json --output-type yaml --age R /dev/stdin` and `sops decrypt --input-type yaml
   --output-type json /dev/stdin` work when stdin is a pipe or file. They fail with ENXIO when stdin is
   a socket (Node `child_process` uses sockets), so hoist must spawn sops with a real pipe (Rust
   `Stdio::piped()` is one) and Node tests pass a file path.
7. `ring` 0.17.14 is in hoist's `Cargo.lock` (checked 2026-10-27); unverified: that `RsaKeyPair`
   loads GitHub App keys (PKCS#1 PEM → DER) and signs RS256 for the JWT; if not, the plan's Tech Stack
   asks the owner for `jsonwebtoken` or `rsa`.
8. GitHub `status` events from the CircleCI app trigger workflows (they are not created by
   `GITHUB_TOKEN`, so they should).
9. Merge-queue builds with "Prevent unregistered users from triggering builds" on: CircleCI support
   says the queue bot counts as unregistered; the owner may need to turn it off (contexts still guard
   secrets).
10. Context security-group restrictions are OAuth-org only, GitHub-App orgs get project and
   expression restrictions (CircleCI contexts docs, read via search 2026-10-27; confirm in the UI).
11. A commit status posted with `GITHUB_TOKEN` counts as source "GitHub Actions" for a ruleset's
   expected source; and that a same-repo PR workflow with `statuses: write` can post `ci-ok` on its
   own head (expected yes; CAN-1 confirms `risk-check` still blocks the merge).
12. CircleCI has no way to run a protected (default-branch) config for a PR pipeline (basis of
   keeping previews on GitHub, §8); recheck the CircleCI docs before HU-5.

## 13. Owner-only steps

All human steps are in §0; this list maps them to the design for reference.


1. Merge the decisions PR (D-010, D-011).
2. Create the GitHub App `keelstackhq-secrets-read` (Repository contents: read, metadata: read),
   install it only on `secrets-*` repos; org variable `SECRETS_READ_APP_ID`, org secret
   `SECRETS_READ_APP_KEY` (selected repos). Same two values in CircleCI context `secrets-read`.
3. Create owner age keys locally (`age-keygen`), one in daily use and one in a safe; never in a
   Claude environment.
4. `hoist secrets repo init keelstackhq/secrets-shared` (and per-project repos); render
   `template-secrets`; fill `access.toml` with the owner public keys; `hoist secrets edit` to add
   values.
5. Per consumer and environment: v1 consumers by `scripts/owner/bootstrap-secrets.sh` (§0 C5);
   later ones by `hoist secrets grant <repo> --env <env> [--provider circleci]`; GitHub environments
   with protections (§5.2).
6. CircleCI: connect the org through the GitHub App; per project enable dynamic config (setup
   workflows), triggers (PRs, default-branch pushes, merge-queue pushes), forked PRs build without
   secrets; contexts with project and expression restrictions (§5.3); weekly scheduled trigger for
   desktop/nightly; a personal API token for `hoist secrets grant --provider circleci` (local only).
7. Rulesets: unchanged names. In circleci mode set `ci-ok`'s expected source to GitHub Actions.
8. Create the canary repo `keelstackhq/hull-canary-circleci` (circleci mode) and its CircleCI project.
9. Tag/release: splice 0.3.0, hoist (secrets), hoard (standalone), hull (owner tags, D-008).
10. Optional later: CircleCI namespace and orbs (§6.6); KMS recipients (§3.6).

## Appendix A — decisions text (copy-ready for keelstackhq/decisions)

Index rows (`DECISIONS.md`, align with prettier; copy to `channel/pieces/snapshot/files/docs/agents/org-decisions.md`):

```
| D-010 | 2026-10-27 | all | Secrets live sops+age-encrypted in private secrets repos (access.toml → generated .sops.yaml; one age key per consumer repo × env, ≥1 owner key); consumers list needs in secrets.toml; CI decrypts only via `hoist secrets exec` in jobs whose code comes from a protected ref; agents never hold age keys or see plaintext. [why](decisions/010-secrets-sops-repos.md) |
| D-011 | 2026-10-27 | all | CI provider is GitHub Actions (default), CircleCI, or both, chosen with hull pieces `circleci`/`circleci-only`; required check names never change (CircleCI's ci-ok is mirrored to a commit status); governance, PR previews, splice bot and releases stay on GitHub Actions; D-007 rules apply to CircleCI. [why](decisions/011-ci-providers.md) |
```

`decisions/010-secrets-sops-repos.md`:

```markdown
# D-010: Secrets live in sops-encrypted secrets repos

- Date: 2026-10-27
- Scope: all
- Status: accepted
- Supersedes: —

## Context

The owner asked for secrets stored in one or more repos with sops, usable from predefined GitHub
Actions and from CircleCI. Repo secrets in GitHub had no review, no history and could be read by any
same-repo PR's workflow, including agent PRs (hull's preview.yml). Design:
hull docs/superpowers/specs/2026-10-27-secrets-and-ci-providers-design.md.

## Decision

- Secrets live sops+age-encrypted in private `keelstackhq/secrets-*` repos rendered from
  `gh:keelstackhq/hull//template-secrets`. `access.toml` is the only access file; `.sops.yaml` is
  generated from it by `hoist secrets sync` and CI-checked.
- One age key pair per (consumer repo, environment) plus at least one owner key per file. hoist
  generates CI keys and stores the private key straight into the GitHub environment secret or the
  CircleCI context `SOPS_AGE_KEY`; nobody sees it.
- Consumers declare what they read in a root `secrets.toml`. CI reads secrets repos with the
  `keelstackhq-secrets-read` GitHub App (contents: read, ciphertext only).
- CI decrypts only with `hoist secrets exec` (the `keelstackhq/hoist/secrets` action, the
  `secrets-run` reusable workflow, or the CircleCI `secrets-exec` command), in jobs whose workflow
  and executed code come from main, a release tag or a `workflow_run` deploying an artifact; never
  on `pull_request`, `pull_request_target`, `issue_comment` or forks. Every GitHub environment and
  CircleCI context holding `SOPS_AGE_KEY` is restricted to `main` (or release tags), and consumers
  pin the action by commit SHA.
- Agents never hold an age private key or see plaintext; decrypting commands are owner- or CI-only.
  Changes to secrets.toml, .sops.yaml, access.toml, *.sops.yaml, workflows and .circleci/** are
  owner-approved (bosun R-secrets).

## Consequences

- hoist gains `secrets check|exec|sync|grant|revoke|rotate-key|edit|repo init`; hull gains the
  `secrets` piece, two-phase previews and `template-secrets`; bosun extends R-secrets and its hooks.
- Repo-level `CLOUDFLARE_API_TOKEN` secrets are retired once a repo has the `secrets` piece.
- Revoking a consumer always means rotating the values it could read.
```

`decisions/011-ci-providers.md`:

```markdown
# D-011: GitHub Actions and CircleCI as CI providers

- Date: 2026-10-27
- Scope: all
- Status: accepted
- Supersedes: —

## Context

The owner asked for CircleCI as a second CI provider with every CI job working on both. Governance
(risk-check, review-verdict, main-open) and releases depend on GitHub-only events and approvals.
Design: hull docs/superpowers/specs/2026-10-27-secrets-and-ci-providers-design.md §6-§8.

## Decision

- A repo picks its provider when rendered from hull: no piece = GitHub Actions; `circleci` = both
  (GitHub's ci-ok required, CircleCI advisory); `circleci` + `circleci-only` = CircleCI. The bosun
  channel uses the same pieces as the main template.
- Every CI job (ci-ok, bosun gates, deploy, scheduled desktop/Storybook/nightly) is
  generated for both providers from one step list (hull CI_PLAN) and parity-tested.
- Required check names never change. In CircleCI mode a GitHub `status` workflow mirrors CircleCI's
  terminal `ci/circleci: ci-ok` / `bosun-ok` into `ci-ok` / `bosun-ok`.
- These stay on GitHub Actions in every mode: risk.yml, verdict.yml, main-open.yml, the main-health
  report, splice.yml, release.yml, PR previews (preview.yml, preview-deploy.yml) and the mirror.
- D-007 applies to CircleCI too: local CI mirror before push, one push per PR, setup + one job on
  the PR path, no macOS on the PR path, scheduled pipelines at most weekly.

## Consequences

- hull gains pieces `circleci`, `circleci-only` (also in template-rust); bosun gains matching channel
  pieces and runs gates on CircleCI; hoard runs outside Actions.
- CircleCI production approval is weaker than GitHub environment reviewers; repos that need owner
  approval for prod keep deploy on GitHub.
```
