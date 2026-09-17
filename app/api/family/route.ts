import { NextResponse } from "next/server";
import { devAccountId, query } from "@/lib/db/client";

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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Database error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { displayName?: string; relationship?: string; dateOfBirth?: string | null; preferredName?: string | null };
    if (!body.displayName?.trim() || !body.relationship?.trim()) {
      return NextResponse.json({ error: "Full name and relationship are required" }, { status: 400 });
    }
    const result = await query(
      `INSERT INTO family_members(account_id,display_name,relationship,date_of_birth,preferred_name)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,display_name,relationship,date_of_birth::text,preferred_name`,
      [devAccountId(), body.displayName.trim(), body.relationship.trim(), body.dateOfBirth || null, body.preferredName?.trim() || null],
    );
    return NextResponse.json({ member: result.rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Database error" }, { status: 500 });
  }
}
