import { billingEnabled } from "@/lib/billing/stripe";

/** Can a household buy Plus or Family today? The public pages say "coming soon" until it can. Same switch as Plan usage. */
export function purchaseOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return billingEnabled(env);
}
