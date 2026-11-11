import { headingIsLife } from "@/lib/benefit-table/life-heading";

/** A row's formulas that print a figure of the row's own (never worked out on each person's own sum insured). */
const OWN_FIGURE = new Set(["fixed", "expense_cap", "daily"]);

type Contract = { ownerId: string; ownerName: string; documents: { id: string }[];
  coverages: { policyId: string; amount: number | null; currency: string | null }[] };

/** Money signs and their currency codes. A sign not listed here (or "$" alone) names no currency we can compare. */
const SIGNS: Record<string, string> = { "S$": "SGD", "US$": "USD", "HK$": "HKD", "A$": "AUD", "AU$": "AUD", "NZ$": "NZD", "C$": "CAD", "CA$": "CAD",
  "NT$": "TWD", "RM": "MYR", "RP": "IDR", "RP.": "IDR", "€": "EUR", "£": "GBP", "₹": "INR", "₱": "PHP", "฿": "THB", "₩": "KRW", "₫": "VND" };
/** Words that make the figure after them a cap or limit, never anyone's own sum ("up to S$25,000", "maximum S$50,000 per life",
 * "Benefit Limit S$5,000"). */
const CAP_BEFORE = /(?:up\s+to|maximum(?:\s+of)?|max\.?|not\s+exceeding|not\s+more\s+than|limit(?:ed\s+to)?|capped\s+at|subject\s+to)\s*[:\-]?\s*$/i;

/** Words that make the figure after them a person's own sum shown as a row's base ("100% of Sum Insured (S$300,000)",
 * "Sum Assured: S$50,000"). An allow-list: any other figure on a row worked out on each person's sum is a cap, limit or example. */
const SUM_BEFORE = /(?:sum\s+(?:assured|insured|covered)|insured\s+amount|amount\s+insured|face\s+amount)\s*(?:(?:of|is|=|:)\s*)?\(?\s*$/i;

export type PrintedFigure = { amount: number; currency: string | null; cap: boolean; base: boolean };

/** The amounts a row's own quote prints ("Egret Joint Shield S$250,000", "Funeral Expense S$5,000"), each with the currency its
 * sign or code names (null when it names none) and whether the words before it make it a cap or limit: money with its sign or
 * code, or, when none is signed, figures grouped in thousands. Never a percentage, a day count or a year. */
export function printedFigures(quote: string | null): PrintedFigure[] {
  const text = quote ?? "";
  const before = (index: number) => text.slice(Math.max(0, index - 40), index);
  const cap = (index: number) => CAP_BEFORE.test(before(index));
  const base = (index: number) => SUM_BEFORE.test(before(index));
  const signed = [...text.matchAll(/([A-Z]{1,3}\$|(?:(?<![A-Za-z])|(?<=[a-z])(?=[A-Z]{2,3}\s?\d))RM|Rp\.?|€|£|¥|₹|₱|฿|₩|₫|\$|\b[A-Z]{3}\b)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?!\s*%)/g)]
    .map((m) => { const sign = m[1].toUpperCase(); return { amount: Number(m[2].replace(/,/g, "")),
      currency: SIGNS[sign] ?? (/^[A-Z]{3}$/.test(sign) ? sign : null), cap: cap(m.index ?? 0), base: base(m.index ?? 0) }; });
  const grouped = signed.length ? [] : [...text.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?!\s*%)(?![\d,])/g)]
    .map((m) => ({ amount: Number(m[1].replace(/,/g, "")), currency: null, cap: cap(m.index ?? 0), base: base(m.index ?? 0) }));
  return [...signed, ...grouped].filter((f) => Number.isFinite(f.amount) && f.amount > 0);
}

/** The distinct amounts a row's own quote prints (see printedFigures). */
export function printedAmounts(quote: string | null): number[] {
  return [...new Set(printedFigures(quote).map((f) => f.amount))];
}

