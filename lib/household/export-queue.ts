/**
 * Checkpoint 14i (claude/v1-launch-hardening): enqueue-only, no inline
 * processing -- the export-generation counterpart to Checkpoint 14f's
 * lib/rag/processing-queue.ts / lib/claims/evidence/queue.ts.
 *
 * app/api/household/export/route.ts used to call
 * lib/household/export.ts's buildHouseholdExportSnapshot() (and then
 * save/hash/markExportReady) directly inside the POST request/response
 * cycle -- the one real, honestly-documented remaining gap Checkpoint
 * 14f's enqueue-only migration left unfixed (see that route's own doc
 * comment before this checkpoint). This does exactly what the other two
 * producers do: persist an idempotency-keyed background_jobs row (via
 * lib/jobs/queue.ts's enqueueJob(), the same primitive reused directly,
 * not reimplemented) and return. Idempotent on the SAME export id (a
 * retried/duplicate worker claim can never double-run generation --
 * enqueueJob()'s ON CONFLICT DO NOTHING + re-read).
 *
 * lib/jobs/processors.ts's processHouseholdExportJob decodes this
 * payload back into GenerateHouseholdExportArgs and calls the real
 * pipeline function, lib/household/export-generation.ts's
 * generateAndStoreHouseholdExport() -- the exact same function the
 * route itself used to call inline, never a reimplementation.
 */
import { enqueueJob } from "@/lib/jobs/queue";
import { pool } from "@/lib/db/client";
import type { GenerateHouseholdExportArgs } from "@/lib/household/export-generation";

export const HOUSEHOLD_EXPORT_JOB_TYPE = "household_export";

export async function enqueueHouseholdExport(args: GenerateHouseholdExportArgs): Promise<void> {
  await enqueueJob(pool, {
    jobType: HOUSEHOLD_EXPORT_JOB_TYPE,
    idempotencyKey: args.exportId,
    accountId: args.householdId,
    payload: {
      exportId: args.exportId,
      householdId: args.householdId,
      requestedBy: args.requestedBy,
    },
  });
}
