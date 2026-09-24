/**
 * Checkpoint 14i (claude/v1-launch-hardening): durable-job wrapper around
 * lib/ai/staleness-alert.ts's runModelExecutionStalenessAudit(), in its
 * own small module for the same reason lib/jobs/household-export-
 * processor.ts is split out -- keeps this job type's import graph light
 * (no PDF/OCR/Pinecone stack) for callers that only want this one path.
 *
 * This job type is enqueued by scripts/model-execution-staleness-
 * check.ts (an operator/cron-run CLI, mirroring scripts/storage-
 * cleanup.ts's own convention) and processed by the SAME production
 * worker loop (scripts/worker.ts, via lib/jobs/worker-runtime.ts) every
 * other registered job type already runs through -- retries/dead-letter
 * semantics apply here exactly as they do to every other job type.
 */
import { runModelExecutionStalenessAudit } from "@/lib/ai/staleness-alert";
import type { JobProcessor } from "./worker-runtime";

export const MODEL_EXECUTION_STALENESS_AUDIT_JOB_TYPE = "model_execution_staleness_audit";

function optionalNumberField(payload: unknown, key: string): number | undefined {
  const value = (payload as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export const processModelExecutionStalenessAuditJob: JobProcessor = async (job) => {
  const sinceHours = optionalNumberField(job.payload, "sinceHours") ?? 24;
  await runModelExecutionStalenessAudit(sinceHours);
};
