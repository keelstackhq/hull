import { defineConfig } from "vite-plus";

// Shared lint and fmt options. `vp lint` and `vp fmt` read this root config from every package
// (nested configs are not applied), so packages keep only their own build/test options.
export default defineConfig({
  lint: {
    categories: { correctness: "error", suspicious: "error" },
    ignorePatterns: ["**/dist/**", "**/.astro/**", "**/storybook-static/**", "**/target/**"],
  },
  fmt: {
    // The workspace dependency "@<scope>/ui" has a scope-dependent sort position; keep the
    // template's key order instead of oxfmt's alphabetical one.
    sortPackageJson: false,
    ignorePatterns: [
      "**/dist/**",
      "**/.astro/**",
      "**/*.astro",
      "**/storybook-static/**",
      "**/target/**",
      "pnpm-lock.yaml",
    ],
  },
});
