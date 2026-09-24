import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { isUuid } from "@/lib/db/client";
import { DeletionValidationError, requestInvitationRevocation } from "@/lib/lifecycle/coordinator";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

/** D15 (Wave 2 adversarial audit): revocation now goes through the shared
 * lifecycle coordinator (idempotency + deletion-audit-log recording)
 * instead of calling revokeInvitation() directly. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdContext(request);
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const idempotencyKey = request.headers.get("idempotency-key") || `delete:${id}`;
    const outcome = await requestInvitationRevocation({ callerUserId: ctx.userId, invitationId: id, idempotencyKey });
    return NextResponse.json({ ok: true, deletionRequestId: outcome.deletionRequestId, status: outcome.status });
  } catch (error) {
    if (error instanceof DeletionValidationError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return routeErrorResponse(error);
  }
}
