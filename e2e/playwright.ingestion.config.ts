import { defineConfig, devices } from "@playwright/test";

/**
 * Document-ingestion browser journey (prototype document-safety mode).
 * Runs against an app started with MALWARE_SCANNING_INTENTIONALLY_DISABLED=true
 * and NO scanner configured, and deliberately WITHOUT the standalone jobs
 * worker: processing advances only through the bounded request-drain
 * (lib/jobs/request-drain.ts) that status polling triggers, which is exactly
 * how the Vercel Hobby prototype runs. Local synthetic data only.
 */
export default defineConfig({
  testDir: "./ingestion-tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  globalTimeout: 30 * 60_000,
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
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      // The local runner has ~1GB RAM: without these flags Chromium's
      // renderer can exhaust /dev/shm or get OOM-killed mid-navigation
      // ("Page crashed") under two dev servers + Postgres.
      launchOptions: { args: ["--disable-dev-shm-usage", "--js-flags=--max-old-space-size=256"] },
    },
  }],
});
