import { NextResponse } from "next/server";
import { devAccountId, query } from "@/lib/db/client";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { displayName?: string; relationship?: string; dateOfBirth?: string | null; preferredName?: string | null; notes?: string | null };
    if (!body.displayName?.trim() || !body.relationship?.trim()) return NextResponse.json({ error: "Full name and relationship are required" }, { status: 400 });
    const result = await query(
      `UPDATE family_members
          SET display_name=$1,relationship=$2,date_of_birth=$3,preferred_name=$4,notes=$5,updated_at=now()
        WHERE id=$6 AND account_id=$7
        RETURNING id,display_name,relationship,date_of_birth::text,preferred_name,notes`,
      [body.displayName.trim(),body.relationship.trim(),body.dateOfBirth || null,body.preferredName?.trim() || null,body.notes?.trim() || null,id,devAccountId()],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    return NextResponse.json({ member: result.rows[0] });
  } catch (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
