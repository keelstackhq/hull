- Guard hook (`.claude/hooks/guard.mjs`, both templates) hardened from an audit of v0.10.0; every deny
  names the allowed alternative.
  - Denies `gh pr merge` unless `--auto`, `gh release`/`secret`/`repo edit|delete`, branch-protection
    and ruleset `gh api` writes, `gh workflow run release*`, `gh auth token`.
  - `release` is a publish verb (`pnpm|npm|yarn|bun [run] release`, `cargo release`, `make release|publish`).
  - Indirection is refused when the text mentions push, publish or release: `eval`, `sh`/interpreter fed
    from a pipe, `-c`/`-e` bodies, `$VAR` or `$(...)` as the command, `git -c alias.x=`, and the wrappers
    `setsid`, `ionice`, `stdbuf`, `watch`, `busybox`, `doas` are looked through.
  - Pushing to the default branch (`main`, `master`, origin/HEAD) is denied in every spelling
    (`HEAD:main`, `refs/heads/x:refs/heads/main`, bare `git push` while on it, `--prune`), as are
    `git branch -D|-f|-m main`, `checkout -B`/`switch -C` on it and `reset --hard` while on it.
  - Secrets: `*.env`, `.envrc`, `*.pem`, `id_*`, `keys.txt`, `.age/`, `~/.aws|.ssh|.config/gh`,
    `/proc/*/environ`, bare `env`/`printenv`/`export -p`, `echo $…KEY…`, `sops -d`, `age -d`,
    `hoist secrets exec -- env|printenv|sh`.
  - Protected files (`.claude/hooks/*`, `.claude/settings*.json`, `release*.yml`, `.splice/lock.toml`,
    `.bosun/*`) deny Edit/Write and Bash write verbs regardless of the lock; so do `git config
    core.hooksPath` and `alias.*`.
  - An internal error denies (retry) when the call mentions push, publish, release, gh or secret;
    otherwise it still allows.
- Owned-file `ask` names the alternative (`ci.yml` → `scripts/ci-extra.sh`, else `docs/agents/project.md`).
- `ready` never blocks work: unanswered onboarding questions take defaults (update bot = session,
  secrets = none, bosun by `.bosun/`, approvals per D-012, ci = github, release = no); only `pieces`
  and `apps` stay manual; a missing plan is `warn`; manual items print once as one checklist.
- `base` ships the four subagents (`.claude/agents/*.md`, owned, identical to rigging's `claude`
  piece) and a seed `docs/agents/index.md` stub, so a plain render has no manual `splice channel add`
  and `CLAUDE.md`'s index import resolves. `CLAUDE.md` lists every skill, `ready` included. A repo that
  added rigging's `claude` piece must drop that piece before `splice update` (same paths).
- `settings.json`: no `model` pin; allow `git push`, `git branch|switch|checkout|stash|rebase`,
  `gh pr create|view|checks`, `gh pr merge --auto`, `gh api`, `node scripts/*` (the guard still denies
  the dangerous forms).
- `AGENTS.md` rules trimmed (every session pays for them) and one line says the server-side branch
  ruleset is the real fix.
- Generated `ci.yml`: the turbo tarball is verified with a pinned sha256 (no `curl | tar`) and the job
  `timeout-minutes` is 10 (was 15).
