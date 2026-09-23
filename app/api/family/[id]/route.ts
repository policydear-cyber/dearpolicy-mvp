import { NextResponse, type NextRequest } from "next/server";
import { isUuid, isValidDateString } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { activePredicate } from "@/lib/lifecycle/scopes";

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

// There is no UI or API path to undo an accidental "+ Add person" (a typo, a
// duplicate, a one-off test profile) once it's on the household list -- this
// closes that gap. Deletion is refused, rather than cascaded, whenever the
// profile has any real activity attached (an uploaded policy, chat history,
// a claim, a coverage rule, a premium record): silently cascading a delete
// through a family member's policy documents and claim history in a family
// insurance app is exactly the kind of data loss that must never be a single
// click, so those profiles are left for the person to explicitly clear out
// (remove the documents/history) before the profile itself can go.
class HasLinkedActivity extends Error {}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return NextResponse.json({ error: "Family member not found" }, { status: 404 });

    const deleted = await createUserSupabaseClient(ctx.userId, async (client) => {
      const owned = await client.query<{ id: string }>(
        `SELECT id FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
        [id, ctx.householdId],
      );
      if (!owned.rows.length) return false;
      const usage = await client.query<{ n: number }>(
        `SELECT (
            (SELECT count(*) FROM policies WHERE family_member_id=$1 AND ${activePredicate()})
          + (SELECT count(*) FROM policy_members WHERE family_member_id=$1)
          + (SELECT count(*) FROM chat_conversations WHERE family_member_id=$1)
          + (SELECT count(*) FROM claim_sessions WHERE family_member_id=$1)
          + (SELECT count(*) FROM coverage_rules WHERE family_member_id=$1)
          + (SELECT count(*) FROM premium_records WHERE family_member_id=$1)
         )::int AS n`,
        [id],
      );
      if ((usage.rows[0]?.n ?? 0) > 0) throw new HasLinkedActivity();
      await client.query(`DELETE FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`, [id, ctx.householdId]);
      return true;
    });
    if (!deleted) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof HasLinkedActivity) {
      return NextResponse.json(
        { error: "This profile has linked documents or activity, so it can't be deleted. Remove those first." },
        { status: 409 },
      );
    }
    return routeErrorResponse(error);
  }
}
