import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE } from "@/lib/claims/evidence/document-catalogue";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Disability policy-definition match (lib/claims/evidence/disability-matches.ts).
 *
 * Deciding that evidence satisfies (or does not satisfy) a policy's own
 * definition is a policy-definition decision, and a "matches" record is
 * exactly what lets a calculator unlock an amount. This route previously
 * let ANY household member record that decision for their own claim -- with
 * a free-text reviewerName they supplied themselves -- so a user's own
 * statement could unlock money. DearPolicy has no authorized-reviewer role,
 * so no household request may record ANY definition result here (a
 * "does not match" or "needs review" record would also supersede an
 * existing reviewed decision for the same scope). The route stays
 * authenticated and household-scoped and always refuses with
 * POLICY_DEFINITION_REVIEW_REQUIRED. The underlying confirmDisabilityDefinitionMatch() function is
 * unchanged and remains available to a future authorized-reviewer path. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid claim-evidence document id." }, { status: 400 });
    await requireHouseholdContext(request);
    return NextResponse.json(
      { error: POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE, reasonCode: "POLICY_DEFINITION_REVIEW_REQUIRED" },
      { status: 403 },
    );
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Could not record the match decision." }, { status: 500 });
    return authResponse;
  }
}
