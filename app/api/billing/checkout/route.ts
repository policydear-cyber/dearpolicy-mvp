import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdOwnerContext, routeErrorResponse } from "@/lib/auth/request-context";
import { readHouseholdPlan } from "@/lib/billing/household-plan";
import { billingConfig, createCheckoutSession, ensureStripeCustomer, expireOpenCheckouts, hasLiveSubscription } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

const ALREADY_PAID = "Your household already has a paid plan, or a payment is being confirmed. Use Manage subscription on Plan usage to change it.";
const Body = z.object({ plan: z.enum(["plus", "family"]), interval: z.enum(["month", "year"]) });

/** Upgrade: returns the address of Stripe's hosted checkout page for the chosen plan. Owner only (members view and
 * ask; DC, 18 Nov). Off (404) until billing is set up (lib/billing/stripe.ts). A household already on a paid plan
 * changes it in the billing portal instead, so it is never charged twice. */
export async function POST(request: NextRequest) {
  try {
    const config = billingConfig();
    if (!config) return NextResponse.json({ error: "Upgrades aren’t open yet." }, { status: 404 });
    const body = Body.parse(await request.json().catch(() => ({})));
    const ctx = await requireHouseholdOwnerContext(request);
    const current = await readHouseholdPlan(ctx.householdId);
    if (current.planId !== "free") return NextResponse.json({ error: ALREADY_PAID, code: "already_paid" }, { status: 409 });
    // One Stripe customer per household, stored first; no second subscription while one is paying or being paid; and
    // only the newest checkout page stays open, so two tabs can't both take a payment (Critic, 18 Nov).
    const customerId = await ensureStripeCustomer(config, ctx.householdId, ctx.user.email);
    if (await hasLiveSubscription(config, customerId)) return NextResponse.json({ error: ALREADY_PAID, code: "already_paid" }, { status: 409 });
    await expireOpenCheckouts(config, customerId);
    const url = await createCheckoutSession(config, {
      householdId: ctx.householdId, plan: body.plan, interval: body.interval, customerId, origin: request.nextUrl.origin,
    });
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });
    const auth = routeErrorResponse(error);
    if (auth.status === 500) return NextResponse.json({ error: "The payment page couldn’t open just now. Nothing was charged. Please try again shortly." }, { status: 502 });
    return auth;
  }
}
