# keelstack — docs for secrets repos and CI providers

Spec: hull `docs/superpowers/specs/2026-10-27-secrets-and-ci-providers-design.md` S§11. Start after
hoist HO-5 and hull HU-3/HU-4 are merged so the pages describe shipped behaviour (commands, inputs,
file names copied from those PRs, not from memory).

## KS-1: one PR (both pages share `docs.ts`, `docs.test.ts` and `docspack.json`)

Files: `apps/site/src/pages/docs/secrets.md`, `apps/site/src/pages/docs/ci-providers.md` (frontmatter
`layout: ../../layouts/Docs.astro`), `apps/site/src/data/docs.ts` (two `DocPage` entries with
`sources` pointing at hoist §15, hull spec 2026-10-27 and the plans), `apps/site/src/data/docs.test.ts`
(pin twelve pages, new order: after `ci`), `apps/site/docspack.json` (version bump + sources hash),
`getting-started.md` (tarball URL), one paragraph + link each in `ci.md`, `risk.md`, `cloud.md`,
`index.md`.
- Content: secrets page = S§3, §4.3, §4.4, §5 condensed, plus the owner checklist S§13 2-5; providers
  page = S§6.1 table, §7, §8 table, budgets, CircleCI checklist S§13 6-8. Each page ≤ 150 lines.
- Tests: `docs.test.ts`; the build regenerates `llms.txt`, `llms-full.txt` and `/docs/<slug>.md`;
  `scripts/docspack.mjs` passes with the bumped version.
- Commit: `docs: secrets and CI providers pages`
