# decisions — D-009 and D-010

Spec: hull `docs/superpowers/specs/2026-10-27-secrets-and-ci-providers-design.md`, Appendix A (exact
text of both records and both index rows).

## DEC-1: one PR

Files: `decisions/009-secrets-sops-repos.md`, `decisions/010-ci-providers.md`, `DECISIONS.md` (two
rows), `channel/pieces/snapshot/files/docs/agents/org-decisions.md` (`cp DECISIONS.md …`).
- Align the table (`npx prettier --write DECISIONS.md`), then `bash scripts/check-index.sh` must pass
  (≤ 60 lines, aligned, unique IDs, links exist, snapshot identical).
- Commit: `docs: D-009 secrets repos, D-010 CI providers`. The owner merges (D-002); no auto-merge.
- Both decisions in one PR because both edit `DECISIONS.md` and the snapshot.
