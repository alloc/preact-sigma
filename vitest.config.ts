import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/*.runtime.test.ts"],
    environment: "node",
    typecheck: {
      enabled: true,
      include: ["tests/*.test-d.ts"],
      tsconfig: "./tsconfig.tests.json",
    },
  },
  resolve: {
    alias: {
      "preact-sigma": fileURLToPath(new URL("src/index.ts", import.meta.url)),
    },
  },
});
