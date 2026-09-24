/**
 * Checkpoint 14i (claude/v1-launch-hardening): the real caller
 * lib/ai/staleness.ts's staleExecutionSummary() was genuinely missing.
 *
 * staleExecutionSummary()'s own doc comment is explicit about what it can
 * and cannot do: model_executions' household_ref/resource_ref are
 * pseudonymized by design (Checkpoint 9's keyed HMAC) and cannot be
 * reversed back to a real policy_benefits/claim_evidence row from here --
 * so this module does not, and architecturally cannot, re-run extraction
 * against a specific real document. What it CAN do, and previously did
 * not, is turn "an operator can see the count if they think to query it"
 * into "this gets computed on a real schedule and surfaces through the
 * same observability boundary every other operational sweep in this
 * codebase uses" -- exactly the role lib/storage/cleanup.ts's own
 * recordEvent("storage.cleanup.executed", ...) call plays for storage
 * orphans, which this deliberately mirrors (see runModelExecutionStalenessAudit()
 * below and its "storage.cleanup.executed"-shaped event). A non-empty
 * result is the actionable signal a human operator needs to go trigger
 * real re-processing at the ACTUAL call site that still holds the real
 * id (lib/claims/evidence/pipeline.ts today, since claim_evidence_extraction
 * is the only tracked operation in staleness.ts's CURRENT_SCHEMA_VERSION).
 */
import { recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { staleExecutionSummary } from "./staleness";

export type ModelExecutionStalenessAuditResult = Awaited<ReturnType<typeof staleExecutionSummary>>;

/** Runs staleExecutionSummary() for real and records ONE operational event
 * summarizing the result -- called by scripts/model-execution-staleness-
 * check.ts (an operator/cron-run CLI, the same convention as scripts/
 * storage-cleanup.ts) and by lib/jobs/model-execution-staleness-
 * processor.ts's durable job processor, so this worklist is reachable
 * both as an ad hoc CLI check and as a scheduled durable job through the
 * exact same production worker infrastructure (lib/jobs/worker-runtime.ts)
 * every other job type in this codebase already relies on. */
export async function runModelExecutionStalenessAudit(sinceHours = 24): Promise<ModelExecutionStalenessAuditResult> {
  const summary = await staleExecutionSummary(sinceHours);
  const totalStale = summary.reduce((sum, row) => sum + row.staleCount, 0);
  void recordEvent({
    name: "ai.model_execution.staleness_audit_executed",
    correlationId: resolveCorrelationId(undefined),
    status: totalStale > 0 ? "failure" : "success",
    errorCategory: totalStale > 0 ? "model_provider" : null,
    processingState: `sinceHours=${sinceHours}`,
    extra: {
      staleGroupCount: summary.length,
      totalStaleExecutions: totalStale,
      operations: summary.map((row) => ({ operation: row.operation, schemaVersion: row.schemaVersion, staleCount: row.staleCount })),
    },
  });
  return summary;
}
