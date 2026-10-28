# Secrets

`secrets.toml` maps env var names to encrypted values in the secrets repos (`hoist`). It holds
no values; `hoist secrets check` validates it.

## Rules for agents

- Never decrypt or read secret values. No `sops`, no `SOPS_AGE_KEY`.
- Never run `hoist secrets edit`, `rotate`, `revoke` or `sync`; the owner does.
- Add a key by editing `secrets.toml` (the mapping only) and ask the owner to store the value.
- PR jobs (`ci`, `preview`) never get secrets. Only `deploy` (push to main, environment
  `prod`) and `preview-deploy` (environment `preview`) decrypt, through the hoist action.
- Never add `CLOUDFLARE_*`, the hoist action or an `environment:` to a PR workflow.

## Owner setup (once per repo)

- `hoist secrets grant` creates the GitHub environments `preview` and `prod` with deployment
  branches = Selected, `main`, and stores `SOPS_AGE_KEY` in each (environment secret only).
- `SECRETS_READ_APP_ID` is an org variable and `SECRETS_READ_APP_KEY` an org secret, restricted to
  the consumer repos.
- Never store any of these as repository secrets.
- Details: hull `docs/superpowers/specs/2026-10-27-secrets-and-ci-providers-design.md` §5.2.
