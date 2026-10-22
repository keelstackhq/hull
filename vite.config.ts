import { defineConfig } from "vite-plus";

export default defineConfig({
  // The lock fixture keeps the contract §6 column alignment on purpose; the conformance corpus
  // is a byte-for-byte copy of splice's tests/fixtures/subset.
  fmt: {
    ignorePatterns: [
      "tests/fixtures/lock/**",
      "tests/fixtures/conformance/**",
      "tests/fixtures/explorer/**",
    ],
  },
});
