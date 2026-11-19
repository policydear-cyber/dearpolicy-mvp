import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdOwnerContext, routeErrorResponse } from "@/lib/auth/request-context";
import { billingConfig, createPortalSession, stripeCustomerOf } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

/** Manage subscription: returns the address of Stripe's hosted billing portal (change plan, card, invoices, cancel). Owner
 * only. Off (404) until billing is set up. */
export async function POST(request: NextRequest) {
  try {
    const config = billingConfig();
    if (!config) return NextResponse.json({ error: "Billing isn’t open yet." }, { status: 404 });
    const ctx = await requireHouseholdOwnerContext(request);
    const customerId = await stripeCustomerOf(ctx.householdId);
    if (!customerId) return NextResponse.json({ error: "Your household doesn’t have a paid plan yet." }, { status: 404 });
    return NextResponse.json({ url: await createPortalSession(config, { customerId, origin: request.nextUrl.origin }) });
  } catch (error) {
    const auth = routeErrorResponse(error);
    if (auth.status === 500) return NextResponse.json({ error: "Billing couldn’t open just now. Please try again shortly." }, { status: 502 });
    return auth;
  }
}
