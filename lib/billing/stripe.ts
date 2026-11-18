/**
 * Paying for a plan through Stripe: a hosted checkout to upgrade, the hosted billing portal to change or cancel, and a
 * webhook that records the result in household_plans (sql/household-plans.sql).
 *
 * Off until the owner sets every setting below (docs/billing-setup.md). Off, nothing here calls Stripe: Plan usage says
 * upgrades open soon, and the checkout, portal and webhook routes answer 404.
 *
 *   DEARPOLICY_BILLING=on
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_PLUS_MONTHLY, STRIPE_PRICE_PLUS_YEARLY, STRIPE_PRICE_FAMILY_MONTHLY, STRIPE_PRICE_FAMILY_YEARLY
 *
 * Stripe's REST API is called with fetch (no SDK). Card details never touch DearPolicy: Stripe's own pages take them.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db/client";
import type { BillingInterval, PlanId } from "@/lib/billing/plans";

type PaidPlan = Exclude<PlanId, "free">;
const PRICE_ENV: Record<PaidPlan, Record<BillingInterval, string>> = {
  plus: { month: "STRIPE_PRICE_PLUS_MONTHLY", year: "STRIPE_PRICE_PLUS_YEARLY" },
  family: { month: "STRIPE_PRICE_FAMILY_MONTHLY", year: "STRIPE_PRICE_FAMILY_YEARLY" },
};

export type BillingConfig = { secretKey: string; webhookSecret: string; prices: Record<PaidPlan, Record<BillingInterval, string>> };

/** The billing settings, or null while billing is off or any setting is missing (all or nothing: a half-set-up billing
 * would take a payment it can't record). */
export function billingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig | null {
  if (!/^(1|true|on|yes)$/i.test(env.DEARPOLICY_BILLING?.trim() ?? "")) return null;
  const get = (name: string) => env[name]?.trim() ?? "";
  const secretKey = get("STRIPE_SECRET_KEY"), webhookSecret = get("STRIPE_WEBHOOK_SECRET");
  const prices = {
    plus: { month: get(PRICE_ENV.plus.month), year: get(PRICE_ENV.plus.year) },
    family: { month: get(PRICE_ENV.family.month), year: get(PRICE_ENV.family.year) },
  };
  if (!secretKey || !webhookSecret || ![prices.plus.month, prices.plus.year, prices.family.month, prices.family.year].every(Boolean)) return null;
  return { secretKey, webhookSecret, prices };
}

export function billingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return billingConfig(env) !== null;
}

/** Which plan and interval a Stripe price is, or null for a price DearPolicy doesn't sell. */
export function planForPrice(config: BillingConfig, priceId: string): { plan: PaidPlan; interval: BillingInterval } | null {
  for (const plan of ["plus", "family"] as const) {
    for (const interval of ["month", "year"] as const) if (config.prices[plan][interval] === priceId) return { plan, interval };
  }
  return null;
}

export class StripeRequestFailed extends Error {
  constructor(public status: number) {
    super("Stripe request failed (" + status + ")");
    this.name = "StripeRequestFailed";
  }
}

/** One Stripe API call. Form-encoded, as Stripe's API takes it. Stripe's own error text is never passed on to a household. */
async function stripe<T>(config: BillingConfig, method: "GET" | "POST", path: string, params: Record<string, string> = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const body = new URLSearchParams(params).toString();
  const url = "https://api.stripe.com/v1/" + path + (method === "GET" && body ? "?" + body : "");
  const response = await fetchImpl(url, {
    method,
    headers: { authorization: "Bearer " + config.secretKey, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "POST" ? body : undefined,
  });
  if (!response.ok) throw new StripeRequestFailed(response.status);
  return (await response.json()) as T;
}

/** A hosted checkout page for a paid plan. The household id travels on the session and on the subscription, so the
 * webhook can always tell whose plan it is. */
export async function createCheckoutSession(config: BillingConfig, args: {
  householdId: string; plan: PaidPlan; interval: BillingInterval; email: string | null; customerId: string | null; origin: string;
}, fetchImpl?: typeof fetch): Promise<string> {
  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": config.prices[args.plan][args.interval],
    "line_items[0][quantity]": "1",
    client_reference_id: args.householdId,
    "metadata[household_id]": args.householdId,
    "subscription_data[metadata][household_id]": args.householdId,
    allow_promotion_codes: "true",
    success_url: args.origin + "/usage?upgraded=1",
    cancel_url: args.origin + "/usage",
  };
  if (args.customerId) params.customer = args.customerId;
  else if (args.email) params.customer_email = args.email;
  const session = await stripe<{ url?: string }>(config, "POST", "checkout/sessions", params, fetchImpl);
  if (!session.url) throw new StripeRequestFailed(502);
  return session.url;
}

