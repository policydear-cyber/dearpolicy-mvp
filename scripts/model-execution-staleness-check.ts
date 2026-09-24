/**
 * Checkpoint 14i (claude/v1-launch-hardening): operator/cron CLI for
 * lib/ai/staleness.ts's staleExecutionSummary() worklist -- the real
 * caller scripts/launch-check.ts's model_prompt_schema_governance
 * capability previously found missing everywhere in this codebase.
 *
 * Meant to run on a schedule (the same convention scripts/storage-
 * cleanup.ts already establishes for this codebase's other periodic
 * maintenance sweeps): each run enqueues ONE
 * model_execution_staleness_audit durable job (lib/jobs/queue.ts), idle-
 * proof and duplicate-run-proof via an hour-bucketed idempotency key, and
 * the codebase's standing production worker (scripts/worker.ts) claims
 * and processes it through lib/jobs/model-execution-staleness-
 * processor.ts, which calls runModelExecutionStalenessAudit() ->
 * staleExecutionSummary() for real and records one operational event
 * (lib/ai/staleness-alert.ts) summarizing whatever it finds. This script
 * is enqueue-only by design, exactly like app/api/household/export/
 * route.ts (Checkpoint 14i) -- it never runs the audit inline, so it
 * never blocks a cron invocation on the worker's own availability.
 *
 * Usage:
 *   node --import tsx scripts/model-execution-staleness-check.ts [--since-hours=24]
 */
import { pool } from "@/lib/db/client";
import { enqueueJob } from "@/lib/jobs/queue";
import { MODEL_EXECUTION_STALENESS_AUDIT_JOB_TYPE } from "@/lib/jobs/model-execution-staleness-processor";

function parseSinceHours(): number {
  const flag = process.argv.find((a) => a.startsWith("--since-hours="));
  if (!flag) return 24;
  const parsed = Number(flag.slice("--since-hours=".length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

async function main() {
  const sinceHours = parseSinceHours();
  // Hour-bucketed idempotency key: a cron invoked more than once within
  // the same hour enqueues the SAME job row (ON CONFLICT DO NOTHING,
  // see enqueueJob()'s own doc comment) instead of piling up duplicate
  // audits; the next hour gets a fresh key and a fresh audit.
  const hourBucket = new Date().toISOString().slice(0, 13);
  const { row, created } = await enqueueJob(pool, {
    jobType: MODEL_EXECUTION_STALENESS_AUDIT_JOB_TYPE,
    idempotencyKey: `model-execution-staleness:${hourBucket}`,
    payload: { sinceHours },
  });
  console.log(
    created
      ? `Enqueued model_execution_staleness_audit job ${row.id} (sinceHours=${sinceHours}). The production worker will claim and process it.`
      : `A model_execution_staleness_audit job for this hour already exists (${row.id}, status=${row.status}) -- not enqueuing a duplicate.`,
  );
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
