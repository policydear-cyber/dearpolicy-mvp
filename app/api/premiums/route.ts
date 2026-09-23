import { NextResponse } from "next/server";
import { devAccountId, query } from "@/lib/db/client";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

export async function GET() {
  try {
    const result = await query(
      `SELECT pr.id,pr.family_member_id,f.display_name AS family_member_name,pr.insurer,pr.product_name,pr.policy_number,
              pr.amount::text,pr.currency,pr.frequency,pr.payment_date::text,pr.period_start::text,pr.period_end::text,pr.notes,pr.created_at::text
       FROM premium_records pr LEFT JOIN family_members f ON f.id=pr.family_member_id
       WHERE pr.account_id=$1 ORDER BY COALESCE(pr.payment_date,pr.period_start,pr.created_at::date) DESC,pr.created_at DESC`,
      [devAccountId()],
    );
    return NextResponse.json({ records: result.rows });
  } catch (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
