# template-rust: advisories on PRs, service, sqlite and fly pieces (2026-11-20)

Why: a client repo built from template-rust went live on Fly.io with SQLite. It needed about 950
hand-written deploy lines and its own SQLite and backup code, and main went red on DNS-crate and
SQLite advisories within an hour, because PR CI never checked advisories. Spec: design §15
("Service pieces", added by Task 7). One PR. No change to `docs/template-format.md` (D-003); a
task that needs one stops and reports.

## Global constraints

- Test first (node:test in `tests/`); run `pnpm test && pnpm lint && pnpm format:check`.
- Contract subset only in `.jinja` (CLAUDE.md "Rules that must never break"). No `{{` in paths
  under `files/` except a piece `target`. Each path in one ownership class.
- Exact crate pins `=x.y.z`, checked with `cargo info <crate>` / crates.io on the day; record the
  date in a comment or the spec. No `reqwest`, no OpenSSL (deny.toml bans it).
- template-rust shared files (`scripts/deny.mjs` etc., list in `scripts/sync-shared.mjs`): edit the
  `template/` copy, then run `node scripts/sync-shared.mjs`.
- CI task list: `RUST_CI_STEPS` in `scripts/lib/ci-tasks.mjs`; regenerate with
  `node scripts/gen-ci.mjs` (writes ci.yml and CircleCI files); the parity tests must pass.
- Workflows: every new workflow passes `tests/ci-minutes-gate.mjs` `check()` with zero findings,
  has job-level `if:` guards that skip comment/label/edit events, a top-level `concurrency`, and
  never touches `ci-ok`. Crons at most daily.
- Generated `AGENTS.md` ≤ 60 lines, `CLAUDE.md` ≤ 20.
- One commit per task, message as given. No model names anywhere.

## Shared interfaces (all tasks)

- Piece ids: `rust-service`, `sqlite`, `fly`. All three declare the same piece var
  `service = { prompt = "service crate and binary name", default = "server", pattern = "^[a-z][a-z0-9-]*$" }`
  (contract rule 28: one `--data service=…` drives all three). `rust-service` and `sqlite` use
  `target = "crates/{{ service }}"`, `multiple = false`; `fly` has no target (root files).
- `requires`: `rust-service` → `["base"]`; `sqlite` → `["rust-service"]`; `fly` → `["rust-service"]`.
  sqlite without fly and fly without sqlite both render, build and test.
- Base `pins.toml` gets a `[crates]` table (exact versions of service crates: tokio, axum, sqlx,
  hyper, hyper-util, http-body-util, rustls, tokio-rustls, webpki-roots, … as used). Every piece
  `Cargo.toml` pins those crates to `=<[crates] value>`; a hull test enforces it, and
  `node scripts/pins.mjs --check` in a generated repo fails when a workspace crate's pin of a
  `[crates]` crate differs.
- Service config is env vars, read once at boot: `PORT` (8080), `DATA_DIR` (`/data`),
  `DB_READERS` (4), `BACKUP_DIR` (`$DATA_DIR/backups`), `BACKUP_KEEP` (7),
  `BACKUP_INTERVAL_SECS` (86400, 0 = off), `TTL_SWEEP_SECS` (0 = off); feature `s3-backup` adds
  `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`,
  `BACKUP_S3_SECRET_ACCESS_KEY`. Logs never include query strings, headers, bodies or secrets.

## Task 1: one deny command with advisories (`feat(template-rust): one deny command with advisories in PR CI`)

- `scripts/deny.mjs` (edit `template/` copy, sync): with no args it runs
  `cargo deny --locked check advisories bans licenses sources`; args still pass through.
- deny.local.toml (seed) may hold `[advisories]` `ignore = [{ id = "RUSTSEC-…", reason = "…",
  expires = "YYYY-MM-DD" }, …]` besides `[licenses] allow`. deny.mjs merges the ignores into the
  temp deny.toml as `{ id, reason }` (cargo-deny has no `expires`). An entry without `reason` or a
  valid `expires`, or with `expires` before today (UTC), fails with exit 1 and a message naming the
  id, before cargo-deny runs. Template-owned `deny.toml` keeps no ignores (hull test).
- On a push to the default branch (`GITHUB_EVENT_NAME=push`, or CircleCI without
  `CIRCLE_PULL_REQUEST`) deny.mjs drops `advisories` from the default check list: main is covered
  by the daily scan (Task 2), so a new advisory never turns main red. PRs and merge_group check
  advisories.
