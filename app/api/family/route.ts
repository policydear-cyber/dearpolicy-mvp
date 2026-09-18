import { NextResponse } from "next/server";
import { devAccountId, isValidDateString, query } from "@/lib/db/client";

export const runtime = "nodejs";

type FamilyRow = { id: string; display_name: string; relationship: string; date_of_birth: string | null; preferred_name: string | null; notes: string | null; policy_count: number };

export async function GET() {
  try {
    const result = await query<FamilyRow>(
      `SELECT f.id, f.display_name, f.relationship, f.date_of_birth::text, f.preferred_name, f.notes,
              count(DISTINCT pm.policy_id)::int AS policy_count
         FROM family_members f
         LEFT JOIN policy_members pm ON pm.family_member_id=f.id AND pm.account_id=f.account_id
        WHERE f.account_id=$1
        GROUP BY f.id
        ORDER BY CASE WHEN f.relationship='self' THEN 0 ELSE 1 END, f.created_at`,
      [devAccountId()],
    );
    return NextResponse.json({ family: result.rows });
  } catch (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { displayName?: string; relationship?: string; dateOfBirth?: string | null; preferredName?: string | null };
    if (!body.displayName?.trim() || !body.relationship?.trim()) {
      return NextResponse.json({ error: "Full name and relationship are required" }, { status: 400 });
    }
    if (body.displayName.trim().length > 200) return NextResponse.json({ error: "That name is too long." }, { status: 400 });
    if (body.relationship.trim().length > 100) return NextResponse.json({ error: "That relationship is too long." }, { status: 400 });
    if (body.preferredName && body.preferredName.trim().length > 100) return NextResponse.json({ error: "That preferred name is too long." }, { status: 400 });
    if (body.dateOfBirth && !isValidDateString(body.dateOfBirth)) return NextResponse.json({ error: "That date of birth isn't valid." }, { status: 400 });
    const accountId = devAccountId();
    if (body.relationship.trim().toLowerCase() === "self") {
      // "self" means the household member DearPolicy is speaking for; a
      // second one has no meaning here and would just confuse whichever
      // fallback in the app picks "the self profile" (the upload default,
      // portfolio ordering) into silently choosing one over the other.
      const existingSelf = await query<{ id: string }>(`SELECT id FROM family_members WHERE account_id=$1 AND relationship='self'`, [accountId]);
      if (existingSelf.rows.length) return NextResponse.json({ error: "This household already has a profile marked \"self\". Use a different relationship for this person." }, { status: 409 });
    }
    const result = await query(
      `INSERT INTO family_members(account_id,display_name,relationship,date_of_birth,preferred_name)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,display_name,relationship,date_of_birth::text,preferred_name`,
      [accountId, body.displayName.trim(), body.relationship.trim(), body.dateOfBirth || null, body.preferredName?.trim() || null],
    );
    return NextResponse.json({ member: result.rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
