/**
 * Household export download (checkpoint 6): the one place this export's
 * actual content leaves the system. Requires a recently-authenticated
 * session (this is the real data-exposure moment, not the status poll)
 * plus owner authorization, streams the stored JSON directly (never a
 * signed URL -- see lib/storage/local.ts/supabase.ts's own comments on
 * the household-export domain), and records a `downloaded` audit event.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { requireRecentAuthentication } from "@/lib/auth/session";
import { requireHouseholdOwner } from "@/lib/household/repo";
import { pool } from "@/lib/db/client";
import { appendExportAudit, expireIfPast, getExportRow } from "@/lib/household/export-store";
import { deleteHouseholdExportFile, readHouseholdExportFile } from "@/lib/storage";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdContext(request);
    requireRecentAuthentication(ctx.user);
    await requireHouseholdOwner(ctx.userId, ctx.householdId);
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const row = await getExportRow(pool, ctx.householdId, id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const current = await expireIfPast(pool, row, deleteHouseholdExportFile);

    if (current.status === "expired") {
      return NextResponse.json({ error: "This export has expired. Request a new one." }, { status: 410 });
    }
    if (current.status !== "ready" || !current.storage_key) {
      return NextResponse.json({ error: "This export is not ready yet." }, { status: 409 });
    }

    const bytes = await readHouseholdExportFile(current.storage_key);
    await appendExportAudit(pool, { householdId: ctx.householdId, exportId: current.id, actor: ctx.userId, action: "downloaded" });

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="household-export-${current.id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
