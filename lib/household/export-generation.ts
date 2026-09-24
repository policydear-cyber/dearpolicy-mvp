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
 * there). Returns the row's final state either way (`ready` or
 * `failed`), never throws for a generation-time failure (that failure is
 * recorded on the row itself, exactly as the route used to do it
 * inline).
 */
export async function generateAndStoreHouseholdExport(
  args: GenerateHouseholdExportArgs,
): Promise<HouseholdExportRow | null> {
  try {
    const snapshot = await createUserSupabaseClient(args.requestedBy, (client) =>
      buildHouseholdExportSnapshot(client, args.householdId),
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
    const failed = await markExportFailed(pool, args.exportId, message);
    await appendExportAudit(pool, {
      householdId: args.householdId,
      exportId: args.exportId,
      actor: args.requestedBy,
      action: "generation_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    return failed ?? (await getExportRow(pool, args.householdId, args.exportId));
  }
}
