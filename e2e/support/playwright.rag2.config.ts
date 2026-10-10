import { defineConfig, devices } from "@playwright/test";

/**
 * Browser integration spec for the conversational RAG loop (e2e/tests/rag2-conversation.spec.ts): the real chat page
 * and /api/chat on e2e/support/rag2-loop-server.ts (DEARPOLICY_RAG_LOOP=1, scripted TEST model, local PostgreSQL
 * seeded by e2e/support/seed-rag2-conversation.ts). Synthetic data only; no traces or videos.
 */
export default defineConfig({
  testDir: "../tests",
  testMatch: /rag2-conversation\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_RAG2_BASE_URL ?? "http://localhost:3300",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  outputDir: "../../e2e-results/rag2-conversation",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
