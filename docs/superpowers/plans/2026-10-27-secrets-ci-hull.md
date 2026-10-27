# hull 06 — secrets piece, template-secrets, CircleCI provider

Spec: `docs/superpowers/specs/2026-10-27-secrets-and-ci-providers-design.md` (here "S§"). Base spec
sections touched: §5, §6, §8, §10, §13. Contract: rule 9.27 (HU-8 only).
Tech stack: nothing new for hull's own `package.json`. Generated repos gain pinned binaries
(no npm deps): CircleCI CLI (setup job), sops 3.13.3, hoist (released version with `secrets exec`),
hoard (released standalone version). Each task that pins one records version + SHA-256 + date from the
release's checksum file. If CircleCI config validation needs a new devDependency (e.g. `ajv`), ask
the owner first (CLAUDE.md); default is a vendored JSON schema checked with a small validator in
`tests/lib/` or `circleci config validate` if it runs offline (S§12 item 3).

Fast checks before every commit: `pnpm test && pnpm lint && pnpm format:check`; before the push,
dogfood for the combos `affected-combos` selects. One push per PR.

PR order and dependencies: `2026-10-27-secrets-ci-00-overview.md`. Do not edit `docs/PROGRESS.md`,
`CHANGELOG.md`, `CLAUDE.md` or the base spec before HU-9 (parallel PRs); record deviations in the PR
body so HU-9 can fold them in.

## HU-1a: combos as fragments

Files: `scripts/combos/<name>.json` (one per current combo, same content as today's entries),
`scripts/lib/combos.mjs` (`loadCombos()` → `{ vars, combos }` sorted by name; shared `vars` in
`scripts/combos/_vars.json`), delete `scripts/combos.json`; update `scripts/dogfood.mjs`,
`scripts/affected-combos.mjs` (ALL_EXACT: `scripts/combos/` prefix instead of the file),
`tests/splice-parity.test.mjs`, `tests/tauri-app.test.mjs`, `tests/affected-combos.test.mjs`,
`.github/workflows/desktop.yml` derivation test if it reads the file.
- Test first: `loadCombos()` returns exactly today's combos (snapshot of names, pieces, template,
  vars, scheduled); a duplicate name across files throws; a file whose `name` differs from its file
  name throws; `affected-combos` selects all when any `scripts/combos/*` changes.
- Commit: `refactor: combos as fragments in scripts/combos/`

## HU-1b: `CI_PLAN` and `gen-ci`

Files: `scripts/lib/ci-tasks.mjs` (add `CI_PLAN`: frozen array of `{ id, github }` where `github` is
the YAML text of that step), `scripts/gen-ci.mjs` (`--check` exits 1 on drift), `tests/gen-ci.test.mjs`,
`tests/parity.test.mjs` (extend), `template/pieces/base/files/.github/workflows/ci.yml` (adds only
`# step: <id>` comment lines), root `package.json` script `gen:ci`.
- Test first: `node scripts/gen-ci.mjs --check` passes; after stripping the `# step:` lines the
  generated `ci.yml` (still named `ci.yml` in this PR; HU-3 renames it) is byte-identical to today's (fixture of today's file in `tests/fixtures/ci.yml.before`);
  step ids in `ci.yml` equal `CI_PLAN.map(s => s.id)` in order (S§6.2 list); `CI_TASKS` parity
  unchanged.
- Commit: `refactor: CI_PLAN and gen-ci generate ci.yml`

## HU-2: `circleci` piece

Files: `template/pieces/circleci/piece.toml` (`requires = ["base"]`; owned: exactly the circleci
paths listed in S§6.3, no `.circleci/**` glob, because the secrets piece and the bosun channel add
files there), `template/pieces/circleci/files/.circleci/…` per S§6.3 (not `desktop` — HU-3), `CI_PLAN` entries gain `circleci` bodies, `scripts/gen-ci.mjs` writes
`.circleci/src/jobs/ci-ok.yml`, `.circleci/scripts/scm-base.sh` + `tests/scm-base.test.mjs`,
`scripts/combos/web-circleci.json` (`[base, circleci, preact-app:web, hono-worker:api]`),
`scripts/dogfood.mjs` (for combos with `circleci`: pack `.circleci/src` with the pinned CLI and
validate, S§12 item 3), `tests/circleci.test.mjs`.
- Tests first:
  - template invariants hold for the new piece (subset, classes, portable paths);
  - rendered `web-circleci` has `.circleci/config.yml` with `setup: true`, and the GitHub `ci.yml`
    unchanged (both mode, S§6.1);
  - `ci-ok.yml` step ids == `CI_PLAN` ids; its run command == `CI_TASKS` (parity);
  - triggers: no branch filters on the `ci` workflow (merge-queue branches included), no path
    filters; job name is `ci-ok`;
  - every downloaded binary has a pinned version and a `sha256sum -c` line;
  - `scm-base.sh`: `gh-readonly-queue/main/pr-12-<sha>` → `<sha>`; default branch → the pipeline
    base revision argument; feature branch → `git merge-base` (temp git repo fixture);
  - hoard command: `fs` storage, cache keys as S§6.4, `hoard stop` in an `when: always` step;
  - the `secrets-exec` command is NOT in this piece (HU-5); no owned glob overlaps another piece.
