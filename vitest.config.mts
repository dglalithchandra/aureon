import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror tsconfig's `"@/*": ["./*"]`. A regex so `@anthropic-ai/...` and
    // other scoped packages are left alone.
    alias: [{ find: /^@\//, replacement: repoRoot }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // The app logger prints JSON for every LLM call; only show it for failures.
    silent: "passed-only",
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
