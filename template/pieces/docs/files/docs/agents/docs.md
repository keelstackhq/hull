# Docs for agents

Library and tool docs are indexed locally by docspack, version-locked to what is installed.

- Ask first, search the web second: `pnpm exec docspack ask "<question>" --json`
  (at most 3 chunks / 3000 tokens). Exit 3 means a docs package is installed but not indexed, run
  `pnpm docs:sync`; exit 4 means nothing matched.
- `pnpm docs:sync` indexes installed docs packages and this repo's own Markdown and code map.
- `docs/packs.json` lists the docs packs this repo wants. `pnpm docs:packs` shows which are
  installed or missing and prints the `pnpm add -D <package>` command for each missing one
  (`pnpm add -D -E <package>@<version>` for a pinned pack; installed is checked by name). It
  never edits `package.json`; add packages yourself. `pnpm docs:packs --online` also checks
  whether a missing package is published.