- Commit: `feat: circleci piece`

## HU-3: `circleci-only` piece and the `ci-ok` mirror

Files: `template/pieces/circleci-only/piece.toml` (`requires = ["circleci"]`), its
`files/.github/workflows/circleci-status.yml` (S§7.4; a plain copied file, not `.jinja`, so the
`${{ }}` expressions need no raw block; owned),
`template/pieces/base/files/.github/workflows/ci.yml` → `ci.yml.jinja` (guard of S§6.1),
`desktop.yml.jinja` (guard added), `template/pieces/circleci/files/.circleci/src/jobs/desktop.yml.jinja`
and `…/workflows/desktop.yml.jinja` (weekly schedule; `{% if "circleci-only" in pieces %}{% if
"tauri-app" in pieces %}…` — in the circleci piece because tauri-app's files render under
`apps/<name>/`), `template/pieces/circleci/piece.toml` (the two paths), `template/splice.toml`
(`min_splice = "0.2.0"`), `scripts/gen-ci.mjs` (writes the `.jinja` with the guard and raw block),
`scripts/combos/web-circleci-only.json`, `tests/circleci-only.test.mjs`.
- Tests first:
  - rendered `web-circleci-only` has no `.github/workflows/ci.yml` or `desktop.yml`, has
    `release.yml`, `preview.yml`, `circleci-status.yml`; GitHub-mode renders are byte-identical to
    before (snapshot of the `web` combo);
  - mirror: trigger `status` only; job-level `if:` filters context (`ci-ok`, `bosun-ok`), non-pending
    state and sender; `permissions` is exactly `statuses: write`; all event values via `env:`;
    `timeout-minutes` ≤ 2;
  - no workflow in any rendered combo with `pull_request_target`, `issue_comment` or `status`
    triggers references `environment:` or `SOPS_AGE_KEY` (security test, S§5.1);
  - the `{% raw %}` tags are exact (contract subset test already covers it);
  - `both`-mode render (`web-circleci`) has no CircleCI desktop/deploy jobs (one provider per
    scheduled/deploy job, S§6.1).
- Commit: `feat: circleci-only piece and ci-ok mirror`

## HU-4: `secrets` piece, two-phase previews, `deploy.yml`

Files: base: `template/pieces/base/files/.github/workflows/preview.yml` (build only: no secrets,
no environment, uploads artifact `preview-<pr>` with `retention-days: 3`),
`template/pieces/base/files/.github/workflows/preview-deploy.yml.jinja` (new, owned; reads
`secrets.CLOUDFLARE_API_TOKEN` from environment `preview` without the `secrets` piece, and uses
`keelstackhq/hoist/secrets@v0` with `env: preview` when `{% if "secrets" in pieces %}`),
`template/pieces/base/files/.github/scripts/preview.mjs` (split into `build` and `deploy`
subcommands; `build` writes only pre-bundled output per app — `wrangler deploy --dry-run --outdir`
for Workers, the static dir for Pages — plus a manifest; `deploy` reads `wrangler.jsonc` from the
default-branch checkout, runs `wrangler deploy --no-bundle` / `wrangler pages deploy <dir>`, no
install of PR dependencies, no build), `template/pieces/base/piece.toml` (class of the new file). Piece:
`template/pieces/secrets/piece.toml` (`requires = ["base"]`; var `context_prefix` (used by HU-5,
defined here so HU-5 does not edit this file); seed `secrets.toml`; owned
`docs/agents/secrets.md`, `.github/workflows/deploy.yml.jinja` with the
`{% if "circleci-only" in pieces %}{% else %}{% raw %}…{% endraw %}{% endif %}` guard, S§6.1) and its files.
`scripts/combos/web-secrets.json`, `tests/secrets-piece.test.mjs`, `tests/preview.test.mjs` (adjust).
- Tests first:
  - `preview.yml`: trigger `pull_request`, no `secrets.` reference, no `environment:`;
  - `preview-deploy.yml`: trigger `workflow_run` (`workflows: [preview]`, `types: [completed]`),
    job `if:` requires success and `head_repository.full_name == github.repository`,
    `environment: preview`, never checks out the PR head (only the default branch for scripts and
    the lockfile), downloads the artifact by run id, and fails if the artifact contains
    `wrangler.json*`, `package.json`, `pnpm-lock.yaml`, `*.toml` or a symlink (fixture artifacts
    for `preview.mjs deploy`); `wrangler` comes from the default-branch lockfile;
  - `deploy.yml` (secrets piece): `push` to main + `workflow_dispatch`, `environment: prod`,
    uses the action with `env: prod` and explicit `keys`; not rendered with `circleci-only`;
  - every `keelstackhq/hoist/secrets` / `secrets-run.yml` reference in rendered workflows is pinned
    by a 40-hex commit SHA with a `# v…` comment (Renovate preset gets a matching rule);
  - `secrets.toml` seed parses with the S§3.3 rules (a tiny parser test in JS mirroring hoist's
    rules, or run `hoist secrets check` when the pinned hoist is installed in dogfood);
  - `docs/agents/secrets.md` ≤ 30 lines; AGENTS/CLAUDE line budgets still hold;
  - the security test from HU-3 covers the new workflows.
