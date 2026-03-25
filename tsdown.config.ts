import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "./framework.ts",
  format: ["esm"],
  outDir: "dist",
  clean: true,
  dts: { build: true },
});
