# hoard — run outside GitHub Actions (CircleCI)

Spec: hull `docs/superpowers/specs/2026-10-27-secrets-and-ci-providers-design.md` S§6.4, P7, P8.
hoard spec: add a short "Other CI providers" section in the same PR. Tech stack: nothing new.
hoard already has `hoard serve` (incl. `fs` storage), `hoard env` and `/_hoard/*`; the Action does
download + SHA-256, start, export, stop + summary. HD-1 gives non-Actions runners the same.

## HD-1: standalone install + start/stop

Files: `scripts/install.sh` (download the release binary for linux x64/arm64, verify SHA-256 from the
release's checksums file written by `scripts/write-checksums.mjs`; `HOARD_VERSION` required),
`src/main.rs` + `src/serve.rs` (`hoard serve --detach --pid-file` if not present; `hoard stop
[--summary markdown]` sends the shutdown request to `/_hoard/*`, waits for pending uploads, prints the
same summary table as the Action's job summary), `docs/circleci.md` (setup, `fs` + CircleCI cache keys
from S§6.4, R2 option for both-mode sharing), `circleci/hoard.yml` (reference CircleCI command that hull
vendors byte-identically: install, start with `--storage fs --dir ~/.cache/hoard`, `eval "$(hoard env)"`
into `$BASH_ENV` — token is a random localhost token, not a secret — and a `when: always` stop),
`tests/standalone.rs` (start detached on a temp dir, turbo-API PUT/GET, stop prints the summary and the
PID is gone; stop with no server → exit 1 with a clear message).
- Commit: `feat: run hoard outside GitHub Actions (CircleCI)`
- After merge: owner releases hoard (the new version is what hull HU-2 pins).
