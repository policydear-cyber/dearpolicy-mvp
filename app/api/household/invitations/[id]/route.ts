import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { isUuid } from "@/lib/db/client";
import { DeletionValidationError, requestInvitationRevocation } from "@/lib/lifecycle/coordinator";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

/** Owner-only: revoke a still-pending invitation. Checkpoint 7's
 * requestInvitationRevocation() wraps lib/household/repo.ts's
 * revokeInvitation() with deletion_requests idempotency and an audit
 * trail; revokeInvitation() itself still scopes its UPDATE by id alone,
 * under RLS's household_invitations_update policy (is_household_owner
 * (household_id) READ FROM THE ROW ITSELF) -- so a caller cannot revoke
 * an invitation belonging to a household they don't own even by
 * guessing a valid invitation id from another household. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdContext(request);
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // The actual authorization decision (does this invitation belong to a
    // household this caller owns?) is made by RLS at the row level inside
    // revokeInvitation() -- keyed off the caller's user id, not the active
    // household id, so this also correctly rejects revoking an invitation
    // that belongs to a DIFFERENT household the caller owns while acting
    // under this one (there is no legitimate reason to allow that either).
    const idempotencyKey = request.headers.get("idempotency-key") || `revoke:${id}`;
    await requestInvitationRevocation({ callerUserId: ctx.userId, invitationId: id, idempotencyKey });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Fixed alongside Flow 8: DeletionValidationError (thrown when the id
    // is well-formed but no such invitation exists) has no mapping in the
    // shared routeErrorResponse() -- every other coordinator caller that
    // can hit this error catches it explicitly (see app/api/family/[id]/
    // route.ts's DELETE handler for the established convention) rather
    // than letting it fall through to routeErrorResponse()'s generic 500.
    // This route was missing that catch since Flow 7 shipped; without it,
    // a nonexistent invitation id returned an unwarranted 500 instead of
    // 404.
    if (error instanceof DeletionValidationError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return routeErrorResponse(error);
  }
}
