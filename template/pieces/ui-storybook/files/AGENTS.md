# UI package

Preact component package on cascivo, built with `vp pack` into `dist/`, documented in Storybook 10.6
(`@storybook/preact-vite`).

- Components live in `src/`, are exported from `src/index.ts`, and each has a `*.stories.tsx` and a
  `*.test.tsx`. cascivo runs on `preact/compat` (`tsconfig.json` paths, `vite.config.ts` uses the Preact preset and inlines it).
- `pnpm storybook` serves on port 6006. `pnpm storybook:build` writes `storybook-static/`; it is
  not on the PR path.
- `test` is `vp test run` (happy-dom unit tests); there are no Storybook browser tests.
- Storybook declares `vite-plus` ^0.1/^0.2 as an optional peer; the workspace
  `peerDependencyRules` accepts 1.x. Storybook with Vite+ 1.x is not tested upstream.
