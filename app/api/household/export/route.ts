/**
 * Household export (checkpoint 6). POST kicks off (or, idempotently,
 * re-fetches the state of) a household export; GET lists this
 * household's recent export requests. Both are owner-only (the spec's
 * "owner authorization where appropriate" -- exporting every record the
 * household holds is exactly that appropriate case) and require a
 * recently-authenticated session on the mutating path.
 *
 * Generation is synchronous within this request today: there is no
 * durable job framework yet (checkpoint 8's scope) to hand this off to.
 * That is still honest against the spec's "do not embed unbounded binary
 * data in a synchronous API response" -- this response is JSON metadata
 * (id/status/size/timestamps) only, never the export's own content; the
 * content is fetched separately, once, from [id]/download/route.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { requireRecentAuthentication } from "@/lib/auth/session";
import { requireHouseholdOwner } from "@/lib/household/repo";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { pool } from "@/lib/db/client";
import { buildHouseholdExportSnapshot } from "@/lib/household/export";
import {
  appendExportAudit,
  createOrGetExportRequest,
  getExportRow,
  HOUSEHOLD_EXPORT_TTL_MS,
  listRecentExports,
  markExportFailed,
  markExportReady,
  markExportRunning,
  type HouseholdExportRow,
} from "@/lib/household/export-store";
import { saveHouseholdExportFile } from "@/lib/storage";

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

    try {
      const snapshot = await createUserSupabaseClient(ctx.userId, (client) => buildHouseholdExportSnapshot(client, ctx.householdId));
      const json = JSON.stringify(snapshot, null, 2);
      const bytes = new TextEncoder().encode(json);
      const manifestHash = createHash("sha256").update(json).digest("hex");
      const storageKey = await saveHouseholdExportFile({ householdId: ctx.householdId, exportId: row.id, bytes });
      const expiresAt = new Date(Date.now() + HOUSEHOLD_EXPORT_TTL_MS);
      const ready = await markExportReady(pool, row.id, { storageKey, byteSize: bytes.byteLength, manifestHash, expiresAt });
      await appendExportAudit(pool, { householdId: ctx.householdId, exportId: row.id, actor: ctx.userId, action: "generated" });
      return NextResponse.json(toResponse(ready ?? running));
    } catch (error) {
      // Never let a raw error (a driver message, a stack-trace-shaped
      // string) become this row's stored `error` -- that field can be
      // read back by the household on the status endpoint, and this
      // codebase's own "no raw provider/database errors in a
      // client-facing field" convention (see
      // lib/auth/request-context.ts's routeErrorResponse() doc comment)
      // applies here just as much as to any other response body.
      const message = "Export generation failed. Please try again.";
      const failed = await markExportFailed(pool, row.id, message);
      await appendExportAudit(pool, {
        householdId: ctx.householdId,
        exportId: row.id,
        actor: ctx.userId,
        action: "generation_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(toResponse(failed ?? { ...running, status: "failed", error: message }), { status: 500 });
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    await requireHouseholdOwner(ctx.userId, ctx.householdId);
    const rows = await listRecentExports(pool, ctx.householdId);
    return NextResponse.json({ exports: rows.map(toResponse) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
