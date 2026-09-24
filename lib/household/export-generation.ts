/**
 * Checkpoint 14i (claude/v1-launch-hardening): the real, single
 * generation pipeline behind a household export -- extracted out of
 * app/api/household/export/route.ts, which used to run this ENTIRE body
 * synchronously inside the request/response cycle (the one call site
 * Checkpoint 14f's enqueue-only migration honestly left unmigrated; see
 * that route's own doc comment before this checkpoint and
 * background_job_reliability's own remaining-gap history).
 *
 * This is now the SAME shape as lib/rag/ingest.ts's processPolicy() /
 * lib/claims/evidence/pipeline.ts's processClaimEvidence(): one real
 * function that does the actual work, callable from anywhere (a request
 * handler, a worker, a regression suite) with nothing but plain
 * arguments -- no dependency on an in-flight HTTP request or its
 * cookies. lib/db/authz-client.ts's createUserSupabaseClient() needs
 * only a user id (it opens its own scoped Postgres transaction via `SET
 * ROLE`/`set_config('request.jwt.claim.sub', ...)`), which is exactly
 * why this is safe to call from a genuinely separate worker process that
 * has no user session of its own -- the same reasoning
 * lib/db/authz-client.ts's own doc comment already gives for treating
 * "background jobs" as one of createUserSupabaseClient()/
 * createServiceSupabaseClient()'s deliberate use cases.
 *
 * Never let a raw error (a driver message, a stack-trace-shaped string)
 * become the row's stored `error` -- unchanged from the route's own prior
 * behavior; this field is read back by the household on the status
 * endpoint, and this codebase's "no raw provider/database errors in a
 * client-facing field" convention (see
 * lib/auth/request-context.ts's routeErrorResponse() doc comment)
 * applies here just as much as it did inline.
 */
import { createHash } from "node:crypto";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { pool } from "@/lib/db/client";
import { buildHouseholdExportSnapshot } from "@/lib/household/export";
import {
  appendExportAudit,
  getExportRow,
  HOUSEHOLD_EXPORT_TTL_MS,
  markExportFailed,
  markExportReady,
  type HouseholdExportRow,
} from "@/lib/household/export-store";
import { saveHouseholdExportFile } from "@/lib/storage";

export interface GenerateHouseholdExportArgs {
  exportId: string;
  householdId: string;
  requestedBy: string;
}

/**
 * Runs the actual export generation for an already-`running` export
 * request row (the caller -- the route on the synchronous idempotent
 * fast path, or a worker pass on the durable path -- owns the
 * pending/failed -> running CAS transition; this function starts from
 * there). On success, returns the row now in its `ready` state.
 *
 * On a generation-time failure, this function ALWAYS records the
 * failure on the household_exports row itself first (status `failed`,
 * with only a safe, generic `error` message -- never a raw
 * provider/database error string, unchanged from the route's own prior
 * inline behavior), then RE-THROWS the original error (Defect D11 fix;
 * see the catch block below for why). Callers on the synchronous route
 * path already wrap this in their own try/catch and read the row back
 * regardless of outcome; the worker path
 * (lib/jobs/household-export-processor.ts's processHouseholdExportJob)
 * deliberately does not catch it, so the throw reaches
 * lib/jobs/worker-runtime.ts's claimAndProcessOne(), which classifies
 * and retries/dead-letters the background_jobs row the same way every
 * other job processor's failure does.
 */
export async function generateAndStoreHouseholdExport(
  args: GenerateHouseholdExportArgs,
): Promise<HouseholdExportRow | null> {
  try {
    // D35 (Wave 2 adversarial audit): REPEATABLE READ so this transaction's
    // several sequential SELECTs (buildHouseholdExportSnapshot) see one
    // consistent snapshot, even if a deletion is racing this export.
    const snapshot = await createUserSupabaseClient(
      args.requestedBy,
      (client) => buildHouseholdExportSnapshot(client, args.householdId),
      pool,
      { isolationLevel: "REPEATABLE READ" },
    );
    const json = JSON.stringify(snapshot, null, 2);
    const bytes = new TextEncoder().encode(json);
    const manifestHash = createHash("sha256").update(json).digest("hex");
    const storageKey = await saveHouseholdExportFile({ householdId: args.householdId, exportId: args.exportId, bytes });
    const expiresAt = new Date(Date.now() + HOUSEHOLD_EXPORT_TTL_MS);
    const ready = await markExportReady(pool, args.exportId, { storageKey, byteSize: bytes.byteLength, manifestHash, expiresAt });
    await appendExportAudit(pool, { householdId: args.householdId, exportId: args.exportId, actor: args.requestedBy, action: "generated" });
    return ready ?? (await getExportRow(pool, args.householdId, args.exportId));
  } catch (error) {
    const message = "Export generation failed. Please try again.";
    await markExportFailed(pool, args.exportId, message);
    await appendExportAudit(pool, {
      householdId: args.householdId,
      exportId: args.exportId,
      actor: args.requestedBy,
      action: "generation_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    // Defect D11 fix: re-throw after recording the row-level failure
    // above. This function used to swallow every generation-time error --
    // recording it on the household_exports row and returning normally --
    // which left the CALLER (lib/jobs/household-export-processor.ts's
    // processHouseholdExportJob, invoked by lib/jobs/worker-runtime.ts's
    // claimAndProcessOne()) with no way to know generation failed: with
    // nothing thrown, claimAndProcessOne() always ran completeJob(),
    // marking the background_jobs row "succeeded" even when the export
    // itself was left permanently stuck (e.g. if markExportFailed() above
    // could not run either, or -- the actually-observed production case --
    // could never reach `ready` because of a lower-level bug like a missing
    // RLS grant, see Defect D10). Re-throwing lets claimAndProcessOne()'s
    // existing generic catch block (classifyPipelineError() + failJob())
    // classify and retry/dead-letter this job exactly like every other
    // pipeline processor (lib/rag/ingest.ts's processPolicy(),
    // lib/claims/evidence/pipeline.ts's processClaimEvidence()) already
    // does, so a stuck/failed export becomes visible to job-level
    // monitoring instead of silently masquerading as a success. The
    // household_exports row itself still carries only the safe, generic
    // `message` above -- never the raw `error` -- unchanged from before.
    throw error;
  }
}
