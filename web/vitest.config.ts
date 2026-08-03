import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests-e2e/**", "node_modules/**"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      // `lcov` already emits the browsable `lcov-report/`; adding `html`
      // duplicates the same source pages at the coverage root.
      reporter: ["text", "json", "json-summary", "lcov"],
      include: [
        "src/lib/**/*.ts",
        "src/app/page.tsx",
        "src/app/match/MatchViewer.tsx",
        "src/components/replay/**/*.tsx",
      ],
      exclude: [
        "src/lib/types.ts",
        "src/lib/backends/types.ts",
        "src/wasm/**",
      ],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
});
