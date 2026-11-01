import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { maskShownText } from "@/lib/chat/identity-numbers";
import { countedPremiums, tableCoversByMember } from "@/lib/policies/counted-premiums";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration = 60;

// What each person's cover costs, counted exactly as Home counts it (the same computation), so Payments and Home agree.
// Read only: no document is read and nothing is written here, unlike the dashboard's background work.
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request); const accountId = ctx.householdId;
    const family = await query<{ id: string; display_name: string; relationship: string }>(
      `SELECT f.id,f.display_name,f.relationship FROM family_members f WHERE f.account_id=$1 AND ${activePredicate("f")}
        ORDER BY CASE WHEN f.relationship='self' THEN 0 ELSE 1 END,f.created_at`, [accountId]);
    let covers: Awaited<ReturnType<typeof tableCoversByMember>> = null;
    try { covers = await tableCoversByMember(accountId); }
    catch (error) { console.warn("Benefit table unavailable for premiums:", error instanceof Error ? error.message : error); }
    const people = [], memo = {};
    for (const m of family.rows) {
      people.push({ id: m.id, display_name: m.display_name, relationship: m.relationship,
        premiums: await countedPremiums(accountId, { id: m.id, display_name: m.display_name, preferred_name: null, relationship: m.relationship }, covers ? covers.get(m.id) ?? [] : null, memo) });
    }
    return NextResponse.json(maskShownText({ people }));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