/** Whose a Benefits row is, when its document is the own document of two or more people (a joint schedule, a shared
 * certificate): DC, 10 Nov, the rule the benefit table follows (lib/benefit-table/assemble.ts whoseRows).
 *   1. a column heading (tier) that is one of them's life: that person;
 *   2. a row worked out on each person's own sum (sum_insured, limit_percentage): everyone's, unless its quote prints a figure
 *      right after "Sum Assured", "Sum Insured" or the like that is one of them's own sum ("100% of Sum Insured (S$300,000)"):
 *      that person. Any other figure it prints (a cap, a limit, an aggregate) leaves it everyone's;
 *   3. a row that prints its own figure (its formula's, or the amounts its quote prints when it has none): the people whose
 *      own sum on that document is that figure in the same currency, and otherwise no one (an empty set). An expense cap is a
 *      limit, never anyone's sum, so it is no one's.
 * A cap or limit ("up to", "maximum", "Benefit Limit") on a row with no formula is never matched to anyone's sum. A figure whose currency is not named
 * matches only on a document whose covers are all in one currency.
 * `null`: the row is everyone's it is shown for today (a document only one person holds as their own, a wording or summary
 * they all reference, a row on each person's own sum, or a row that prints no amount of its own). */
export function sharedRowOwners(row: { policyId: string; tier: string | null; formulaKind: string; formulaValue: number | null; currency: string | null; quote?: string | null },
  contracts: Contract[]): Set<string> | null {
  const own = contracts.filter((c) => c.documents.some((d) => d.id === row.policyId));
  const people = [...new Map(own.map((c) => [c.ownerId, c.ownerName])).entries()];
  if (people.length < 2) return null;
  const named = people.filter(([, name]) => headingIsLife(row.tier, [name]));
  if (named.length === 1) return new Set([named[0][0]]);
  const covers = own.flatMap((c) => c.coverages.filter((v) => v.policyId === row.policyId).map((v) => ({ ...v, ownerId: c.ownerId })));
  const currencies = new Set(covers.map((v) => v.currency).filter(Boolean));
  const ownFigure = OWN_FIGURE.has(row.formulaKind) && row.formulaValue != null;
  const printed = printedFigures(row.quote ?? null);
  // The row's own figure: its formula's (in its stored currency, or the one its quote prints beside that figure), or, for a
  // row stored with no formula, the amounts its quote prints (TE #406: a "not yet readable" row still shows its printed amount).
  const figures: PrintedFigure[] = ownFigure
    ? [{ amount: row.formulaValue as number, cap: row.formulaKind === "expense_cap", base: false,
        currency: row.currency ?? printed.find((f) => f.amount === row.formulaValue && f.currency)?.currency ?? null }]
    : row.formulaKind === "none" ? printed : printed.filter((f) => f.base);
  if (!figures.length) return null;
  const sameCurrency = (f: PrintedFigure, cover: string | null) =>
    f.currency ? (cover ? cover === f.currency : currencies.size === 0) : currencies.size <= 1 && (!row.currency || !cover || cover === row.currency);
  const hits = figures.filter((f) => !f.cap);
  const matched = people.filter(([id]) => covers.some((v) => v.ownerId === id && v.amount != null
    && hits.some((f) => f.amount === v.amount && sameCurrency(f, v.currency)))).map(([id]) => id);
  const amounts = new Set(hits.map((f) => f.amount));
  // Several printed amounts that are several people's sums: the row shows each of them, so it is no one's.
  if (amounts.size > 1 && matched.length > 1) return new Set();
  // A row on each person's own sum stays everyone's unless the sum it prints as its base is one of theirs.
  if (!ownFigure && row.formulaKind !== "none" && !matched.length) return null;
  return new Set(matched);
}

/** Said on a Benefits row that is printed for several people on one document and does not say whose it is. */
export const NOT_TOLD_NOTE = "Printed for more than one person on this document, and it does not say whose: not shown as anyone's.";
