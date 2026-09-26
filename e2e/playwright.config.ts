import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  globalTimeout: 20 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  globalTeardown: "./support/cleanup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL_A ?? "http://localhost:3000",
    // No traces or videos (they capture cookies and network bodies);
    // screenshots only on failure, of synthetic pages only.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  outputDir: "../e2e-results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
