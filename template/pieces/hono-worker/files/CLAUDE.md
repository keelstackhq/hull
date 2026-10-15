# Hono worker

Hono app on Cloudflare Workers. `wrangler.jsonc` enables Workers Logs (`observability`) and
`nodejs_compat`; `vars` holds `LOG_LEVEL` and `SENTRY_DSN`.

- Order in `src/index.ts`: `requestId()`, `jsonLogger()`, `onError(onErrorHandler)`; export
  `withOptionalSentry(app)`. `src/hull/*` is owned by hull; app code lives in `src/index.ts`.
- One JSON line per request: `level`, `msg`, `requestId`, `method`, `path`, `status`, `durationMs`,
  optional `colo`, `country`. A thrown error logs exactly one `error` line and answers
  `500 {"error":"internal","requestId"}`.
- Never log the query string, headers or body: no secrets or PII in logs. Do not add
  `console.log` of request data elsewhere.
- `LOG_LEVEL` (`info`, `warn`, `error`) drops request lines below it.
- Sentry loads (dynamic import) only when `SENTRY_DSN` is non-empty; set it with
  `wrangler secret put SENTRY_DSN`, not in `wrangler.jsonc`. Sentry is bundled (about 1.2 MB)
  but only evaluated when `SENTRY_DSN` is set. Its events are scrubbed of query, headers and bodies.
- Pricing: Workers Logs free tier becomes 0.5 GB/day from 2026-12-01. Lower
  `observability.head_sampling_rate` (for example `0.1`) to sample fewer requests.
- `build` is `wrangler deploy --dry-run --outdir dist` (no deploy). Never `vp run`.
- Tests: `vp test run`, using `app.request()`. Preview deploy: `pnpm deploy:preview` with
  `PR_NUMBER` set.
