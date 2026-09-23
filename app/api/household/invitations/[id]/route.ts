import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { revokeInvitation } from "@/lib/household/repo";
import { isUuid } from "@/lib/db/client";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

/** Owner-only: revoke a still-pending invitation. revokeInvitation() scopes
 * its UPDATE by id alone, under RLS's household_invitations_update policy
 * (is_household_owner(household_id) READ FROM THE ROW ITSELF) -- so a
 * caller cannot revoke an invitation belonging to a household they don't
 * own even by guessing a valid invitation id from another household. */
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
    await revokeInvitation(ctx.userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
