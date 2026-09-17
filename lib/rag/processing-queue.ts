import { processPolicy, type ProcessPolicyArgs } from "@/lib/rag/ingest";

type QueueGlobal = typeof globalThis & { __dearpolicyPolicyQueue?: Promise<void> };

/**
 * Local-first background queue. Policy jobs run one at a time so a large upload
 * cannot collide with another Qwen/BGE job. The HTTP upload request can return
 * immediately while progress is persisted in PostgreSQL and polled by the UI.
 */
export function enqueuePolicyProcessing(args: ProcessPolicyArgs) {
  const state = globalThis as QueueGlobal;
  const previous = state.__dearpolicyPolicyQueue ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        await processPolicy(args);
      } catch (error) {
        // processPolicy already writes the user-visible failure to the database.
        console.error("DearPolicy background processing failed:", error);
      }
    });
  state.__dearpolicyPolicyQueue = next;
  return next;
}
