import { NextResponse, type NextRequest } from "next/server";
import { isUuid, isValidDateString } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import {
  DeletionValidationError,
  HasLinkedActivityError,
  finishFamilyMemberDeletion,
  requestFamilyMemberDeletion,
} from "@/lib/lifecycle/coordinator";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

class SelfProfileConflict extends Error {}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { displayName?: string; relationship?: string; dateOfBirth?: string | null; preferredName?: string | null; notes?: string | null };
    if (!body.displayName?.trim() || !body.relationship?.trim()) return NextResponse.json({ error: "Full name and relationship are required" }, { status: 400 });
    if (body.displayName.trim().length > 200) return NextResponse.json({ error: "That name is too long." }, { status: 400 });
    if (body.relationship.trim().length > 100) return NextResponse.json({ error: "That relationship is too long." }, { status: 400 });
    if (body.preferredName && body.preferredName.trim().length > 100) return NextResponse.json({ error: "That preferred name is too long." }, { status: 400 });
    if (body.notes && body.notes.trim().length > 2000) return NextResponse.json({ error: "That note is too long." }, { status: 400 });
    if (body.dateOfBirth && !isValidDateString(body.dateOfBirth)) return NextResponse.json({ error: "That date of birth isn't valid." }, { status: 400 });

    const member = await createUserSupabaseClient(ctx.userId, async (client) => {
      if (body.relationship!.trim().toLowerCase() === "self") {
        const existingSelf = await client.query<{ id: string }>(
          `SELECT id FROM family_members WHERE account_id=$1 AND relationship='self' AND id<>$2 AND ${activePredicate()}`,
          [ctx.householdId, id],
        );
        if (existingSelf.rows.length) throw new SelfProfileConflict();
      }
      const result = await client.query(
        `UPDATE family_members
            SET display_name=$1,relationship=$2,date_of_birth=$3,preferred_name=$4,notes=$5,updated_at=now()
          WHERE id=$6 AND account_id=$7
          RETURNING id,display_name,relationship,date_of_birth::text,preferred_name,notes`,
        [body.displayName!.trim(), body.relationship!.trim(), body.dateOfBirth || null, body.preferredName?.trim() || null, body.notes?.trim() || null, id, ctx.householdId],
      );
      return result.rows[0] ?? null;
    });
    if (!member) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    return NextResponse.json({ member });
  } catch (error) {
    if (error instanceof SelfProfileConflict) {
      return NextResponse.json(
        { error: "This household already has a profile marked \"self\". Use a different relationship for this person." },
        { status: 409 },
      );
    }
    return routeErrorResponse(error);
  }
}

/** D15 (Wave 2 adversarial audit): family-member deletion now goes through
 * the shared lifecycle coordinator (lib/lifecycle/coordinator.ts) instead
 * of an inline hard DELETE -- idempotency, deletion-audit-log recording,
 * and the "reject when linked activity exists" check are all centralized
 * there (HasLinkedActivityError), rather than duplicated per route. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    const idempotencyKey = request.headers.get("idempotency-key") || `delete:${id}`;
    const outcome = await createUserSupabaseClient(ctx.userId, async (client) => {
      try {
        return await requestFamilyMemberDeletion({ client, accountId: ctx.householdId, actorUserId: ctx.userId, familyMemberId: id, reasonCategory: "user_requested", idempotencyKey });
      } catch (error) {
        if (error instanceof DeletionValidationError) return null;
        throw error;
      }
    });
    if (!outcome) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    if (outcome.status === "accepted") {
      await finishFamilyMemberDeletion({ accountId: ctx.householdId, actorUserId: ctx.userId, familyMemberId: id, deletionRequestId: outcome.deletionRequestId });
    }
    return NextResponse.json({ ok: true, deletionRequestId: outcome.deletionRequestId, status: outcome.status === "accepted" ? "completed" : outcome.status });
  } catch (error) {
    if (error instanceof HasLinkedActivityError) {
      return NextResponse.json(
        { error: "This profile has linked documents or activity, so it can't be deleted. Remove those first." },
        { status: 409 },
      );
    }
    return routeErrorResponse(error);
  }
}
