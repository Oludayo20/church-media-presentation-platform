import { defineConfig } from "vitest/config";

// Single root config (workspace convention): tests live in `__tests__/`
// folders next to the code and are named `*.test.ts(x)`. Electron e2e tests
// are `*.e2e.ts` and run under Playwright, not Vitest.
export default defineConfig({
  test: {
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/out/**", "**/dist/**"],
    environment: "node",
  },
});
