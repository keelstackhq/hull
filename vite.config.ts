import { defineConfig } from "vite-plus";

export default defineConfig({
  // The lock fixture keeps the contract §6 column alignment on purpose.
  fmt: { ignorePatterns: ["tests/fixtures/lock/**"] },
});
