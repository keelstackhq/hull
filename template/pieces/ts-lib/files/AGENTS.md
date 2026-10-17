# Library package

Publishable ESM TypeScript library, built with `vp pack` into `dist/` (`index.mjs`, `index.d.mts`).

- The public API is `exports` in `package.json`; add entries there and in `vite.config.ts`
  (`pack.entry`) together.
- `isolatedDeclarations` is on: every exported function, class member and constant needs an
  explicit type annotation.
- `build` runs `vp pack`, then `publint` and `attw --pack . --profile esm-only`; fix their findings,
  do not silence them.
- ESM only; no CJS build, no `postinstall` scripts.
- To release, bump `version` in `package.json` and a human pushes the tag `<name>-v<version>`.
