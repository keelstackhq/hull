import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  integrations: [preact()],
});
