# Community docspack recipes

Recipes for docspack packages that no vendor publishes. Each folder `community-packs/<tool>/` holds
a `README.md` with the exact `docspack build` command and the upstream source URL. A recipe is
named by the `recipe` field of an entry in `template/pieces/docs/files/docs/packs.json`.

As of 2026-10-15 no `@docspack-community/*` package is published. Publishing needs the npm scope
and an owner, which is a manual step (see Blocked in `docs/PROGRESS.md`).

Check a build with `pnpm dlx docspack@1.5.0 doctor` inside the output directory before publishing.
