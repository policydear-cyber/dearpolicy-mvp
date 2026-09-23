import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { setMemberRole, type Role } from "@/lib/household/repo";
import { requestHouseholdLeave, requestHouseholdMemberRemoval } from "@/lib/lifecycle/coordinator";
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
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireHouseholdContext(request);
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
 * only needs to know which case it is to pick the right deletion-request
 * resource type (household_member vs household_leave, Checkpoint 7 --
 * see lib/lifecycle/coordinator.ts's requestHouseholdMemberRemoval/
 * requestHouseholdLeave, both of which call removeMember() itself, so
 * the last-remaining-owner refusal (removeMember()'s ConflictError) and
 * every other pre-existing behavior of this route is unchanged. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireHouseholdContext(request);
    const { userId: targetUserId } = await params;
    if (!isUuid(targetUserId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const idempotencyKey = request.headers.get("idempotency-key") || `delete:${targetUserId}`;
    if (ctx.userId === targetUserId) {
      await requestHouseholdLeave({ accountId: ctx.householdId, callerUserId: ctx.userId, targetUserId, idempotencyKey });
    } else {
      await requestHouseholdMemberRemoval({ accountId: ctx.householdId, callerUserId: ctx.userId, targetUserId, idempotencyKey });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