- `RUST_CI_STEPS` deny entry becomes `node scripts/deny.mjs`; regenerate ci.yml + CircleCI;
  AGENTS.md.jinja, `.claude/skills/verify/SKILL.md`, deny.toml and deny.local.toml comments, and
  release.yml use only `node scripts/deny.mjs` (no bare `cargo deny`). A hull test greps the
  rendered rust repo: no `cargo deny` command outside deny.mjs.
- deny.local.toml comment documents the ignore format and that expired entries fail.

## Task 2: daily advisory scan (`feat(template-rust): daily advisory scan opens one issue`)

- Base owned `.github/workflows/advisories.yml`: `schedule` (one daily cron, minute not 0) +
  `workflow_dispatch`; top-level `concurrency: { group: advisories, cancel-in-progress: true }`;
  one job `scan`, job-level `if:` limited to schedule/workflow_dispatch on the default branch;
  `permissions: { contents: read, issues: write }`; no secrets beyond `github.token`. Steps: pinned
  checkout, pins, cargo-deny via taiki-e (same SHA as ci.yml), `node scripts/deny.mjs --locked
  check advisories` with output captured (`continue-on-error`), then
  `node .github/scripts/advisory-issue.mjs` which opens or updates ONE open issue (label
  `advisories`, fixed title) with the report, or comments and closes it when the scan is clean.
  The job itself stays green on findings; it fails only when the issue update fails.
- `.github/scripts/advisory-issue.mjs` (owned, Node built-ins + fetch): pure exported
  `plan({ ok, report, issues })` → `{ action: "create"|"update"|"close"|"none", … }`, tested.
- Add both to base `piece.toml` owned list; workflows.mjs/parse tests pass.

## Task 3: Renovate preset for exact Cargo pins (`feat(renovate): cargo preset with exact pins`)

- `renovate/cargo.json`: cargo manager `rangeStrategy: "pin"` (exact `=x.y.z`);
  `vulnerabilityAlerts` / `osvVulnerabilityAlerts: true`, security PRs `minimumReleaseAge: "0 days"`,
  schedule `at any time`, label `security`; cargo minor+patch grouped `cargo minor` on
  `before 5am on monday`; `lockFileMaintenance` weekly so transitive crates (libsqlite3-sys, DNS
  crates) move; a rule keeping `libsqlite3-sys` and other transitive crates enabled (never
  `enabled: false`); a custom regex manager for `pins.toml` `[crates]` plus one packageRule that
  groups those crate names across managers so `pins.mjs --check` stays green.
- template-rust `renovate.json` extends `github>keelstackhq/hull//renovate/default` and
  `github>keelstackhq/hull//renovate/cargo`. Test: JSON shape and the extends.

## Task 4: `rust-service` piece (`feat(template-rust): rust-service piece with /healthz`)

- `template-rust/pieces/rust-service/`: crate `crates/{{ service }}` (Cargo.toml.jinja shared toml
  merge, `publish = false`, bin `{{ service }}`), tokio + axum (exact pins in `[crates]`),
  `src/main.rs.jinja` (seed) reads config (`src/config.rs`), binds `0.0.0.0:$PORT`, serves
  `GET /healthz` → 200 `ok`, graceful shutdown on SIGTERM/SIGINT, trusts `Fly-Client-IP` only via a
  documented helper. Tests: `/healthz` returns 200 (in-process, no network). `AGENTS.md` (owned),
  `CLAUDE.md` (seed). main.rs.jinja has `{% if "sqlite" in pieces %}` hooks Task 5 fills.
- Base `pins.toml` `[crates]` + `scripts/pins.mjs --check` crate rule (+ test).
- Combo `scripts/combos/rust-service.json` (base + rust-service). Dogfood passes.

## Task 5: `sqlite` piece (`feat(template-rust): sqlite piece`)

Target `crates/{{ service }}`; shared `Cargo.toml` (toml merge) adds sqlx (`sqlite`,
`runtime-tokio`, `migrate`, no default features; libsqlite3-sys `bundled`, static on musl), and
`[features] s3-backup` (hyper + hyper-util + http-body-util + rustls + tokio-rustls + webpki-roots;
SigV4 by hand; no reqwest). Files (seed unless noted):
- `src/db/pool.rs`: writer pool `max_connections(1)`, reader pool sized `DB_READERS` and
  read-only; pragmas WAL, `synchronous=FULL`, `foreign_keys=ON`, `secure_delete=ON`,
  `busy_timeout`, and `SQLITE_TMPDIR` set to the data dir before the first open — each with a
  one-line reason comment.
