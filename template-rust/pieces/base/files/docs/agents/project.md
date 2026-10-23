# Project notes

Notes for AI agents that are specific to this repository. `CLAUDE.md` imports this file; edit it
freely, template updates never touch it.

- What this project is:
- Commands beyond the CI steps in `AGENTS.md`:
- Conventions and decisions:

## Blocked

Human steps before the first release (`release.yml`, hoist):

- Remove `publish = false` from each crate to release, add its `[publish]` table to
  `crates/<name>/hoist.toml`, and set a license.
- `hoist apply --area release` (creates the `release` environment), then set the repository
  variable `HOIST_RELEASE` to `enabled`.
- After the first tag: `hoist release bootstrap` locally (first crates.io publish) and a crates.io
  trusted publisher (this repo, `release.yml`, environment `release`) for each crate.
