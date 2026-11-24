/**
 * The household's currency, applied when the table is shown (DC 24 Nov): an amount whose document prints no currency of
 * its own is in whatever currency the household has set NOW. Nothing is stored: the stored readings keep currency null,
 * every request reads the setting again, so a change of the setting changes every such amount at once, and no document
 * is read again.
 *
 * A currency the document letters ("S$", "US$", "HK$", "RM", "Currency: US Dollar") always wins and is never replaced.
 * A document is left as it is, its bare amounts with no currency, when it (or another document of the same policy):
 * - names a lettered currency other than the household's anywhere in its pages (it may be that currency's amount), or
 * - has a page whose text is not known (unreadable, not checked, empty), or
 * - has an amount or cover already in another currency.
 * A bare "$" or "dollars" names no currency (lib/documents/household-currency.currenciesNamed leaves it as "$").
 * Pure function over the checked readings; the caller reads the setting.
 */
import type { CheckedBenefit, CheckedCover, CheckedReading } from "./check";
import { HOUSEHOLD_CURRENCY_NOTE } from "@/lib/documents/household-currency";

export { HOUSEHOLD_CURRENCY_NOTE };

/** Amounts a currency can belong to: not a percentage, a count of days, or words. */
const MONEY_PAYS = new Set<string>(["amount", "up_to", "per_day", "per_period", "value"]);

const key = (n: string | null | undefined) => String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function withHouseholdCurrency(readings: CheckedReading[], household: string | null | undefined): CheckedReading[] {
  if (!household) return readings;
  // Documents of one policy (a printed policy number in common) stand or fall together: a schedule that says
  // "Currency: US Dollar" holds the policy wording's bare "$" too.
  const parent = readings.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  readings.forEach((r, i) => {
    for (const n of new Set(r.covers.map((c) => key(c.policyNumber)).filter((k) => k.length >= 4))) {
      const first = owner.get(n);
      if (first == null) owner.set(n, i); else parent[find(i)] = find(first);
    }
  });
  const held = new Set<number>();
  readings.forEach((r, i) => {
    const named = r.pageCurrencies?.named ?? [];
    const other = named.some((c) => c !== household)
      || [...r.covers, ...r.benefits].some((x) => !!x.currency && x.currency !== household);
    if (other || !r.pageCurrencies || !r.pageCurrencies.allKnown) held.add(find(i));
  });
  return readings.map((r, i) => {
    if (held.has(find(i))) return r;
    const money = (b: CheckedBenefit) => b.currency == null && MONEY_PAYS.has(b.pays) && b.value != null;
    const cover = (c: CheckedCover): CheckedCover => (c.currency == null && (c.sumInsured != null || c.premium != null)
      ? { ...c, currency: household, ...(c.premiumCurrency === null ? { premiumCurrency: household } : {}), fromSettings: true } : c);
    return { ...r, covers: r.covers.map(cover), benefits: r.benefits.map((b) => (money(b) ? { ...b, currency: household, fromSettings: true } : b)) };
  });
}
