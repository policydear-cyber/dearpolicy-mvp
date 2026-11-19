import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { requireHouseholdOwner } from "@/lib/household/repo";
import { loadPolicyDates } from "@/lib/policies/policy-dates-load";
import { NotRenewedUnavailable, setNotRenewed } from "@/lib/policies/not-renewed";

/** "I didn't renew it" and its Undo, from Home's "Policy dates" (DC 19 Nov 2026). The household's owner only. Accepted only
 * for one of the person's own policies whose printed end date has passed with no renewal evidence after it, and only for
 * that printed date, so an answer can never stand against a newer schedule or a renewal receipt. */
export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

const Body = z.object({ member: z.string().uuid(), key: z.string().min(1).max(400), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notRenewed: z.boolean() });

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    await requireHouseholdOwner(ctx.userId, ctx.householdId);
    const body = Body.parse(await request.json().catch(() => ({})));
    const { policies, contractKeys } = await loadPolicyDates(ctx.householdId, body.member);
    const policy = policies.find((p) => p.key === body.key && p.endsOn === body.endsOn);
    const contractKey = contractKeys.get(body.key);
    const allowed = !!contractKey && (body.notRenewed ? policy?.state === "renewal_due" && !policy.severalPolicies : policy?.state === "not_renewed");
    if (!policy || !allowed) return NextResponse.json({ error: "That policy has changed since this page loaded. Please refresh and try again." }, { status: 409 });
    await setNotRenewed({ accountId: ctx.householdId, memberId: body.member, contractKey: contractKey!, endsOn: body.endsOn, userId: ctx.userId, notRenewed: body.notRenewed });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "That request was not complete. Please try again." }, { status: 400 });
    if (error instanceof NotRenewedUnavailable) return NextResponse.json({ error: "This is not switched on yet." }, { status: 409 });
    return routeErrorResponse(error, { request });
  }
}
