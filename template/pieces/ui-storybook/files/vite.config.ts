import preact from "@preact/preset-vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [preact()],
  pack: {
    entry: ["src/index.ts"],
    dts: true,
    format: ["esm"],
    // The package ships source-level Preact components; consumers bring preact and cascivo.
    deps: { neverBundle: [/^@cascivo\//, /^preact/, "react", "react-dom"] },
  },
  test: {
    environment: "happy-dom",
    // cascivo imports "react"; inline it so the preact/compat alias applies in tests too.
    server: { deps: { inline: [/@cascivo\//] } },
  },
});
