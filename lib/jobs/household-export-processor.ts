/**
 * Checkpoint 14i (claude/v1-launch-hardening): the household_export job
 * processor lives in its OWN small module, deliberately separate from
 * lib/jobs/processors.ts's policy/claim-evidence processors.
 *
 * lib/jobs/processors.ts imports processPolicy()/processClaimEvidence()
 * at its top level, which transitively pull in the PDF-parsing/OCR/AI-
 * extraction/Pinecone stack (lib/rag/ingest.ts's own import list) -- a
 * heavy import graph a household-export-only caller (a regression suite
 * that wants to exercise JUST the export worker path, without paying for
 * that whole stack's memory footprint) has no reason to load. Splitting
 * this out keeps scripts/worker.ts and lib/jobs/processors.ts's
 * PRODUCTION_JOB_TYPES wiring completely unchanged (processors.ts simply
 * re-exports this), while letting a lighter-weight caller import only
 * this file.
 */
import { generateAndStoreHouseholdExport, type GenerateHouseholdExportArgs } from "@/lib/household/export-generation";
import type { JobProcessor } from "./worker-runtime";

function requireStringField(payload: unknown, key: string): string {
  const value = (payload as Record<string, unknown> | null | undefined)?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`background job payload missing required string field "${key}"`);
  }
  return value;
}

/** Defect D11 fix: this processor does NOT catch -- a failed export
 * generation now IS a job-level failure that retries/dead-letters,
 * exactly like every other processor in this codebase
 * (lib/rag/ingest.ts's processPolicy(),
 * lib/claims/evidence/pipeline.ts's processClaimEvidence()).
 *
 * (Historical note, corrected: an earlier version of this comment argued
 * the opposite -- that generateAndStoreHouseholdExport() already owns
 * success/failure on the household_exports ROW, so re-throwing here
 * would be "confusing double bookkeeping". That reasoning assumed
 * markExportFailed() recording the row as `failed` was equivalent to the
 * background_jobs row being handled. It is not: with nothing thrown,
 * lib/jobs/worker-runtime.ts's claimAndProcessOne() always called
 * completeJob(), marking the background_jobs row "succeeded" even when
 * generation genuinely failed -- silently masking the failure from every
 * job-level monitoring/alerting/retry path, with no reaper for the
 * household_exports row either if it also never reached `failed` (e.g.
 * because the same failure that broke generation also broke the recovery
 * write -- see Defect D10). generateAndStoreHouseholdExport() now
 * re-throws after recording the row-level failure, so this processor's
 * own throw -- propagating, uncaught, exactly like it always has for a
 * genuinely unexpected error -- lets claimAndProcessOne()'s existing
 * classifyPipelineError()+failJob() do the same retry/dead-letter
 * bookkeeping this job type gets for free, no different from any other
 * job type.) */
export const processHouseholdExportJob: JobProcessor = async (job) => {
  const payload = job.payload as Record<string, unknown> | null;
  const args: GenerateHouseholdExportArgs = {
    exportId: requireStringField(payload, "exportId"),
    householdId: requireStringField(payload, "householdId"),
    requestedBy: requireStringField(payload, "requestedBy"),
  };
  await generateAndStoreHouseholdExport(args);
};
