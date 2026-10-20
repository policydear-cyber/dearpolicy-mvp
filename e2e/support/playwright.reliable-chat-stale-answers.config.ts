import { defineConfig, devices } from "@playwright/test";

/**
 * PR #69, reopened answers that no longer stand (e2e/tests/reliable-chat-stale-answers.spec.ts): the real chat page and /api/chat on
 * e2e/support/rag2-loop-server.ts (E2E_RAG2_HOUSEHOLD=actuallib, scripted moves from
 * scripts/fixtures/reliable-chat/actual-lib-conversations.ts), local PostgreSQL seeded by
 * `node --import tsx e2e/support/seed-rag2-stress-report.ts --household actuallib`. Synthetic data only.
 */
export default defineConfig({
  testDir: "../tests",
  testMatch: /reliable-chat-stale-answers\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_RAG2_BASE_URL ?? "http://localhost:3300",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  outputDir: "../../e2e-results/reliable-chat-stale-answers",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
