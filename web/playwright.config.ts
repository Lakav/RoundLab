import { defineConfig, devices } from "@playwright/test";

const benchmarkRun = Boolean(process.env.ROUNDLAB_BENCHMARK_DEMOS);
const reportRoot = benchmarkRun ? "./benchmark-results" : ".";

export default defineConfig({
  testDir: "./tests-e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // Chrome can occasionally be killed while launching on constrained runners.
  // Keep the failed attempt in the report, then retry once in every environment.
  retries: 1,
  reporter: [["list"], ["html", { outputFolder: `${reportRoot}/playwright-report`, open: "never" }]],
  outputDir: `${reportRoot}/test-results`,
  use: {
    baseURL: "http://127.0.0.1:4173/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: benchmarkRun
      ? "python3 -m http.server 4173 --bind 127.0.0.1 --directory out"
      : "ROUNDLAB_E2E_STATIC=1 pnpm build && python3 -m http.server 4173 --bind 127.0.0.1 --directory out",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testIgnore: [/accessibility\.spec\.ts/, /mobile\.spec\.ts/, /performance\.spec\.ts/],
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: [/accessibility\.spec\.ts/, /mobile\.spec\.ts/, /performance\.spec\.ts/],
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chrome",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-webkit",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone 15"] },
    },
  ],
});
