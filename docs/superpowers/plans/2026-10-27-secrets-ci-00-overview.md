# Secrets repos + CircleCI — cross-repo PR order

Spec: `docs/superpowers/specs/2026-10-27-secrets-and-ci-providers-design.md` (hull). Per-repo plans:
`2026-10-27-secrets-ci-{hull,hoist,bosun,hoard,splice,decisions,keelstack}.md` in this directory. The
first PR in each other repo copies its plan into that repo's own plans directory.

Rules for every PR below: ≤ 400 changed lines (generated files and fixtures excluded from the count
but listed); test first; the repo's local CI mirror passes before the one push (D-007); no PR merges,
tags or force-pushes (D-008); no real secret or private key anywhere — tests generate age keys with
`age-keygen` into a temp dir at test time and delete them. Parallel PRs never touch the same file:
each row lists its files; shared append-only files use fragments (`changelog.d/`, `progress.d/`,
`scripts/combos/*.json` after HU-1a); repos without fragments update `CHANGELOG.md`/`PROGRESS.md`
only in their last PR of the series.

## Order

```
DEC-1 ─────────────────────────────────────────────── (owner merges any time; others don't wait)
SP-1 ∥ HU-8 (contract 9.27, same week) ── owner tags splice 0.3.0
HD-1 ── owner releases hoard ─────────────┐
HO-1 → HO-2 → HO-3 → HO-4                  │
          └→ HO-5 ── owner releases hoist ─┼──────────────┐
HU-1a ∥ HU-1b → HU-2 (needs hoard rel.) → HU-3 → HU-7      │
                  │                         └→ CAN-1 (canary, owner repo)
HU-2 → HU-6 (template-secrets; pins released hoist) ◄─────┤
HU-4 (after HU-1a; action pinned once hoist released) ◄───┘
HU-2 + HU-4 → HU-5
BO-1 → BO-2 → BO-3a (after HU-3, hull tag) → BO-3b
all of the above → HU-9 (hull wrap-up) ∥ KS-1 (docs)
```

## PR table

| PR | Repo | Title (commit) | Depends on | Owner approval |
|---|---|---|---|---|
| DEC-1 | decisions | `docs: D-009 secrets repos, D-010 CI providers` | — | owner merges (D-002) |
| SP-1 | splice | `feat: rule 9.27 — empty re-render removes owned file` | — | yes (contract, D-003) |
| HD-1 | hoard | `feat: run hoard outside GitHub Actions (CircleCI)` | — | yes (release workflow unchanged; new install script) |
| HO-1 | hoist | `feat(secrets): secrets.toml + access.toml models, secrets check` | — | no |
| HO-2 | hoist | `feat(secrets): secrets exec runtime` | HO-1 | yes (R-secrets: decrypt path) |
| HO-3 | hoist | `feat(secrets): sync, grant, revoke, rotate-key, edit, repo init (GitHub)` | HO-2 | yes (R-secrets) |
| HO-4 | hoist | `feat(secrets): CircleCI contexts for grant/revoke` | HO-3 | yes (R-secrets) |
| HO-5 | hoist | `feat(secrets): GitHub action, reusable workflow, CircleCI command` | HO-2 | yes (`.github/**`, action) |
| HU-1a | hull | `refactor: combos as fragments in scripts/combos/` | — | no |
| HU-1b | hull | `refactor: CI_PLAN and gen-ci generate ci.yml` | — | yes (template CI) |
| HU-2 | hull | `feat: circleci piece` | HU-1a, HU-1b, hoard release | yes (template CI) |
| HU-3 | hull | `feat: circleci-only piece and ci-ok mirror` | HU-2 | yes (template CI) |
| HU-4 | hull | `feat: secrets piece, two-phase previews, deploy.yml` | HU-1a, hoist release (pin) | yes (template CI, secrets) |
| HU-5 | hull | `feat: secrets on CircleCI (deploy job, secrets-exec)` | HU-2, HU-4 | yes |
| HU-6 | hull | `feat: template-secrets` | HU-2 (dogfood.mjs), hoist release (pin) | yes (workflow) |
| HU-7 | hull | `feat(template-rust): circleci pieces` | HU-3 | yes |
| HU-8 | hull | `docs: contract rule 9.27` | — (same week as SP-1) | yes (contract) |
| HU-9 | hull | `docs: secrets + CircleCI — spec amendments, CLAUDE.md, progress, changelog` | all hull PRs | no |
| CAN-1 | canary | render `circleci-only` into `keelstackhq/hull-canary-circleci`, verify spec §12 items 1-5, 8, 9 | HU-3, owner setup | owner setup |
| BO-1 | bosun | `feat(risk): R-secrets covers sops files; .circleci in critical floor; decrypt hook deny` | — | yes (critical) |
| BO-2 | bosun | `feat(gates): run on CircleCI` | BO-1 (both edit `docs/spec.md`) | yes (bosun src) |
| BO-3a | bosun | `feat(channel): circleci and circleci-only pieces` | BO-2, HU-3 tag | yes (workflows) |
| BO-3b | bosun | `feat: init and doctor follow the main template's CI provider` | BO-3a | yes |
| KS-1 | keelstack | `docs: secrets and CI providers pages` | HO-5, HU-3, HU-4 merged | no |

Parallel sets that are safe (disjoint files): {DEC-1, SP-1, HD-1, HO-1, HU-1a, HU-1b, HU-8, BO-1};
then {HO-2, HU-2, HU-4*, BO-2}; then {HO-3, HO-5, HU-3, HU-6*}; then {HO-4, HU-5, HU-7, BO-3a};
then {BO-3b, KS-1, HU-9}. (* pins the released hoist; if it is not released yet the pin is left as
`TODO(hoist-release)` and HU-9 resolves it.) Within one set no two PRs share a file; HU-4 and HU-3
both touch `template/pieces/base/files/.github/workflows/` but different files (`preview*.yml` vs
`ci.yml`/`desktop.yml`); HU-5 and HU-7 both touch `scripts/combos/` with different new files.

## Owner-only setup (spec §13)

GitHub App `keelstackhq-secrets-read`; owner age keys; secrets repos; `hoist secrets grant` per
consumer × env; GitHub environments; CircleCI org (GitHub App), projects, dynamic config, triggers incl.
merge queue, fork settings, contexts with restrictions, weekly schedules, API token; rulesets'
expected source for `ci-ok` in circleci mode and `vars.CIRCLECI_STATUS_SENDER`; the canary repo;
releases/tags of splice 0.3.0, hoard, hoist, hull.
