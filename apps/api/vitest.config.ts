import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests need the regtest stack; run them with `pnpm test:integration`.
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
