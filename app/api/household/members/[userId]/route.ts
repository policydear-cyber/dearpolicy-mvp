import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, requireHouseholdOwnerContext, routeErrorResponse } from "@/lib/auth/request-context";
import { requireRecentAuthentication } from "@/lib/auth/session";
import { listHouseholdMembers, removeMember, setMemberRole, type Role } from "@/lib/household/repo";
import { requestHouseholdLeave, requestHouseholdMemberRemoval } from "@/lib/lifecycle/coordinator";
import { isUuid } from "@/lib/db/client";

export const runtime = "nodejs";
// "household-member" rather than "household-owner": DELETE also covers a
// member removing THEMSELVES (leaving), which is not an owner-only action.
// Removing someone else and transferring ownership (PATCH) require the
// owner (requireHouseholdOwnerContext), and RLS
// (household_members_update/delete's is_household_owner() policy) enforces
// the same underneath.
export const ROUTE_AUTH = "household-member" as const;

function isRole(value: unknown): value is Role {
  return value === "owner" || value === "member";
}

/** Owner-only: { role: "owner" } transfers ownership to this member (the
 * caller becomes a member in the same transaction; a household has exactly
 * one owner). The owner can't simply step down: { role: "member" } on the
 * owner is refused with "Transfer ownership instead". See
 * lib/household/repo.ts transferOwnership(). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireHouseholdOwnerContext(request);
    const { userId: targetUserId } = await params;
    if (!isUuid(targetUserId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (!isRole(body.role)) {
      return NextResponse.json({ error: "role must be \"owner\" or \"member\"." }, { status: 400 });
    }
    // Handing over the household gives away delete and export, and the old owner can't take it back: like deleting
    // the household, it needs a recently confirmed sign-in (Critic #538 MED1).
    if (body.role === "owner") requireRecentAuthentication(ctx.user);
    await setMemberRole(ctx.userId, ctx.householdId, targetUserId, body.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Removes a member from the household -- either the owner removing
 * someone else, or a member removing themselves ("leave"). D15 (Wave 2
 * adversarial audit): both now go through the shared lifecycle
 * coordinator (idempotency + deletion-audit-log recording), which still
 * calls removeMember() (lib/household/repo.ts) underneath, so the
 * existing RLS/last-owner protections are unchanged. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId: targetUserId } = await params;
    if (!isUuid(targetUserId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const self = await requireHouseholdContext(request);
    // Leaving is open to every member; removing anyone else is the owner's.
    const ctx = self.userId === targetUserId ? self : await requireHouseholdOwnerContext(request);
    // The default key names this membership, not just the person: someone who leaves, is invited back and leaves again
    // is a new removal, never answered with the old one's "completed" (Test engineer #538 G1).
    const joinedAt = (await listHouseholdMembers(ctx.userId, ctx.householdId)).find((m) => m.userId === targetUserId)?.createdAt;
    const idempotencyKey = request.headers.get("idempotency-key") || `delete:${targetUserId}:${joinedAt ? new Date(joinedAt).toISOString() : "none"}`;
    const outcome =
      ctx.userId === targetUserId
        ? await requestHouseholdLeave({ accountId: ctx.householdId, callerUserId: ctx.userId, targetUserId, idempotencyKey })
        : await requestHouseholdMemberRemoval({ accountId: ctx.householdId, callerUserId: ctx.userId, targetUserId, idempotencyKey });
    return NextResponse.json({ ok: true, deletionRequestId: outcome.deletionRequestId, status: outcome.status });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
