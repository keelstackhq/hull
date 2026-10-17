# Library package

Publishable ESM TypeScript library, built with `vp pack` into `dist/` (`index.mjs`, `index.d.mts`).

- The public API is `exports` in `package.json`; add entries there and in `pack.entries.ts`
  (not the owned `vite.config.ts`) together.
- npm provenance needs `repository`; `release.yml` sets it to this GitHub repo when it publishes.
- `isolatedDeclarations` is on: every exported function, class member and constant needs an
  explicit type annotation.
- `build` runs `vp pack`, then `publint` and `attw --pack . --profile esm-only`; fix their findings,
  do not silence them.
- ESM only; no CJS build, no `postinstall` scripts.
- To release, bump `version` in `package.json` and a human pushes the tag `<name>-v<version>`.
  Human steps first: first publish of each new npm name by hand; a trusted publisher (this
  repo, `release.yml`, environment `release`), then release within 2 days; a `release`
  environment with a tag rule.
