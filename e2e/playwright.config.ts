import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Specs that need another stack run on it, in their own job of
  // .github/workflows/browser-e2e.yml (never against this development-identity stack):
  //   r8-*            chat rendering        e2e/playwright.r8.config.ts (chat-render-e2e.yml)
  //   v11-*           sign-up / sign-in     e2e/playwright.v11.config.ts (test-only Auth stand-in, no dev identity)
  //   rag2-*, reliable-chat-*  scripted loop model  e2e/support/playwright.<spec>.config.ts (rag2-loop-server.ts,
  //                   which serves the /__rag2stress seeding routes this stack does not have)
  //   v1-core-loop    phased certification  e2e/playwright.v1.config.ts (household B first, then A)
  testIgnore: [/tests\/r8-[^/]*\.spec\.ts$/, /tests\/v11-[^/]*\.spec\.ts$/, /tests\/rag2-[^/]*\.spec\.ts$/, /tests\/reliable-chat[^/]*\.spec\.ts$/, /tests\/v1-core-loop\.spec\.ts$/],
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
