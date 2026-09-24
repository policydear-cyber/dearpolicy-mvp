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

/** Checkpoint 14i: unlike the policy/claim-evidence processors, a failed
 * export generation is NOT a job-level failure that should retry/dead-
 * letter -- generateAndStoreHouseholdExport() already owns its own
 * success/failure outcome on the household_exports ROW
 * (markExportReady/markExportFailed), exactly as it did when the route
 * called it inline. Re-throwing here would make lib/jobs/queue.ts's
 * failJob() ALSO retry/dead-letter the background_jobs row for a
 * household_exports row that is already terminally `failed` -- a
 * confusing double bookkeeping this job type does not need. */
export const processHouseholdExportJob: JobProcessor = async (job) => {
  const payload = job.payload as Record<string, unknown> | null;
  const args: GenerateHouseholdExportArgs = {
    exportId: requireStringField(payload, "exportId"),
    householdId: requireStringField(payload, "householdId"),
    requestedBy: requireStringField(payload, "requestedBy"),
  };
  await generateAndStoreHouseholdExport(args);
};
