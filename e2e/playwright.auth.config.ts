import { defineConfig, devices } from "@playwright/test";

/**
 * Owner/reviewer browser journey with real session handling (e2e/auth-tests).
 * The app runs WITHOUT the development identity, against the test-only
 * Supabase Auth/Admin stand-in (e2e/support/fake-auth.mjs). Desktop,
 * phone and keyboard-only projects. See e2e/README.md for the stack.
 */
export default defineConfig({
  testDir: "./auth-tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 420_000,
  globalTimeout: 75 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  globalTeardown: "./support/auth-cleanup.ts",
  use: {
    baseURL: process.env.E2E_AUTH_BASE_URL ?? "http://localhost:3100",
    // No traces or videos (they would capture cookies, tokens and network
    // bodies); screenshots only on failure, of synthetic pages only.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  outputDir: "../e2e-results/auth",
  projects: [
    { name: "desktop", testMatch: /owner-reviewer-journey\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testMatch: /mobile-critical-path\.spec\.ts$/, use: { ...devices["Pixel 7"] } },
    { name: "keyboard", testMatch: /keyboard-critical-path\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
  ],
});