/** Stripe's hosted billing portal: change plan, update the card, see invoices, cancel. */
export async function createPortalSession(config: BillingConfig, args: { customerId: string; origin: string }, fetchImpl?: typeof fetch): Promise<string> {
  const session = await stripe<{ url?: string }>(config, "POST", "billing_portal/sessions", { customer: args.customerId, return_url: args.origin + "/usage" }, fetchImpl);
  if (!session.url) throw new StripeRequestFailed(502);
  return session.url;
}

/** The household's Stripe customer, if it has one. */
export async function stripeCustomerOf(householdId: string): Promise<string | null> {
  try {
    return (await query<{ id: string | null }>(`SELECT stripe_customer_id AS id FROM household_plans WHERE account_id=$1`, [householdId])).rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Checks a webhook's Stripe-Signature header (t=<seconds>,v1=<hex HMAC-SHA256 of "t.body">), within five minutes. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds: number = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=", 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k, v]) => k === "v1" && /^[0-9a-f]{64}$/i.test(v ?? "")).map(([, v]) => v.toLowerCase());
  if (!Number.isFinite(t) || !signatures.length) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return signatures.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type StripeSubscription = {
  id: string; customer: string; status: string;
  metadata?: Record<string, string>;
  current_period_end?: number;
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
};
type StripeEvent = { id: string; type: string; created: number; data: { object: Record<string, unknown> } };

export type PlanWrite = {
  householdId: string; plan: PaidPlan; status: string; interval: BillingInterval;
  customerId: string; subscriptionId: string; currentPeriodEnd: Date | null; eventCreated: Date;
};

/** What a subscription means for a household's plan, or null when it isn't one of DearPolicy's prices or names no
 * household. Pure: the webhook tests drive it directly. */
export function planWriteFor(config: BillingConfig, subscription: StripeSubscription, eventCreated: number, householdHint: string | null): PlanWrite | null {
  const householdId = subscription.metadata?.household_id || householdHint;
  const item = subscription.items?.data?.[0];
  const priced = item?.price?.id ? planForPrice(config, item.price.id) : null;
  if (!householdId || !/^[0-9a-f-]{36}$/i.test(householdId) || !priced) return null;
  const periodEnd = subscription.current_period_end ?? item?.current_period_end;
  return {
    householdId, plan: priced.plan, interval: priced.interval, status: subscription.status,
    customerId: subscription.customer, subscriptionId: subscription.id,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null, eventCreated: new Date(eventCreated * 1000),
  };
}

/** Records a plan. An event older than the one the row was last written from is ignored (Stripe doesn't promise order). */
export async function savePlan(write: PlanWrite): Promise<void> {
  await query(
    `INSERT INTO household_plans(account_id,plan,status,billing_interval,stripe_customer_id,stripe_subscription_id,current_period_end,stripe_event_created,updated_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,now() WHERE EXISTS (SELECT 1 FROM accounts WHERE id=$1)
     ON CONFLICT (account_id) DO UPDATE SET plan=excluded.plan,status=excluded.status,billing_interval=excluded.billing_interval,
       stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,
       current_period_end=excluded.current_period_end,stripe_event_created=excluded.stripe_event_created,updated_at=now()
     WHERE household_plans.status<>'complimentary'
       AND (household_plans.stripe_event_created IS NULL OR household_plans.stripe_event_created<=excluded.stripe_event_created)`,
    [write.householdId, write.plan, write.status, write.interval, write.customerId, write.subscriptionId, write.currentPeriodEnd, write.eventCreated],
  );
}

/** Handles one verified Stripe event. Returns what it did, for the log line. */
export async function handleStripeEvent(config: BillingConfig, event: StripeEvent, deps: { fetchImpl?: typeof fetch; save?: (w: PlanWrite) => Promise<void> } = {}): Promise<"saved" | "ignored"> {
  const save = deps.save ?? savePlan;
  const object = event.data?.object ?? {};
  if (event.type === "checkout.session.completed") {
    const subscriptionId = typeof object.subscription === "string" ? object.subscription : null;
    const household = typeof object.client_reference_id === "string" ? object.client_reference_id : null;
    if (!subscriptionId) return "ignored";
    const subscription = await stripe<StripeSubscription>(config, "GET", "subscriptions/" + encodeURIComponent(subscriptionId), {}, deps.fetchImpl);
    const write = planWriteFor(config, subscription, event.created, household);
    if (!write) return "ignored";
    await save(write);
    return "saved";
  }
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const write = planWriteFor(config, object as unknown as StripeSubscription, event.created, null);
    if (!write) return "ignored";
    await save(event.type === "customer.subscription.deleted" ? { ...write, status: "canceled" } : write);
    return "saved";
  }
  return "ignored";
}
