import preact from "@preact/preset-vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [preact()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: "happy-dom",
    // cascivo imports "react"; inline it so the preact/compat alias applies in tests too.
    server: { deps: { inline: [/@cascivo\//] } },
  },
});
