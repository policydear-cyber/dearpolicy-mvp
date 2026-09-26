import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { computeIndicativeEstimate } from "@/lib/claims/indicative-assessment";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** The indicative claim estimate for one of this household's claims, computed
 * fresh through the evidence-gated engine (lib/claims/indicative-assessment.ts).
 * Never cached, never another household's claim. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "That claim could not be found." }, { status: 404 });
    const ctx = await requireHouseholdContext(request);
    const estimate = await computeIndicativeEstimate(ctx.householdId, id);
    if (!estimate) return NextResponse.json({ error: "That claim could not be found." }, { status: 404 });
    return NextResponse.json({ estimate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
