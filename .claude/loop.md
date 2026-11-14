Fast checks until green: `pnpm test && pnpm lint && pnpm format:check`. Fix the first failure only,
rerun, repeat. Dogfood the combos `node scripts/affected-combos.mjs --base HEAD` selects before a
push. Stop after three failed fixes of the same failure and report it in at most 5 lines. Do not commit.
