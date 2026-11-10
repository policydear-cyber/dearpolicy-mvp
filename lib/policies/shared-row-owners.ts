import { headingIsLife } from "@/lib/benefit-table/life-heading";

/** A row's formulas that print a figure of the row's own (never worked out on each person's own sum insured). */
const OWN_FIGURE = new Set(["fixed", "expense_cap", "daily"]);

type Contract = { ownerId: string; ownerName: string; documents: { id: string }[];
  coverages: { policyId: string; amount: number | null; currency: string | null }[] };

/** Whose a Benefits row is, when its document is the own document of two or more people (a joint schedule, a shared
 * certificate): DC, 10 Nov, the rule the benefit table follows (lib/benefit-table/assemble.ts whoseRows).
 *   1. a column heading (tier) that is one of them's life: that person;
 *   2. otherwise, for a row that prints its own figure, the people whose own sum on that document is the figure;
 *   3. otherwise no one (an empty set).
 * `null`: the row is everyone's it is shown for today (a document only one person holds as their own, a wording or summary
 * they all reference, or a row worked out on each person's own sum insured). */
export function sharedRowOwners(row: { policyId: string; tier: string | null; formulaKind: string; formulaValue: number | null; currency: string | null },
  contracts: Contract[]): Set<string> | null {
  const own = contracts.filter((c) => c.documents.some((d) => d.id === row.policyId));
  const people = [...new Map(own.map((c) => [c.ownerId, c.ownerName])).entries()];
  if (people.length < 2) return null;
  const named = people.filter(([, name]) => headingIsLife(row.tier, [name]));
  if (named.length === 1) return new Set([named[0][0]]);
  if (!OWN_FIGURE.has(row.formulaKind) || row.formulaValue == null) return null;
  return new Set(people.filter(([id]) => own.some((c) => c.ownerId === id && c.coverages.some((v) => v.policyId === row.policyId
    && v.amount != null && v.amount === row.formulaValue && (!v.currency || !row.currency || v.currency === row.currency)))).map(([id]) => id));
}

/** Said on a Benefits row that is printed for several people on one document and does not say whose it is. */
export const NOT_TOLD_NOTE = "Printed for more than one person on this document, and it does not say whose: not shown as anyone's.";