- Commit: `feat: secrets piece, two-phase previews, deploy.yml`

## HU-5: secrets on CircleCI

Files: `template/pieces/secrets/files/.circleci/src/commands/secrets-exec.yml.jinja` and
`.circleci/src/jobs/deploy.yml.jinja`, `.circleci/src/workflows/deploy.yml.jinja`
(`secrets-exec` under `{% if "circleci" in pieces %}`, deploy under `{% if "circleci-only" in pieces %}`;
deploy workflow on `main` only, `hold` approval job, context
`{{ context_prefix }}-prod`; `context_prefix` is the `secrets` piece var from HU-4, pattern `^[a-z0-9-]+$`,
no default, prompt "CircleCI context prefix (usually the repo name)": contexts are org-wide, S§5.3), `tests/fixtures/hoist-secrets-exec.yml` (vendored reference
from hoist at the released tag), `scripts/combos/web-circleci-secrets.json`, `tests/secrets-circleci.test.mjs`.
- Tests first: `secrets-exec.yml` byte-identical to the vendored hoist reference; deploy job never
  in the PR workflow; context name derived from the piece var; approval job precedes deploy; no
  deploy job in `both` mode; renders nothing without `circleci`.
- Commit: `feat: secrets on CircleCI (deploy job, secrets-exec)`

## HU-6: `template-secrets/`

Depends on HU-2 (both edit `scripts/dogfood.mjs`).

Files: `template-secrets/splice.toml` (`name = "hull-secrets"`, `min_splice = "0.2.0"`, var `owner`),
`template-secrets/pieces/base/{piece.toml,files/…}` per S§3.1 (README seed, `access.toml` shared with
`[merge] "access.toml" = "toml"`, `.sops.yaml` owned with a generated-placeholder comment,
`CODEOWNERS`, `.github/workflows/check.yml` with `pull_request` + weekly schedule + `merge_group`,
job `ci` + `ci-ok`, installs pinned hoist, runs `hoist secrets check`), `template-secrets/pieces/
circleci/…` (setup + `ci-ok` job running the same check), `scripts/combos/secrets-repo.json`,
`scripts/affected-combos.mjs` (map `template-secrets/` like `template-rust/`), `scripts/dogfood.mjs`
(steps for this template: render, `hoist secrets check` with a test-generated age key fixture),
`tests/template-secrets.test.mjs`.
- Tests first: invariants; rendered repo has no `*.sops.yaml` and no `AGE-SECRET-KEY`; `check.yml`
  has no `secrets.` reference; dogfood: generate an age key with `age-keygen` in a temp dir, add its
  public key to `access.toml`, `hoist secrets sync`, encrypt a fixture value, `hoist secrets check`
  exits 0; delete a recipient from the file → exit 1. Skip with a clear message when `sops`/`age` are
  not installed locally; CI installs them pinned.
- Commit: `feat: template-secrets`

## HU-7: template-rust CircleCI pieces

Files: `template-rust/pieces/circleci/**`, `template-rust/pieces/circleci-only/**`,
`template-rust/pieces/base/files/.github/workflows/ci.yml` → `.jinja` guard, `RUST_CI_PLAN` in
`scripts/lib/ci-tasks.mjs` + `gen-ci.mjs`, `scripts/combos/rust-circleci-only.json`,
`tests/rust-circleci.test.mjs`.
- Tests: like HU-2/HU-3 with `RUST_CI_STEPS`; docs-only fast exit present in both providers.
- Commit: `feat(template-rust): circleci pieces`

## HU-8: contract rule 9.27

Files: `docs/template-format.md` only (text of S§10), byte-identical to splice's SP-1 change, same
week (D-003). `tests/` contract-copy test if one exists. Commit: `docs: contract rule 9.27`.

## HU-9: wrap-up

Files: base spec (§5 vars note, §6 new pieces, §8 previews/deploy/CircleCI, §10 combos fragments,
§13 verified items from CAN-1), `CLAUDE.md` (layout: `template-secrets/`, `scripts/combos/`,
`scripts/gen-ci.mjs`; rule: decrypting jobs never on PR-controlled code), `docs/PROGRESS.md` (one
line per HU task, Blocked: owner steps S§13), `CHANGELOG.md` (dated heading only if the owner wants a
release), resolve any `TODO(hoist-release)` pins. Commit: `docs: secrets + CircleCI wrap-up`.
