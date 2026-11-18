import { NextResponse, type NextRequest } from "next/server";
import { billingConfig, handleStripeEvent, verifyStripeSignature } from "@/lib/billing/stripe";

export const runtime = "nodejs";
/** Called by Stripe, never by a browser: no session and no Origin header. middleware.ts exempts exactly this path from
 * both, and the route authenticates every call itself with the Stripe-Signature HMAC (verifyStripeSignature: signing
 * secret, five-minute window). Off (404) until billing is set up. */
export const ROUTE_AUTH = "internal" as const;

export async function POST(request: NextRequest) {
  const config = billingConfig();
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const raw = await request.text();
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), config.webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  let event: Parameters<typeof handleStripeEvent>[1];
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  try {
    const outcome = await handleStripeEvent(config, event);
    console.info("billing webhook", event.type, outcome);
    return NextResponse.json({ received: true });
  } catch (error) {
    // A failure Stripe should retry (Stripe or the database briefly unreachable): answer 500 so it sends the event again.
    console.error("billing webhook failed", event.type, error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: "Not recorded" }, { status: 500 });
  }
}
