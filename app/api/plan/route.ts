import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { keptDocumentCount, questionsThisMonth, readHouseholdPlan } from "@/lib/billing/household-plan";
import { billingEnabled } from "@/lib/billing/stripe";
import { requireHouseholdOwner } from "@/lib/household/repo";
import { mayPromptUpgrade, planStatus } from "@/lib/plans/prompt";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** The household's plan for the badge beside the light/dark switch, and whether to show upgrade prompts
 * (lib/plans/prompt.ts). Light on purpose: every signed-in page asks once. The counts are read only when a prompt may
 * show (the owner, on Free, with payments on). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const [plan, isOwner] = await Promise.all([
      readHouseholdPlan(ctx.householdId),
      requireHouseholdOwner(ctx.userId, ctx.householdId).then(() => true, () => false),
    ]);
    const input = { planId: plan.planId, isOwner, billingEnabled: billingEnabled() };
    if (!mayPromptUpgrade(input)) return NextResponse.json(planStatus(input), { headers: { "cache-control": "no-store" } });
    // A count that can't be read hides the prompts, never the badge (TE F3).
    const counts = await Promise.all([keptDocumentCount(ctx.householdId), questionsThisMonth(ctx.householdId)]).catch(() => null);
    if (!counts) return NextResponse.json(planStatus({ ...input, billingEnabled: false }), { headers: { "cache-control": "no-store" } });
    return NextResponse.json(planStatus({ ...input, documentsKept: counts[0], questionsThisMonth: counts[1] }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Could not load your plan" }, { status: 500 });
    return authResponse;
  }
}
