import { defineConfig, devices } from "@playwright/test";

/**
 * V1.5 browser spec for the live-library inventory (e2e/tests/rag2-livelib.spec.ts): the real chat page
 * and /api/chat on e2e/support/rag2-loop-server.ts (DEARPOLICY_RAG_LOOP=1, scripted TEST model, local PostgreSQL
 * seeded by e2e/support/seed-rag2-stress-report.ts; server started with E2E_RAG2_HOUSEHOLD=livelib). Synthetic data only; no traces or videos.
 */
export default defineConfig({
  testDir: "../tests",
  testMatch: /rag2-livelib\.spec\.ts$/,
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
  outputDir: "../../e2e-results/rag2-livelib",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
