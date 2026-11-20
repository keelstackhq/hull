# Guard hook: safe patterns

`.claude/hooks/guard.mjs` checks every Bash, Read, Grep, Glob and edit call. It is a rail, not a
sandbox: branch rulesets and environment-gated releases are the real protection. A deny names its
rule and the allowed alternative. Use the patterns below; they pass.

## Reads that pass

| Need                      | Use                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------- |
| GitHub API read           | `gh api repos/<o>/<r>/pulls`, `gh api -X GET ...`, `curl -s https://api.github.com/...` |
| Remote refs               | `git ls-remote origin \| grep refs/tags`, `git ls-remote --tags <url>`                  |
| Fetch, then look          | `git fetch origin main && git log --oneline origin/main -3`                             |
| Look inside a guarded dir | `cd .bosun && ls && cat bosun.toml` (only reads after the `cd`)                         |
| Globs                     | `ls -d .*`, `cat .bosun/*.toml`, `grep -n push .github/workflows/*.yml`                 |
| Variable names of secrets | `cat .env.example`; run with values: `hoist secrets exec -- <cmd>`                      |

After `cd` into `.claude/`, `.claude/hooks/`, `.bosun/` or `.github/workflows/`, the rest of the
command may only read (`ls`, `cat`, `grep`, `head`, `git log`, ..., redirects to `/dev/null`
only; `x>file` counts as a write, and so do `GIT_*=`/`PAGER=` prefixes). Write from the repo root
with the full path instead, so the guard sees the target.

## Rails that stay

- No push to the default branch, no force push, no tag push, no `npm|pnpm|cargo publish`, no
  `gh release`, no `gh pr merge` without `--auto`: open a PR and run `gh pr merge --auto`.
- No reads of secret files (`.env*`, keys, `~/.ssh`, `~/.config/gh`) or whole-environment dumps.
- No edits of `.claude/hooks/`, `.claude/settings*.json`, release workflows, `.bosun/`,
  `pins.toml` (release workflows install its versions), `.splice/lock.toml`; template-owned files ask first (change them with `splice update`).
- No `gh api` writes to repo settings (rulesets, environments, secrets): those are owner steps.
- A target the guard cannot read (`cd "$D"`, `eval`, a pipe into `sh`) is refused when it could
  hide one of the above: spell the command out.
