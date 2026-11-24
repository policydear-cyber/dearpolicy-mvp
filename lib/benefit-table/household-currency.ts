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

/** An insurer's name as its first meaningful word, for matching ("Merlion Mutual", "The Merlion Mutual Assurance (Singapore)
 * Pte. Ltd.", "Merlion Mutual Insurance Co." all give "merlion"): the name is extracted per document and is rarely spelled the
 * same twice. Two insurers sharing a first word are held together, which only ever leaves a currency not stated. */
const GENERIC = new Set(["the", "ltd", "limited", "pte", "pty", "co", "company", "corp", "corporation", "inc", "plc", "bhd", "berhad", "assurance", "insurance", "ins", "singapore", "sg", "of", "and", "group", "holdings"]);
export function insurerKey(name: string | null | undefined): string {
  const words = String(name ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !GENERIC.has(w));
  return words[0] ?? "";
}

const key = (n: string | null | undefined) => String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** What the readings alone do not show (service.ts load()):
 * - `keys`: for a document, the names it shares with the documents of its policy: the policy number its file records and
 *   its insurer and product. A wording with no cover is grouped with its schedule by these;
 * - `unknownDocuments`: documents some of whose pages the table never loads (unreadable, not checked), or that were
 *   never read into the table: what they print is not known, so the policy they belong to is held. */
export type CurrencyContext = { keys?: Map<string, string[]>; unknownDocuments?: Set<string>; insurers?: Map<string, string>;
  /** Told, for each document left with no currency, why (a short fixed code): for the server log only, never shown. */
  onHold?: (held: { documentId: string; why: string }[]) => void };

export function withHouseholdCurrency(readings: CheckedReading[], household: string | null | undefined, ctx: CurrencyContext = {}): CheckedReading[] {
  if (!household) return readings;
  // Documents of one policy (a printed policy number in common) stand or fall together: a schedule that says
  // "Currency: US Dollar" holds the policy wording's bare "$" too.
  const parent = readings.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  readings.forEach((r, i) => {
    for (const n of new Set([...r.covers.map((c) => key(c.policyNumber)).filter((k) => k.length >= 4), ...(ctx.keys?.get(r.documentId) ?? [])])) {
      const first = owner.get(n);
      if (first == null) owner.set(n, i); else parent[find(i)] = find(first);
    }
  });
  const held = new Set<number>();
  const reasons = new Map<number, string>();
  const hold = (i: number, why: string) => { const root = find(i); if (!held.has(root)) { held.add(root); reasons.set(root, why); } };
  // A document the table has no reading of, or only part of, holds every reading that shares a name with it.
  const unknownKeys = new Set<string>();
  const byId = new Map(readings.map((r, i) => [r.documentId, i]));
  for (const id of ctx.unknownDocuments ?? []) {
    const ks = ctx.keys?.get(id) ?? [];
    if (byId.has(id)) hold(byId.get(id)!, "document with pages the table never loads");
    for (const k of ks) unknownKeys.add(k);
  }
  readings.forEach((r, i) => {
    const ks = [...r.covers.map((c) => key(c.policyNumber)).filter((k) => k.length >= 4), ...(ctx.keys?.get(r.documentId) ?? [])];
    if (ks.some((k) => unknownKeys.has(k))) hold(i, "same policy as a document that is unknown");
  });
  // A document with no cover of its own (a wording, terms) that names another currency applies to its insurer's policies
  // whatever the products are called, and to every policy when it names no insurer either (nothing ties it to one).
  const wordingInsurers = new Set<string>();
  let wordingNamesAny = false;
  for (const r of readings) {
    if (r.covers.length || !(r.pageCurrencies?.named ?? []).some((c) => c !== household)) continue;
    const ins = insurerKey(ctx.insurers?.get(r.documentId));
    // An insurer that no policy of the household is filed under may be one of them under another name ("American
    // International Assurance" for "AIA"): nothing ties it to a policy, so every policy is held.
    const filedUnder = readings.some((o) => o.covers.length && insurerKey(ctx.insurers?.get(o.documentId)) === ins);
    if (ins && filedUnder) wordingInsurers.add(ins); else wordingNamesAny = true;
  }
  readings.forEach((r, i) => {
    const mine = insurerKey(ctx.insurers?.get(r.documentId));
    const sameInsurer = !!mine && wordingInsurers.has(mine);
    if (wordingNamesAny || sameInsurer) hold(i, wordingNamesAny ? "a wording of no known insurer names another currency" : "a wording of the same insurer names another currency");
  });
  readings.forEach((r, i) => {
    const named = r.pageCurrencies?.named ?? [];
    const other = named.some((c) => c !== household)
      || [...r.covers, ...r.benefits].some((x) => !!x.currency && x.currency !== household);
    if (other) hold(i, "names or prints another currency");
    else if (!r.pageCurrencies) hold(i, "no page information");
    else if (!r.pageCurrencies.allKnown) hold(i, "a page is not known (empty, unreadable or not checked)");
  });
  ctx.onHold?.(readings.flatMap((r, i) => (held.has(find(i)) ? [{ documentId: r.documentId, why: reasons.get(find(i)) ?? "" }] : [])));
  return readings.map((r, i) => {
    if (held.has(find(i))) return r;
    // A count read as an amount ("Waiting period 14", "Units 2") is not money: the figure is money-shaped or at least 100.
    const moneyShaped = (b: CheckedBenefit) => (b.value ?? 0) >= 100 || /\d{1,3}(?:,\d{3})+|\d\.\d{2}\b|\$\s?\d/.test(b.source.excerpt);
    const money = (b: CheckedBenefit) => b.currency == null && MONEY_PAYS.has(b.pays) && b.value != null && moneyShaped(b);
    const cover = (c: CheckedCover): CheckedCover => (c.currency == null && (c.sumInsured != null || c.premium != null)
      ? { ...c, currency: household, ...(c.premiumCurrency === null ? { premiumCurrency: household } : {}), fromSettings: true } : c);
    return { ...r, covers: r.covers.map(cover), benefits: r.benefits.map((b) => (money(b) ? { ...b, currency: household, fromSettings: true } : b)) };
  });
}
