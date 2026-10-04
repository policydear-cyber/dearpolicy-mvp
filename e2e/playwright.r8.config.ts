import { defineConfig } from "@playwright/test";

/**
 * Round 8 chat rendering (e2e/tests/r8-chat-render.spec.ts): the real chat
 * page in Chromium at phone and desktop sizes, with the household APIs
 * answered from recorded real answers. Needs only the Next.js app with the
 * development identity (DEV_AUTH_ENABLED=true) -- no database, worker or
 * model. Viewports are set per describe block in the spec.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /tests\/r8-[^/]*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_R8_BASE_URL ?? "http://localhost:3200",
    actionTimeout: 15_000,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--disable-dev-shm-usage"] },
  },
  outputDir: "../e2e-results/r8-pw",
  projects: [{ name: "chromium" }],
});
