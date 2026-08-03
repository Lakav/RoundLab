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
        "src/**/*.{ts,tsx}",
      ],
      exclude: [
        "src/lib/types.ts",
        "src/lib/analysis/benchmark-types.ts",
        "src/lib/analysis/mechanics-types.ts",
        "src/lib/analysis/spatial-types.ts",
        "src/lib/analysis/types.ts",
        "src/lib/backends/types.ts",
        "src/wasm/**",
      ],
      thresholds: {
        statements: 76,
        branches: 67,
        functions: 79,
        lines: 79,
        "src/lib/backends/**/*.ts": {
          statements: 85,
          branches: 75,
          functions: 80,
          lines: 90,
        },
        "src/components/report/**/*.tsx": {
          statements: 78,
          branches: 60,
          functions: 75,
          lines: 80,
        },
        "src/workers/**/*.ts": {
          statements: 60,
          branches: 50,
          functions: 65,
          lines: 65,
        },
      },
    },
  },
});
