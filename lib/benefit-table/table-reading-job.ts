/** Goes on with a benefit-table reading that its run could not finish in its time limit (10 Nov: a 58-page schedule and a
 * 47-page wording ran out of time after the document's other reading, so neither ever had a table, and a retry never read
 * them again). Each continuation is one background job (lib/jobs/queue.ts), started by the next request drain or the
 * daily run, in a run of its own with its own time limit:
 * - it reads only what the reading has left (service.ts ReadingProgress): no part is paid for twice, and every run's
 *   calls count against the one reading's limit;
 * - it does nothing, and pays nothing, when the table is off, the document is gone, or a fresh reading (Read again)
 *   replaced the one it goes on with;
 * - one attempt per job (a failed paid run is never retried by the queue); the reading is never given up on (DC, 10 Nov): it
 *   goes on run after run until the whole document is read, each run reading only what is left. A run that paid for a call
 *   and read nothing makes the next one wait longer (service.ts readingRetryDelayMs), and after a few such runs in a row the
 *   operator is told in the logs. MAX_TABLE_READING_RUNS is only where that telling starts for a slow reading.
 * SQL text and queue calls only: no model import. */
import { enqueueJob } from "@/lib/jobs/queue";
import type { pool } from "@/lib/db/client";
import { TABLE_READING_JOB_TYPE } from "@/lib/rag/live-job";
export { TABLE_READING_JOB_TYPE };
/** Runs after which a reading still going on is reported to the operator (logs); it still goes on. */
export const MAX_TABLE_READING_RUNS = 10;
export type TableReadingPayload = { policyId: string; id: string; run: number };

/** Queues continuation `run` (1-based) of the reading named `id`. Idempotent per reading and run. `again`: the run is
 * queued again after the one meant to go on died (app.ts requeueStuckTableWork), under its own key, so it is a new job. */
export async function enqueueTableReading(db: { query: typeof pool.query }, accountId: string, policyId: string, id: string, run: number, delayMs = 0, again?: number) {
  if (run < 1) return null;
  const payload: TableReadingPayload = { policyId, id, run };
  return enqueueJob(db, { jobType: TABLE_READING_JOB_TYPE, idempotencyKey: `${policyId}:table-reading:${id}:${again ? `again-${again}` : run}`, payload, accountId, maxAttempts: 1,
    ...(delayMs > 0 ? { availableAt: new Date(Date.now() + delayMs) } : {}) });
}

export function tableReadingPayload(raw: unknown): TableReadingPayload {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (typeof p.policyId !== "string" || !p.policyId || typeof p.id !== "string" || !p.id || !Number.isInteger(p.run)) throw new Error("table reading job payload is malformed");
  return { policyId: p.policyId, id: p.id, run: p.run as number };
}

/** Queues link run `attempt` (1-based) of the stored reading named `id`: it links the reading's sections to covers and reads
 * nothing (app.ts readIntoTable, linkOnly). Its own key per attempt, so a link run queued again after one died is a new job,
 * each one later than the last (linkRetryDelayMs); it is queued until the reading is linked. */
export async function enqueueTableLink(db: { query: typeof pool.query }, accountId: string, policyId: string, id: string, attempt: number, delayMs = 0) {
  const payload: TableReadingPayload = { policyId, id, run: 0 };
  return enqueueJob(db, { jobType: TABLE_READING_JOB_TYPE, idempotencyKey: `${policyId}:table-reading:${id}:link-${attempt}`, payload, accountId, maxAttempts: 1,
    ...(delayMs > 0 ? { availableAt: new Date(Date.now() + delayMs) } : {}) });
}
