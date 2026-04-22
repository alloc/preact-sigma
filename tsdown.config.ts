import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/persist.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  dts: { build: true },
});