- `migrations/0001_init.sql` (STRICT table) embedded with `sqlx::migrate!`, run at boot; test
  applies all migrations to an empty DB.
- `tests/strict.rs` (owned): fails on any `CREATE TABLE` in `migrations/*.sql` without `STRICT`.
- `src/db/testing.rs` + test: `assert_get_never_writes(router, db, paths)` fails if a GET changes
  `PRAGMA data_version` seen from a separate connection; a test proves it catches a writing GET.
- `src/db/backup.rs`: `VACUUM INTO` snapshot into `BACKUP_DIR`, keeps newest `BACKUP_KEEP`, calls
  an empty `scrub_pii(&conn)` hook on the snapshot; feature `s3-backup` PUTs the snapshot to
  S3/R2. Tests: snapshot + retention; SigV4 signing against a known vector.
- `--restore <snapshot>` mode (`src/db/restore.rs`): validates with `PRAGMA integrity_check`,
  replaces the DB with the service stopped, exits; `docs/restore.md` runbook.
- `src/db/sweeper.rs`: optional TTL sweeper (`TTL_SWEEP_SECS`, 0 = off).
- Combo `rust-sqlite.json` (base + rust-service + sqlite). Dogfood passes, also
  `cargo test --features s3-backup`.

## Task 6: `fly` piece (`feat(template-rust): fly piece`)

Root files; `Dockerfile.jinja`, `fly.toml.jinja` (seed), `scripts/fly-setup.sh` (owned),
`.github/workflows/deploy.yml.jinja` (owned), `docs/fly.md` (owned):
- Dockerfile: `FROM scratch AS proxy-ca` + builder (rust alpine at the `pins.toml` rust,
  musl target) using `scripts/proxy-ca.sh`'s `proxy-ca` context; `ARG FEATURES`; gates: no
  `INTERP` (`readelf -l`), no `NEEDED` (`readelf -d`), size ≤ `ARG MAX_BYTES`; final
  `FROM scratch`, `USER 65532:65532`, `/data` volume path.
- fly.toml: one machine (`min_machines_running = 1`, no autoscale beyond 1), `[mounts]`
  `/data` with `auto_extend_size_threshold`/`increment`/`limit`, `[[http_service.checks]]` GET
  `/healthz`, concurrency limits, docs note Fly-Client-IP is the trusted client-IP header.
- `scripts/fly-setup.sh`: idempotent (each step checks first): app, volume, secrets read from
  stdin (`KEY=VALUE` lines, never argv/logs), shared IPv4 + IPv6, certificate for `--host`, and
  `fly tokens create deploy` stored with `gh secret set FLY_API_TOKEN --env production`. Flags
  `--app`, `--region`, `--host`, `--dry-run` (prints, changes nothing), `--deploy`,
  `--set-gh-secret`. Fixed exit codes documented in the header (0 ok, 2 usage, 3 missing tool or
  auth, 4 a fly/gh step failed). Hull tests run it with stub `fly` and `gh` on PATH (log calls,
  check idempotence and that secrets never reach argv).
- deploy.yml: `workflow_run` of `ci` completed on the default branch with conclusion success, or
  `workflow_dispatch`; deploys `github.event.workflow_run.head_sha` (the tested sha); environment
  `production`; top-level `concurrency: { group: deploy-…, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }`
  so a deploy is never cancelled; `pull_request` (types incl. `ready_for_review`, draft-guarded)
  only builds the image (no secrets, no push); after deploy polls `https://<app>/healthz`. Passes
  `tests/ci-minutes-gate.mjs` with zero findings.
- docs/fly.md: setup, Cloudflare DNS-only (grey cloud) and why, rollback (`fly releases`,
  `fly deploy --image <previous>`), `bash scripts/proxy-ca.sh docker build …` behind the agent
  proxy.
- Combo `rust-fly.json` (base + rust-service + fly). Tests render it; docker build is not on the
  dogfood path.

## Task 7: docs, spec, full combo (`docs: rust service pieces in spec, pieces doc and progress`)

- Spec §15 "Service pieces" subsection; `docs/pieces.md` (via `scripts/pieces-doc.mjs` if
  generated); base AGENTS.md.jinja crate lines for rust-service/sqlite/fly; combo
  `rust-service-full.json` (rust-service + sqlite + fly); `docs/PROGRESS.md` lines.
