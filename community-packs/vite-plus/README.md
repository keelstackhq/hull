# @docspack-community/vite-plus

Recipe for a docspack package of the Vite+ docs.

- Source: the docs folder shipped in the `vite-plus` npm package (`node_modules/vite-plus/docs`),
  upstream <https://github.com/voidzero-dev/vite-plus> (guide at <https://viteplus.dev/guide>).
- Package version: the `vite-plus` version it was built from (hull pins 1.1.0).

Build (docspack 1.5.0), from the hull repo after `pnpm install`:

```bash
pnpm dlx docspack@1.5.0 build \
  --from node_modules/vite-plus/docs \
  --name @docspack-community/vite-plus \
  --pkg-version 1.1.0 \
  --min-chunk-tokens 120 \
  --out /tmp/vite-plus-docspack
cd /tmp/vite-plus-docspack && pnpm dlx docspack@1.5.0 doctor
```

Verified 2026-10-15: 224 chunks, about 68.5k tokens, `doctor` passes with 3 notes (one chunk
`index` is small). Without `--min-chunk-tokens` it yields 289 chunks and 13 notes.

Publishing (`npm publish` under the `@docspack-community` scope) is not done yet.
