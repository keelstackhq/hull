# Astro site

Astro 7 static site (`output: "static"`) with Preact islands via `@astrojs/preact`, deployed as
Cloudflare static assets (`wrangler.jsonc`, `./dist`). Plain Preact components: cascivo is not used
here (it breaks under the `@astrojs/preact` compat setup).

- Astro runs through package scripts (`astro dev`, `astro build`); never `vp run`.
- Astro's own `vite` resolves to the Vite+ core through the root override: one vite in the lockfile.
- oxlint does not lint `.astro` templates; only TS/TSX is linted. Review `.astro` files by hand.
- oxfmt `.astro` support is experimental and off, so `format:check` excludes `.astro` files.
- `typecheck` is `tsc --noEmit` (TS/TSX only); `astro check` needs the TypeScript JS API.
- Tests: `vp test run`; component tests opt in to happy-dom with `// @vitest-environment happy-dom`.
- Preview deploy: `pnpm deploy:preview` with `PR_NUMBER` set.
