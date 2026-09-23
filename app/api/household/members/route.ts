import { NextResponse } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { listHouseholdMembers } from "@/lib/household/repo";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Lists every member of the caller's active household. Any member (not
 * just the owner) can see the roster -- household_members_select's RLS
 * policy grants read access to every current member, matching the "who's
 * in this household" visibility every member reasonably needs. */
export async function GET() {
  try {
    const ctx = await requireHouseholdContext();
    const members = await listHouseholdMembers(ctx.userId, ctx.householdId);
    return NextResponse.json({ members });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
