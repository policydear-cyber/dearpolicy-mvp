/**
 * Coverage's benefit-table view lists each person's covers, and a cover printed on a document that names several people
 * in the household (a group certificate, a family plan) carries the document's own benefit lines under every one of them.
 * A line printed once for the whole document, or for another person on it, then sits under this person's name. The card
 * says whom else the cover is shared with and this person's own sum, as Benefits does (lib/policies/shared-policy.ts), so
 * a figure printed for someone else is never read as theirs. It changes no figure. Any insurer, any market: names and sums
 * come from the household's own table. Pure: safe for client components.
 */
import { money, shortFigure, type SummaryRow } from "@/lib/benefit-table/headline";
import { sharedPolicyNote, sharedPolicyText } from "@/lib/policies/shared-policy";

type CoverLike = { coverKey: string; sumInsured: number | null; currency: string | null; source: { documentId: string } };
type PersonLike = { id: string; name: string; covers: CoverLike[] };

/** The sentence a cover card shows, or null: the document names no one else in the household, or every amount listed
 * under the cover is this person's own sum (nothing there can be read as someone else's). Shared means another person
 * has any cover on the same document, whatever it is called there: a group certificate can read the employee's cover and
 * the spouse's under different names (Critic L2, TE #354). An own sum with no currency on its page is said as the
 * table says it, never with a bare "$" (Critic R374 L1). A namesake is named as another household member, so the
 * sentence never seems to name the person themself. */
export function sharedCoverText(people: PersonLike[], person: { id: string; name: string }, cover: CoverLike, rows: SummaryRow[]): string | null {
  if (!rows.length) return null;
  const others = people.filter((p) => p.id !== person.id && p.covers.some((c) => c.source.documentId === cover.source.documentId))
    .map((p) => p.name === person.name ? `another household member named ${p.name}` : p.name);
  if (!others.length) return null;
  const sum = cover.sumInsured;
  const ownSum = sum == null ? null : cover.currency ? money(sum, cover.currency)
    : `${sum.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(sum) ? 0 : 2, maximumFractionDigits: 2 })} (currency not stated)`;
  const note = sharedPolicyNote([person.name, ...others], person, [[{ ownerId: person.id, amount: ownSum }]]);
  if (!note) return null;
  // The row text says a figure the way shortFigure does ("$100,000 (currency not stated)" when its page states none).
  const asRows = sum == null ? null : money(sum, cover.currency) + (cover.currency ? "" : " (currency not stated)");
  if (asRows && rows.every((r) => shortFigure(r).text === asRows)) return null;
  return sharedPolicyText(note, person.name, "an amount listed below");
}
