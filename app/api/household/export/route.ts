/**
 * Household export (checkpoint 6; enqueue-only since checkpoint 14i).
 * POST kicks off (or, idempotently, re-fetches the state of) a household
 * export; GET lists this household's recent export requests. Both are
 * owner-only (the spec's "owner authorization where appropriate" --
 * exporting every record the household holds is exactly that appropriate
 * case) and require a recently-authenticated session on the mutating
 * path.
 *
 * Checkpoint 14i (claude/v1-launch-hardening): generation used to run
 * synchronously inside this request -- the one real, honestly-documented
 * gap Checkpoint 14f's enqueue-only migration of policy/claim-evidence
 * processing left unmigrated (see scripts/launch-check.ts's
 * background_job_reliability history). This route now does exactly what
 * lib/rag/processing-queue.ts and lib/claims/evidence/queue.ts already
 * do: transition the row to `running` (CAS-guarded, unchanged) and
 * enqueue the real work via lib/household/export-queue.ts's
 * enqueueHouseholdExport() -- never calling
 * lib/household/export-generation.ts's generateAndStoreHouseholdExport()
 * itself. A genuinely separate worker pass (scripts/worker.ts, via
 * lib/jobs/processors.ts's processHouseholdExportJob) claims and runs
 * it. This response is still JSON metadata (id/status/size/timestamps)
 * only, never the export's own content -- unchanged from before; the
 * content is fetched separately, once, from [id]/download/route.ts, and
 * a caller polls GET/this same idempotent POST for `ready`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { scheduleRequestDrain } from "@/lib/jobs/request-drain";
import { requireRecentAuthentication } from "@/lib/auth/session";
import { requireHouseholdOwner } from "@/lib/household/repo";
import { pool } from "@/lib/db/client";
import {
  appendExportAudit,
  createOrGetExportRequest,
  getExportRow,
  listRecentExports,
  markExportRunning,
  type HouseholdExportRow,
} from "@/lib/household/export-store";
import { enqueueHouseholdExport } from "@/lib/household/export-queue";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

function toResponse(row: HouseholdExportRow) {
  return {
    id: row.id,
    status: row.status,
    schemaVersion: row.schema_version,
    byteSize: row.byte_size,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    error: row.status === "failed" ? row.error : null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    scheduleRequestDrain(); // bounded job drain after the response (lib/jobs/request-drain.ts)
    requireRecentAuthentication(ctx.user);
    await requireHouseholdOwner(ctx.userId, ctx.householdId);

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return NextResponse.json({ error: "An Idempotency-Key header (1-200 characters) is required." }, { status: 400 });
    }

    const { row, isNew } = await createOrGetExportRequest(pool, {
      householdId: ctx.householdId,
      requestedBy: ctx.userId,
      idempotencyKey,
    });
    if (isNew) {
      await appendExportAudit(pool, { householdId: ctx.householdId, exportId: row.id, actor: ctx.userId, action: "requested" });
    }

    if (row.status !== "pending" && row.status !== "failed") {
      // Already running, ready, or expired under this exact idempotency
      // key -- return its current state rather than generating again.
      return NextResponse.json(toResponse(row));
    }

    const running = await markExportRunning(pool, row.id);
    if (!running) {
      // Lost a race against another request using the same idempotency
      // key -- read back whatever state it left, rather than retrying.
      const fresh = await getExportRow(pool, ctx.householdId, row.id);
      return NextResponse.json(toResponse(fresh ?? row));
    }

    // Enqueue-only from here -- see this file's own doc comment. A
    // genuinely separate worker pass claims and runs the real
    // generation; this request never calls
    // generateAndStoreHouseholdExport() itself, and returns `running`
    // promptly rather than blocking on it.
    await enqueueHouseholdExport({ exportId: row.id, householdId: ctx.householdId, requestedBy: ctx.userId });
    return NextResponse.json(toResponse(running));
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    scheduleRequestDrain(); // bounded job drain after the response (lib/jobs/request-drain.ts)
    await requireHouseholdOwner(ctx.userId, ctx.householdId);
    const rows = await listRecentExports(pool, ctx.householdId);
    return NextResponse.json({ exports: rows.map(toResponse) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
