/**
 * Where Home's "Current insurance cost" comes from, said by the kinds of the premiums it counts. A premium is read either
 * from a premium record the household uploaded (a receipt or renewal notice, on Payments & receipts) or from the premium
 * line a policy's own schedule prints (lib/policies/premium-summary.ts tablePremiumItems, fromTable). Only the kinds
 * listed here are named; any other kind, or none, gives the neutral "from your documents", never a wrong source.
 * Pure: safe for client components.
 */
export type PremiumSourceKind = "policy_schedule" | "payment_record";

/** The kind of one counted premium: a premium the policy's own document prints, or one from a premium record. */
export function premiumSourceKind(item: { fromTable?: boolean | null }): PremiumSourceKind {
  return item.fromTable === true ? "policy_schedule" : "payment_record";
}

const NAMES: Record<PremiumSourceKind, [string, string]> = {
  policy_schedule: ["policy schedule", "policy schedules"],
  payment_record: ["payment record", "payment records"],
};
const ORDER: PremiumSourceKind[] = ["policy_schedule", "payment_record"];
const NEUTRAL = "from your documents";

/** "from your policy schedules", "from your payment record", "from your policy schedules and payment records"; any kind
 * not listed above (or no kind at all) gives "from your documents". */
export function premiumSourceCaption(kinds: ReadonlyArray<string | null | undefined>): string {
  if (!kinds.length || kinds.some((k) => !k || !Object.prototype.hasOwnProperty.call(NAMES, k))) return NEUTRAL;
  const parts = ORDER.map((kind) => {
    const n = kinds.filter((k) => k === kind).length;
    return n ? NAMES[kind][n === 1 ? 0 : 1] : null;
  }).filter((p): p is string => !!p);
  return parts.length ? "from your " + parts.join(" and ") : NEUTRAL;
}
