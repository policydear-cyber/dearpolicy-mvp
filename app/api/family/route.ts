import { NextResponse, type NextRequest } from "next/server";
import { isValidDateString } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { hasSexColumn, parseSex } from "@/lib/household/member-profile";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

type FamilyRow = { id: string; display_name: string; relationship: string; date_of_birth: string | null; preferred_name: string | null; notes: string | null; sex: string | null; policy_count: number };

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const { result, sexField } = await createUserSupabaseClient(ctx.userId, async (client) => ({ sexField: await hasSexColumn(client), result: await
      client.query<FamilyRow>(
        // sex through to_jsonb: the column exists only once sql/member-profile.sql is applied (null before).
        `SELECT f.id, f.display_name, f.relationship, f.date_of_birth::text, f.preferred_name, f.notes, to_jsonb(f)->>'sex' AS sex,
                count(DISTINCT p.id)::int AS policy_count
           FROM family_members f
           LEFT JOIN policy_members pm ON pm.family_member_id=f.id AND pm.account_id=f.account_id
           -- Only documents Documents still lists (GET /api/policies): one deleted or replaced is not "linked".
           LEFT JOIN policies p ON p.id=pm.policy_id AND p.account_id=f.account_id AND p.superseded_at IS NULL AND ${activePredicate("p")}
          WHERE f.account_id=$1 AND ${activePredicate("f")}
          GROUP BY f.id
          ORDER BY CASE WHEN f.relationship='self' THEN 0 ELSE 1 END, f.created_at`,
        [ctx.householdId],
      ) }),
    );
    // sexField: whether a sex can be saved yet, so the Family page asks for it only then.
    return NextResponse.json({ family: result.rows, profile: { sexField } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const body = (await request.json().catch(() => ({}))) as { displayName?: string; relationship?: string; dateOfBirth?: string | null; preferredName?: string | null; sex?: unknown };
    const sex = parseSex(body.sex);
    if (sex === "invalid") return NextResponse.json({ error: "Choose female, male or prefer not to say." }, { status: 400 });
    if (!body.displayName?.trim() || !body.relationship?.trim()) {
      return NextResponse.json({ error: "Full name and relationship are required" }, { status: 400 });
    }
    if (body.displayName.trim().length > 200) return NextResponse.json({ error: "That name is too long." }, { status: 400 });
    if (body.relationship.trim().length > 100) return NextResponse.json({ error: "That relationship is too long." }, { status: 400 });
    if (body.preferredName && body.preferredName.trim().length > 100) return NextResponse.json({ error: "That preferred name is too long." }, { status: 400 });
    if (body.dateOfBirth && !isValidDateString(body.dateOfBirth)) return NextResponse.json({ error: "That date of birth isn't valid." }, { status: 400 });
    // A year before 1900 is a typo ("1917" for "2017"), never a living member (Critic on #527).
    if (body.dateOfBirth && body.dateOfBirth < "1900-01-01") return NextResponse.json({ error: "Check the year of that date of birth." }, { status: 400 });
    // Round 5: a date of birth cannot be in the future (compared as calendar
    // dates; a day of slack keeps every time zone's "today" valid).
    if (body.dateOfBirth && body.dateOfBirth > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) return NextResponse.json({ error: "A date of birth can't be in the future." }, { status: 400 });

    const member = await createUserSupabaseClient(ctx.userId, async (client) => {
      if (body.relationship!.trim().toLowerCase() === "self") {
        // "self" means the household member DearPolicy is speaking for; a
        // second one has no meaning here and would just confuse whichever
        // fallback in the app picks "the self profile" (the upload default,
        // portfolio ordering) into silently choosing one over the other.
        const existingSelf = await client.query<{ id: string }>(
          `SELECT id FROM family_members WHERE account_id=$1 AND relationship='self' AND ${activePredicate()}`,
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
      const row = result.rows[0] as Record<string, unknown>;
      // Before sql/member-profile.sql is applied there is nowhere to keep it: the person is still added, without it.
      if (sex !== undefined && row && await hasSexColumn(client)) {
        await client.query(`UPDATE family_members SET sex=$1 WHERE id=$2 AND account_id=$3`, [sex, row.id, ctx.householdId]);
        row.sex = sex;
      }
      return row;
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
