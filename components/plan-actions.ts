/** Opening Stripe's hosted pages from Plan usage: checkout to upgrade, the portal to manage a subscription. Each call
 * asks DearPolicy's server for the page's address (owner only; app/api/billing/*) and returns it, or throws with a
 * message fit for the household (the caller shows it through customerError). */
import type { BillingInterval, PlanId } from "@/lib/plans/catalogue";

async function pageAddress(path: string, body: object): Promise<string> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const p = await r.json().catch(() => ({}));
  if (!r.ok || typeof p.url !== "string" || !/^https:\/\//.test(p.url)) throw new Error(typeof p.error === "string" && r.status < 500 ? p.error : "");
  return p.url;
}

export const checkoutAddress = (plan: Exclude<PlanId, "free">, interval: BillingInterval) => pageAddress("/api/billing/checkout", { plan, interval });
export const subscriptionAddress = () => pageAddress("/api/billing/portal", {});
