import { after } from "next/server";

/** Runs `task` after the response is sent when a real request scope is
 * available (after() — kept alive by the platform, e.g. Vercel's waitUntil).
 * Outside a request scope — a route handler invoked directly, as the test
 * suites do — after() throws immediately, so this falls back to plain
 * fire-and-forget, which is exactly what those scripts need. */
export function runAfterResponse(task: () => void | Promise<void>) {
  try {
    after(task);
  } catch {
    void Promise.resolve().then(task).catch((error) => console.warn("Background task failed:", error instanceof Error ? error.message : error));
  }
}
