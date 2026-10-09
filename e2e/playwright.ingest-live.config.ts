import { defineConfig, devices } from "@playwright/test";

/** Live ingestion journey (scripts/ingest-live/run.ts starts the real app and runs this). Screenshots are taken by the
 * spec itself into the run folder; no traces or videos (they would capture network bodies). */
export default defineConfig({
  testDir: "./ingest-live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 75 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.INGEST_LIVE_BASE ?? "http://localhost:3320",
    trace: "off", video: "off", screenshot: "off",
    viewport: { width: 1280, height: 900 },
  },
  outputDir: "../e2e-results/ingest-live-pw",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--disable-dev-shm-usage", "--js-flags=--max-old-space-size=256"] } } }],
});
