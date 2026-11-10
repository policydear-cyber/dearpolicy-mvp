/** Goes on with a benefit-table reading that its run could not finish in its time limit (10 Nov: a 58-page schedule and a
 * 47-page wording ran out of time after the document's other reading, so neither ever had a table, and a retry never read
 * them again). Each continuation is one background job (lib/jobs/queue.ts), started by the next request drain or the
 * daily run, in a run of its own with its own time limit:
 * - it reads only what the reading has left (service.ts ReadingProgress): no part is paid for twice, and every run's
 *   calls count against the one reading's limit;
 * - it does nothing, and pays nothing, when the table is off, the document is gone, or a fresh reading (Read again)
 *   replaced the one it goes on with;
 * - at most MAX_TABLE_READING_RUNS continuations per reading, one attempt each (a failed paid run is never retried by the
 *   queue). A reading still unfinished after that says its table could not be read, and Read again starts a fresh one.
 * SQL text and queue calls only: no model import. */
import { enqueueJob } from "@/lib/jobs/queue";
import type { pool } from "@/lib/db/client";
import { TABLE_READING_JOB_TYPE } from "@/lib/rag/live-job";
export { TABLE_READING_JOB_TYPE };
export const MAX_TABLE_READING_RUNS = 10;
export type TableReadingPayload = { policyId: string; id: string; run: number };

/** Queues continuation `run` (1-based) of the reading named `id`. Idempotent per reading and run. */
export async function enqueueTableReading(db: { query: typeof pool.query }, accountId: string, policyId: string, id: string, run: number) {
  if (run < 1 || run > MAX_TABLE_READING_RUNS) return null;
  const payload: TableReadingPayload = { policyId, id, run };
  return enqueueJob(db, { jobType: TABLE_READING_JOB_TYPE, idempotencyKey: `${policyId}:table-reading:${id}:${run}`, payload, accountId, maxAttempts: 1 });
}

export function tableReadingPayload(raw: unknown): TableReadingPayload {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (typeof p.policyId !== "string" || !p.policyId || typeof p.id !== "string" || !p.id || !Number.isInteger(p.run)) throw new Error("table reading job payload is malformed");
  return { policyId: p.policyId, id: p.id, run: p.run as number };
}
