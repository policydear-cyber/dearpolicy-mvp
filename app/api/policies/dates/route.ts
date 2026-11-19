import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { requireHouseholdOwner, NotHouseholdOwnerError } from "@/lib/household/repo";
import { loadPolicyDates } from "@/lib/policies/policy-dates-load";
import { maskShownText } from "@/lib/chat/identity-numbers";

/** When each of a person's policies ends (lib/policies/policy-dates.ts), for Home's "Policy dates" list. Read from stored
 * documents, readings and premium records only: no model call. canAnswer: the signed-in person is the household's owner,
 * who alone may say "I didn't renew it" (Members view and ask only, DC 18 Nov), and sql/policy-not-renewed.sql is applied. */
export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const requested = new URL(request.url).searchParams.get("member") ?? "";
    const loaded = await loadPolicyDates(ctx.householdId, isUuid(requested) ? requested : null);
    const owner = await requireHouseholdOwner(ctx.userId, ctx.householdId).then(() => true, (e) => { if (e instanceof NotHouseholdOwnerError) return false; throw e; });
    return NextResponse.json(maskShownText({ memberId: loaded.memberId, policies: loaded.policies, canAnswer: owner && loaded.answersReady }));
  } catch (error) {
    const response = routeErrorResponse(error);
    if (response.status === 500) return NextResponse.json({ error: "Policy dates are unavailable" }, { status: 500 });
    return response;
  }
}
