# Update a hull repo to the latest hull

One tool does it: `splice` (0.3.0 or later; hull 0.4.0 and later need it). Commands run from the
repo root. Use `pnpm dlx @keelstackhq/splice …` if `splice` is not installed. Add `--json` for
machine output (exit codes: 0 ok, 1 drift, conflict or update available, 2 usage, 3 template error).

## Quick path

```bash
git switch -c chore/splice-update          # clean working tree on a branch
splice check --json                        # exit 1 = update available, owned drift or leftover markers
splice diff                                # preview, writes nothing (--to X.Y.Z for a pinned target)
splice update --all                        # main template + channels (decisions, rigging)
pnpm install && pnpm run ci                # lockfile and checks
git add -A && git commit -m "chore: splice update to hull vX.Y.Z"
```

Normally you do not run this: the weekly `splice` workflow (`splice update --all`) opens the PR
on `splice/update`. Run it by hand to update now or to fix a PR with conflicts. Merge only when
`ci-ok` is green.

## What changes, by file class

| Class                                                                                 | On `update`                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `owned` (configs, workflows, `.claude/`, agent docs)                                  | replaced by the new render                                         |
| `shared` (`package.json`, `turbo.json`, `pnpm-workspace.yaml`, crate `Cargo.toml`, …) | 3-way merge: your keys and edits stay, new template keys are added |
| `seed` (app source, per-package `CLAUDE.md`)                                          | never touched                                                      |

`splice explain <path>` prints the class and owning piece of any file.

## Conflicts

- **Owned file edited by hand.** `update` refuses and lists the files. Move your change to a seed
  file, `docs/agents/project.md` or a package `AGENTS.md`; `git restore` the owned file; rerun. Use
  `--force` only when you accept losing the local edit (`splice diff` first).
- **Shared file, same key or line changed by both.** The file gets a conflict: structured files
  (`json`, `yaml`, `toml`) report the key; text files get diff3 markers (`<<<<<<< ours`,
  `||||||| base`, `=======`, `>>>>>>> template`). Find them with `splice check` or
  `git grep -n '<<<<<<<'`. Resolve each by hand, keep exact catalog pins from the template unless
  you pinned on purpose, then rerun `splice check` (exit 0 means no markers, drift or pending update are left).
- **Dirty tree.** Commit or stash first; `--allow-dirty` only if you know why.
- **Removed pieces/files.** Owned files the new hull no longer ships are deleted only if unedited;
  edited ones are reported, delete them yourself.
- **Channel only.** `splice update --channel decisions` refreshes one channel; commit it alone as
  `chore: sync org decisions`.

## For agents

1. Never edit owned files to "fix" an update; change the seed side or ask the owner.
2. Run `splice diff --json`, read `changes` (`conflict` and `delete` entries need a decision), then
   `splice update --all --json`.
3. Resolve markers with minimal edits, run `splice check`, `pnpm install`, `pnpm run ci`.
4. One update per PR. Do not tag, release or merge. Report owner-only items (new environments,
   secrets, App installs) from the PR text.
5. If `check` still exits 1 after the fixes, stop and report its output.

## Adding or switching pieces

`splice add <piece>` adds one (for example `splice add circleci`), then the same commit steps.
An existing repo that never had a lock uses `splice adopt` (see `docs/adopt.md`).

## What changed in dependency bumps

Read these before merging the update PR. Run `vp fmt` and `pnpm run ci` afterwards.

Also read the CHANGELOG v0.8.0 consumer notes (preact 11, happy-dom 21, hono, wrangler, astro, sentry).

- **vite-plus 1.5 (from 1.1):** newer oxlint/oxfmt may flag code, so run `vp fmt`; the vitest
  browser port is 23315; mistyped task settings now error.
