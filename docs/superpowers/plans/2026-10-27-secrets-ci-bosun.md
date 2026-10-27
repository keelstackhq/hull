# bosun — secrets risk rules, decrypt guard, CircleCI gates and channel pieces

Spec: hull `docs/superpowers/specs/2026-10-27-secrets-and-ci-providers-design.md` (S§5, §6.5, §7, §8).
bosun spec sections touched: §7 gates (BO-2), §8 risk (BO-1), the channel section (BO-3a/b). BO-2
starts after BO-1 merges (both edit `docs/spec.md`); BO-3a after BO-2 and hull HU-3. Fragments: every PR adds `changelog.d/<branch>.md` and `docs/progress.d/<branch>.md` (one
line each). Tech stack: nothing new. All PRs are critical-floor (bosun `src/**`, `.bosun/**`,
workflows): owner approval.

## BO-1: R-secrets covers sops repos; `.circleci/**` is CI; decrypt commands denied

Files: `src/core/risk_default.toml`, `channel/pieces/core/files/.bosun/risk.toml.jinja`,
`.bosun/risk.toml` (bosun's own), `src/core/risk.rs` (critical floor list), `src/hooks/pre_tool_use.rs`
(+ its deny-list module if separate), `tests/risk_secrets.rs`, `tests/hook_decrypt.rs`, `docs/spec.md` §8.
- `R-secrets` gains `paths = ["secrets.toml", ".sops.yaml", "access.toml", "**/*.sops.yaml",
  "**/*.sops.json"]` and `content` additionally matches `AGE-SECRET-KEY-1` and
  `SOPS_AGE_KEY\s*[:=]`; it stays critical (owner-approved, never delegate).
- `R-ci` and the critical floor gain `.circleci/**`.
- PreToolUse Bash deny (exit with the hook's deny protocol and a one-line reason): `sops` with
  `-d|--decrypt|decrypt|edit|exec-env|exec-file|set|rotate|updatekeys`; `age` with `-d|--decrypt`;
  `hoist secrets (edit|sync|grant|revoke|rotate|rotate-key)`; any command reading
  `keys.txt` under `sops/age`; `printenv SOPS_AGE_KEY`, `echo $SOPS_AGE_KEY`, `env | grep SOPS`.
  `sops --version`, `hoist secrets check`, `hoist secrets exec --help` stay allowed.
- Tests first: each path → R-secrets critical; a diff adding `AGE-SECRET-KEY-1…` (fixture string
  built at test time, not a real key) → critical; `.circleci/config.yml` change → R-ci + critical;
  hook: each denied command → deny, each allowed one → allow; quoting/`bash -c` wrappers still denied.
- Commit: `feat(risk): R-secrets covers sops files; .circleci in critical floor; decrypt hook deny`

## BO-2: `bosun gates` on CircleCI

Files: `src/gates/mod.rs` (CI context detection), new `src/gates/ci_env.rs` (GitHub vs CircleCI:
event kind, base SHA per S§6.4 — merge-queue branch, default-branch push, else merge-base),
`tests/gates_circleci.rs`, `docs/spec.md` §7.
- Tests first: env fixtures for CircleCI PR branch, default-branch push, `gh-readonly-queue/main/
  pr-7-<sha>` → correct base and `--all` on default branch and merge queue; GitHub behaviour unchanged
  (existing tests green).
- Commit: `feat(gates): run on CircleCI`

## BO-3a: channel pieces `circleci` and `circleci-only`

Depends on hull HU-3 (and its tag) for the vendored shared files.
Files: `channel/pieces/circleci/{piece.toml,files/.circleci/src/jobs/bosun-ok.yml.jinja,
files/.circleci/src/workflows/bosun.yml}`, guarded shared files for repos without hull
(`{% if own_ci %}{% else %}…{% endif %}`): `.circleci/config.yml.jinja`,
`.circleci/src/@config.yml.jinja`; `channel/pieces/circleci-only/{piece.toml,files/.github/workflows/
circleci-status.yml.jinja}` (same guard) and a `bosun.yml.jinja` guard so GitHub `bosun.yml` is not
rendered in circleci-only mode; `channel/pieces/core/files/.github/workflows/main-health.yml.jinja`
(`status` trigger + job `if:` in circleci-only mode, S§7.4); `tests/fixtures/hull/<tag>/…` (vendored
hull copies) and `tests/channel_circleci.rs`.
- The CircleCI job is `bosun-ok` when `own_ci`, else `ci-ok`; it installs bosun (pinned, SHA-256) and
  runs the same gate list as `bosun.yml` (parity test: gate list in both files equal).
- Tests first: rendered with/without `own_ci`; shared files byte-identical to the vendored hull copies;
  no path filters; mirror filters as hull's; risk/verdict/main-open/splice workflows unchanged in all
  modes.
- Commit: `feat(channel): circleci and circleci-only pieces`

## BO-3b: `init` and `doctor` follow the main template

Files: `src/cli/init.rs` (read `.splice/lock.toml`; add `circleci`/`circleci-only` channel pieces
when the main template has them), `src/cli/doctor.rs` (fail when the channel's provider pieces differ
from the main template's; in circleci-only mode check `.circleci/src/jobs/ci-ok.yml` or
`bosun-ok.yml` exists and `circleci-status.yml` exists; warn when `vars.CIRCLECI_STATUS_SENDER` is
unset — read via the API, GET only), `tests/cli_doctor_circleci.rs`, `tests/cli_init_circleci.rs`,
`docs/spec.md` channel section.
- Commit: `feat: init and doctor follow the main template's CI provider`
