import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// One synthetic password per run, shared with the workers through their
// environment (memory only): a restarted worker must sign in as the same
// synthetic user.
process.env.V11_UX_SYNTHETIC_PASSWORD ??= `Syn-${randomBytes(18).toString("base64url")}`;

/**
 * V1.1 customer-experience browser checks (e2e/tests/v11-ux-*.spec.ts).
 * Real sessions: the app runs WITHOUT the development identity, against the
 * test-only Supabase Auth stand-in (e2e/support/fake-auth.mjs), exactly like
 * e2e/playwright.auth.config.ts. Synthetic users only; the auth teardown
 * deletes them and fails the run on any residue.
 *
 *   node e2e/support/fake-auth.mjs &              (DEARPOLICY_TEST_AUTH_ADAPTER=fake-gotrue)
 *   npx next dev -p 3100 &                        (no DEV_AUTH_ENABLED; SUPABASE_URL=http://127.0.0.1:4020)
 *   npx playwright test -c scripts/v11-ux-playwright.config.ts
 */
export default defineConfig({
  testDir: "../e2e/tests",
  testMatch: /v11-ux-.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  globalTeardown: "../e2e/support/auth-cleanup.ts",
  use: {
    baseURL: process.env.E2E_AUTH_BASE_URL ?? "http://localhost:3100",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  outputDir: "../e2e-results/v11-ux",
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}) } }],
});
