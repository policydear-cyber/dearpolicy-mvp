import { defineConfig, devices } from "@playwright/test";

/**
 * V1.1 independent release evaluation (e2e/tests/v11-*.spec.ts), on the owner/reviewer stack:
 * the app WITHOUT the development identity, the test-only Auth stand-in, fake VirusTotal, the job
 * worker, local Postgres and the deterministic model stand-in (see e2e/README.md and
 * .github/workflows/owner-reviewer-e2e.yml for the stack). The global teardown is the
 * owner/reviewer one: it deletes this run's Auth users, reviewer rows and any household the
 * journey did not delete, and fails on residue; scripts/v1-db-verification.ts --cleanup-proof is
 * run afterwards for the independent proof.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /tests\/v11-[^/]*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 100 * 60_000,
  globalTimeout: 110 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  globalTeardown: "./support/auth-cleanup.ts",
  use: {
    baseURL: process.env.E2E_AUTH_BASE_URL ?? "http://localhost:3100",
    // A bounded wait for every action: an optional element (no error banner, no pending
    // question) must never hang the journey.
    actionTimeout: 15_000,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  outputDir: "../e2e-results/v11-pw",
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
