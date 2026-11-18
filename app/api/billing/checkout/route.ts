import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { requireHouseholdOwner } from "@/lib/household/repo";
import { readHouseholdPlan } from "@/lib/billing/household-plan";
import { billingConfig, createCheckoutSession, stripeCustomerOf } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

const Body = z.object({ plan: z.enum(["plus", "family"]), interval: z.enum(["month", "year"]) });

/** Upgrade: returns the address of Stripe's hosted checkout page for the chosen plan. Owner only (members view and
 * ask; DC, 18 Nov). Off (404) until billing is set up (lib/billing/stripe.ts). A household already on a paid plan
 * changes it in the billing portal instead, so it is never charged twice. */
export async function POST(request: NextRequest) {
  try {
    const config = billingConfig();
    if (!config) return NextResponse.json({ error: "Upgrades aren’t open yet." }, { status: 404 });
    const body = Body.parse(await request.json().catch(() => ({})));
    const ctx = await requireHouseholdContext(request);
    await requireHouseholdOwner(ctx.userId, ctx.householdId);
    const current = await readHouseholdPlan(ctx.householdId);
    if (current.planId !== "free") return NextResponse.json({ error: "Your household already has a paid plan. Use Manage subscription on Plan usage to change it.", code: "already_paid" }, { status: 409 });
    const url = await createCheckoutSession(config, {
      householdId: ctx.householdId, plan: body.plan, interval: body.interval,
      email: ctx.user.email, customerId: await stripeCustomerOf(ctx.householdId), origin: request.nextUrl.origin,
    });
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });
    const auth = routeErrorResponse(error);
    if (auth.status === 500) return NextResponse.json({ error: "The payment page couldn’t open just now. Nothing was charged. Please try again shortly." }, { status: 502 });
    return auth;
  }
}
