import { defineConfig, devices } from "@playwright/test";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const basePath = process.env.GITHUB_ACTIONS === "true" && repositoryName ? `/${repositoryName}` : "";
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
    baseURL: `http://127.0.0.1:4173${basePath}/`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: benchmarkRun
      ? "python3 -m http.server 4173 --bind 127.0.0.1 --directory out"
      : "pnpm dev --hostname 127.0.0.1 --port 4173",
    url: `http://127.0.0.1:4173${basePath}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
