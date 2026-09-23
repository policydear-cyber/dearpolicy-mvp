import { NextResponse } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { removeMember, setMemberRole, type Role } from "@/lib/household/repo";
import { isUuid } from "@/lib/db/client";

export const runtime = "nodejs";
// "household-member" rather than "household-owner": removeMember() also
// covers a member removing THEMSELVES (leaving), which is not an
// owner-only action. Owner-only enforcement for changing someone ELSE's
// membership is done by RLS itself (household_members_update/delete's
// is_household_owner() policy), not by this route's classification.
export const ROUTE_AUTH = "household-member" as const;

function isRole(value: unknown): value is Role {
  return value === "owner" || value === "member";
}

/** Owner-only: change a member's role. RLS enforces both the owner
 * requirement and "never demote the last owner" is enforced by
 * setMemberRole() itself (see lib/household/repo.ts). */
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireHouseholdContext();
    const { userId: targetUserId } = await params;
    if (!isUuid(targetUserId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (!isRole(body.role)) {
      return NextResponse.json({ error: "role must be \"owner\" or \"member\"." }, { status: 400 });
    }
    await setMemberRole(ctx.userId, ctx.householdId, targetUserId, body.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Removes a member from the household -- either the owner removing
 * someone else, or a member removing themselves ("leave"). Both cases are
 * the same operation from the database's point of view (a DELETE), and
 * RLS/removeMember() distinguish who's allowed to do which; the route
 * doesn't need to know which case it is. Refuses to remove the household's
 * last remaining owner (see removeMember()'s ConflictError). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireHouseholdContext();
    const { userId: targetUserId } = await params;
    if (!isUuid(targetUserId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await removeMember(ctx.userId, ctx.householdId, targetUserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
