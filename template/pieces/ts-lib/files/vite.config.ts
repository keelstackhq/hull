import { defineConfig } from "vite-plus";
import { entries } from "./pack.entries";

export default defineConfig({
  pack: {
    entry: entries,
    format: ["esm"],
    dts: true,
  },
});
