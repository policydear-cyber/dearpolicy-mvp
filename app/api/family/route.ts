import { NextResponse, type NextRequest } from "next/server";
import { isValidDateString } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

type FamilyRow = { id: string; display_name: string; relationship: string; date_of_birth: string | null; preferred_name: string | null; notes: string | null; policy_count: number };

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const result = await createUserSupabaseClient(ctx.userId, (client) =>
      client.query<FamilyRow>(
        `SELECT f.id, f.display_name, f.relationship, f.date_of_birth::text, f.preferred_name, f.notes,
                count(DISTINCT pm.policy_id)::int AS policy_count
           FROM family_members f
           LEFT JOIN policy_members pm ON pm.family_member_id=f.id AND pm.account_id=f.account_id
          WHERE f.account_id=$1
          GROUP BY f.id
          ORDER BY CASE WHEN f.relationship='self' THEN 0 ELSE 1 END, f.created_at`,
        [ctx.householdId],
      ),
    );
    return NextResponse.json({ family: result.rows });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const body = (await request.json().catch(() => ({}))) as { displayName?: string; relationship?: string; dateOfBirth?: string | null; preferredName?: string | null };
    if (!body.displayName?.trim() || !body.relationship?.trim()) {
      return NextResponse.json({ error: "Full name and relationship are required" }, { status: 400 });
    }
    if (body.displayName.trim().length > 200) return NextResponse.json({ error: "That name is too long." }, { status: 400 });
    if (body.relationship.trim().length > 100) return NextResponse.json({ error: "That relationship is too long." }, { status: 400 });
    if (body.preferredName && body.preferredName.trim().length > 100) return NextResponse.json({ error: "That preferred name is too long." }, { status: 400 });
    if (body.dateOfBirth && !isValidDateString(body.dateOfBirth)) return NextResponse.json({ error: "That date of birth isn't valid." }, { status: 400 });

    const member = await createUserSupabaseClient(ctx.userId, async (client) => {
      if (body.relationship!.trim().toLowerCase() === "self") {
        // "self" means the household member DearPolicy is speaking for; a
        // second one has no meaning here and would just confuse whichever
        // fallback in the app picks "the self profile" (the upload default,
        // portfolio ordering) into silently choosing one over the other.
        const existingSelf = await client.query<{ id: string }>(
          `SELECT id FROM family_members WHERE account_id=$1 AND relationship='self'`,
          [ctx.householdId],
        );
        if (existingSelf.rows.length) {
          throw new SelfProfileConflict();
        }
      }
      const result = await client.query(
        `INSERT INTO family_members(account_id,display_name,relationship,date_of_birth,preferred_name)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id,display_name,relationship,date_of_birth::text,preferred_name`,
        [ctx.householdId, body.displayName!.trim(), body.relationship!.trim(), body.dateOfBirth || null, body.preferredName?.trim() || null],
      );
      return result.rows[0];
    });
    return NextResponse.json({ member }, { status: 201 });
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

// A narrow, local control-flow signal -- thrown inside the
// createUserSupabaseClient() callback so the duplicate-"self"-profile check
// aborts the transaction (no partial insert), then mapped to its 409 in the
// outer catch. Not part of lib/household/repo.ts's error taxonomy since
// this is a family-members-table-specific business rule, not an
// authorization outcome.
class SelfProfileConflict extends Error {}
