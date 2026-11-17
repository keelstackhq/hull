# Third-party licenses list (2026-11-17)

Goal: every generated repo (both `template/` and `template-rust/`) commits an always-current list
of its dependencies' licenses, for when rights are in doubt.

## Decisions

- **Files** (repo root, generated, not template files): `THIRD_PARTY_LICENSES.md` (summary per
  license, then one table row per package) and `third-party-licenses.json`
  (`{ note, inputs, packages }`; a package is `ecosystem` (`npm`|`cargo`), `name`, `version`,
  `license` (SPDX as declared), `source` (npm homepage, crate repository or registry), `direct`,
  `dev`). Sorted by ecosystem, name, version; no timestamps, so diffs show only real changes.
- **One script for both templates**: `scripts/licenses.mjs` (base, owned; Node built-ins only;
  copied to template-rust by `scripts/sync-shared.mjs`, which already runs Node scripts with the
  runner's `node`). Sources are the lockfiles present: `pnpm-lock.yaml` via `pnpm ls -r --depth 0`
  (direct) and `pnpm licenses list --json --prod`/`--dev` (needs `pnpm install`; no network);
  `Cargo.lock` via `cargo metadata --format-version 1 --locked` (fetches crate manifests as a build
  does). No new dependencies.
- **dev/prod**: npm, as pnpm's `--prod`/`--dev` split (prod wins); cargo, a crate is prod when a
  workspace member reaches it without a dev-dependency edge. Workspace members are not listed.
- **Platform builds** (lockfile `packages` entries with `cpu`/`os`/`libc`: turbo, oxlint, oxfmt,
  lightningcss, vite-plus bindings, fsevents, …) come from `pnpm-lock.yaml`, not pnpm (which
  lists only the installed platform's): the parent's license (the package naming it under
  `optionalDependencies`), source `platform build of <parent>`, so every machine writes the same
  list. Other optional deps come from pnpm. Cargo lists all targets (deterministic).
- **Unknown**: no or `Unknown` license → `UNKNOWN`, listed, and a stderr warning names each one;
  a crate with only `license-file` → `LicenseRef-file:<path>`.
- **No wrong lists**: with `pnpm-lock.yaml` but no `node_modules/.modules.yaml`, or when every
  license of an ecosystem (> 1 package) is UNKNOWN, the script exits 1 and writes nothing
  (pnpm itself exits 0 with all-UNKNOWN rows when nothing is installed).
- **`--check` is a hash gate**: the JSON `inputs` record the sha256 of each lockfile and of the
  script itself (CRLF normalised; a script change from `splice update` re-derives the list);
  `--check` fails when they differ or a file is missing, with
  ``run `node scripts/licenses.mjs` (after installing) and commit …``. It needs no install, so it
  runs before the affected early exit, like the index check (< 1 s, also on docs-only PRs); a
  lockfile or script change is the only way the list can go stale. Content is not re-derived in CI (would
  need a full install on every PR, D-007).
- **CI**: plan step `licenses` right after `agents-index` in `CI_PLAN` and `RUST_CI_PLAN`
  (GitHub and CircleCI); dogfood writes the list after the post hooks and checks it with the index.
- **When it is written**: template/ base on `new` (after `pnpm install`) and on `update` as
  `pnpm install --frozen-lockfile --ignore-scripts --prefer-offline && node scripts/licenses.mjs
  || true`, so the splice bot's PR (its action runs posts on the runner) carries the list; rust-tool
  and rust-cli chain it onto their Cargo.lock posts (`cargo generate-lockfile && { … || true; }`
  on `new`, `cargo update --workspace && …` on `add`), since post order between pieces is not
  fixed and splice ran an identical separate command only once (dogfood `cli` left Cargo.lock
  out). `|| true` is safe because the script fails without writing (above): the list stays
  stale, `ci-ok` names the command, and `new`/`add`/`update` still succeed. template-rust base on
  `new`/`update` (cargo needs no install; not `add`, where a new crate reaches Cargo.lock only in
  rust-cli's chained post), its rust-cli chained on `add`.
- **Open: Renovate**: hosted Renovate cannot run post-upgrade tasks, and an auto-commit job would
  need a write token on PR-controlled code (no). A Renovate PR that changes a lockfile fails
  `ci-ok` until an agent (ci-fixer) or a person runs `node scripts/licenses.mjs`.
- **Robustness**: a missing or failing `pnpm`/`cargo` prints the command and the fix, no stack
  trace; Windows starts them through a shell (`pnpm.cmd`). npm `direct` matches `name@version`
  from the workspace manifests. Both files are in the root `vp fmt` `ignorePatterns`, so
  `pnpm format` never rewrites them.
- **Agent docs**: one command line in each generated `AGENTS.md`; both verify skills run
  `--check`. The always-loaded byte ceiling test moves 4,216 → 4,290 (measured 4,278).
