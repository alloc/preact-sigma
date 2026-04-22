import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/*.runtime.test.ts"],
    environment: "node",
    typecheck: {
      enabled: true,
      include: ["tests/*.test-d.ts"],
      tsconfig: "./tsconfig.vitest.json",
    },
  },
  resolve: {
    alias: [
      {
        find: "preact-sigma/persist",
        replacement: fileURLToPath(new URL("src/persist.ts", import.meta.url)),
      },
      {
        find: "preact-sigma",
        replacement: fileURLToPath(new URL("src/index.ts", import.meta.url)),
      },
    ],
  },
});
