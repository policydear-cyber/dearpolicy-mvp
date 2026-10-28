/**
 * Where Home's "Current insurance cost" comes from, said by the kinds of the premiums it counts. A premium is read either
 * from the premium line a policy's own schedule prints (lib/policies/premium-summary.ts tablePremiumItems, fromTable) or
 * from a premium record. A premium record is named by the role of the document it was read from, because premium records
 * also hold premiums read off a personalised schedule at upload (lib/rag/ingest.ts) and rows from a schedule's own payment
 * table (lib/policies/linking.ts), not only receipts. Allow-list: a payment-evidence document (lib/documents/messy.ts
 * PAYMENT_ROLES) with a payment date or period is a payment record; a personalised schedule or certificate is a policy
 * schedule; any other role, or none, has no kind, and the caption then says the neutral "from your documents".
 * Pure: safe for client components.
 */
import { PAYMENT_ROLES } from "@/lib/documents/messy";

export type PremiumSourceKind = "policy_schedule" | "payment_record";

/** Roles of a household's own personalised policy document that print its premium. */
const SCHEDULE_ROLES: ReadonlySet<string> = new Set(["personal_schedule", "certificate"]);

/** The kind of one counted premium, or null when its source is not known to be one of the kinds above. */
export function premiumSourceKind(item: { fromTable?: boolean | null; source_role?: string | null; payment_date?: string | null;
  period_start?: string | null; period_end?: string | null }): PremiumSourceKind | null {
  if (item.fromTable === true) return "policy_schedule";
  const role = item.source_role ?? "";
  if (SCHEDULE_ROLES.has(role)) return "policy_schedule";
  if (PAYMENT_ROLES.has(role) && (item.payment_date || item.period_start || item.period_end)) return "payment_record";
  return null;
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
