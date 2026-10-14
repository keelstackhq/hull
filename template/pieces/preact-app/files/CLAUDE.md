# Preact app

Preact client app on Vite+, deployed as Cloudflare static assets (`wrangler.jsonc`, SPA fallback).

- Components come from `@cascivo/react` (prebuilt, React API) running on `preact/compat`: the
  Preact preset aliases `react` to `preact/compat`, `tsconfig.json` maps the same for types.
  `react` and `react-dom` are dev-only peers; `@preact/signals-react` is required by cascivo.
- Import a theme once in `src/main.tsx` (`@cascivo/themes/light-dark.css`); component CSS is automatic.
- Tests: `vp test run` with `happy-dom`; `vite.config.ts` inlines `@cascivo/*` so the alias applies.
- `pnpm dev` serves on port 5173; `pnpm build` writes `dist/`.
- Preview deploy: `pnpm deploy:preview` with `PR_NUMBER` set.
