/**
 * Household export status (checkpoint 6): poll a single export request's
 * state. Read-only, non-sensitive (status/size/timestamps only, never
 * content), so this does not require a recently-authenticated session --
 * only the download endpoint (the actual data-exposure moment) does.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { requireHouseholdOwner } from "@/lib/household/repo";
import { pool } from "@/lib/db/client";
import { expireIfPast, getExportRow } from "@/lib/household/export-store";
import { deleteHouseholdExportFile } from "@/lib/storage";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdContext(request);
    await requireHouseholdOwner(ctx.userId, ctx.householdId);
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const row = await getExportRow(pool, ctx.householdId, id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const current = await expireIfPast(pool, row, deleteHouseholdExportFile);

    return NextResponse.json({
      id: current.id,
      status: current.status,
      schemaVersion: current.schema_version,
      byteSize: current.byte_size,
      requestedAt: current.requested_at,
      completedAt: current.completed_at,
      expiresAt: current.expires_at,
      error: current.status === "failed" ? current.error : null,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
