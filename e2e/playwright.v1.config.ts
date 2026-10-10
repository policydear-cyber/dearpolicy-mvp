// V1 certification: identical to playwright.config.ts but WITHOUT the global
// teardown (data must survive for the stored-data verifier; cleanup is run
// and proven separately) and with its own outputDir so phase artifacts in
// e2e-results/v1-core-loop are not wiped between phases.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /tests\/v1-core-loop\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  globalTimeout: 20 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL_A ?? "http://localhost:3000",
    // No traces or videos (they capture cookies and network bodies);
    // screenshots only on failure, of synthetic pages only.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  outputDir: "../e2e-results/v1-pw",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
