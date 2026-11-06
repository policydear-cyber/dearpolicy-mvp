/** Finishes a figure check (guards.ts) that the reading's run could not finish in its time limit (a long document on a
 * 300 s serverless function). Each continuation is one background job (lib/jobs/queue.ts), run by the job runner's cron:
 * - it checks only the figures left "checking"; what is settled stays, and the spend limit counts the whole check;
 * - it does nothing, and pays nothing, when the guards are off, the reading was replaced since, or nothing is left;
 * - at most MAX_FIGURE_CHECK_RUNS continuations per reading, one attempt each (a failed paid run is never retried by the
 *   queue). What is still unchecked after that stays "still being checked", never used. */
import { enqueueJob } from "@/lib/jobs/queue";
import type { pool } from "@/lib/db/client";

export const FIGURE_CHECK_JOB_TYPE = "benefit_figure_check";
export const MAX_FIGURE_CHECK_RUNS = 6;
export type FigureCheckPayload = { policyId: string; at: string; run: number };

/** Queues continuation `run` (1-based) of the check that began at `at`. Idempotent per reading and run. */
export async function enqueueFigureCheck(db: { query: typeof pool.query }, accountId: string, policyId: string, at: string, run: number) {
  if (run < 1 || run > MAX_FIGURE_CHECK_RUNS) return null;
  const payload: FigureCheckPayload = { policyId, at, run };
  return enqueueJob(db, { jobType: FIGURE_CHECK_JOB_TYPE, idempotencyKey: `${policyId}:figure-check:${at}:${run}`, payload, accountId, maxAttempts: 1 });
}

export function figureCheckPayload(raw: unknown): FigureCheckPayload {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (typeof p.policyId !== "string" || !p.policyId || typeof p.at !== "string" || !p.at || !Number.isInteger(p.run)) throw new Error("figure check job payload is malformed");
  return { policyId: p.policyId, at: p.at, run: p.run as number };
}
