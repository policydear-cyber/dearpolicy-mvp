import { headingIsLife } from "@/lib/benefit-table/life-heading";

/** A row's formulas that print a figure of the row's own (never worked out on each person's own sum insured). */
const OWN_FIGURE = new Set(["fixed", "expense_cap", "daily"]);

type Contract = { ownerId: string; ownerName: string; documents: { id: string }[];
  coverages: { policyId: string; amount: number | null; currency: string | null }[] };

/** The amounts a row's own quote prints ("Egret Joint Shield S$250,000", "Funeral Expense S$5,000"): money with its sign or
 * code, or, when none is signed, figures grouped in thousands. Never a percentage, a day count or a year. */
export function printedAmounts(quote: string | null): number[] {
  const text = quote ?? "";
  const signed = [...text.matchAll(/(?:[A-Z]{1,3}\$|RM|Rp\.?|€|£|¥|₹|\$|\b[A-Z]{3}\b)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?!\s*%)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  const grouped = signed.length ? [] : [...text.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?!\s*%)(?![\d,])/g)].map((m) => Number(m[1].replace(/,/g, "")));
  return [...new Set([...signed, ...grouped].filter((n) => Number.isFinite(n) && n > 0))];
}

/** Whose a Benefits row is, when its document is the own document of two or more people (a joint schedule, a shared
 * certificate): DC, 10 Nov, the rule the benefit table follows (lib/benefit-table/assemble.ts whoseRows).
 *   1. a column heading (tier) that is one of them's life: that person;
 *   2. otherwise, for a row that prints its own figure (its formula's, or the amounts its quote prints when it has none),
 *      the people whose own sum on that document is that figure;
 *   3. otherwise no one (an empty set).
 * `null`: the row is everyone's it is shown for today (a document only one person holds as their own, a wording or summary
 * they all reference, or a row that prints no amount of its own). */
export function sharedRowOwners(row: { policyId: string; tier: string | null; formulaKind: string; formulaValue: number | null; currency: string | null; quote?: string | null },
  contracts: Contract[]): Set<string> | null {
  const own = contracts.filter((c) => c.documents.some((d) => d.id === row.policyId));
  const people = [...new Map(own.map((c) => [c.ownerId, c.ownerName])).entries()];
  if (people.length < 2) return null;
  const named = people.filter(([, name]) => headingIsLife(row.tier, [name]));
  if (named.length === 1) return new Set([named[0][0]]);
  // The row's own figure: its formula's, or, for a row stored with no formula, the amounts its quote prints (TE #406: a
  // "not yet readable" row still shows its printed amount). A row that prints an amount is never everyone's by default.
  const ownFigure = OWN_FIGURE.has(row.formulaKind) && row.formulaValue != null;
  const amounts = ownFigure ? [row.formulaValue as number] : printedAmounts(row.quote ?? null);
  if (!amounts.length) return null;
  const matched = people.filter(([id]) => own.some((c) => c.ownerId === id && c.coverages.some((v) => v.policyId === row.policyId
    && v.amount != null && amounts.includes(v.amount) && (!ownFigure || !v.currency || !row.currency || v.currency === row.currency)))).map(([id]) => id);
  // Several printed amounts that are several people's sums: the row shows each of them, so it is no one's.
  return new Set(amounts.length > 1 && matched.length > 1 ? [] : matched);
}

/** Said on a Benefits row that is printed for several people on one document and does not say whose it is. */
export const NOT_TOLD_NOTE = "Printed for more than one person on this document, and it does not say whose: not shown as anyone's.";
