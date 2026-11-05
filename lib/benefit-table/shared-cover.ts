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

/** The sentence a cover card shows, or null: the cover is this person's alone, or every amount listed under it is this
 * person's own sum (nothing there can be read as someone else's). */
export function sharedCoverText(people: PersonLike[], person: { id: string; name: string }, cover: CoverLike, rows: SummaryRow[]): string | null {
  if (!rows.length) return null;
  const others = people.filter((p) => p.id !== person.id && p.covers.some((c) => c.coverKey === cover.coverKey && c.source.documentId === cover.source.documentId)).map((p) => p.name);
  if (!others.length) return null;
  const ownSum = cover.sumInsured != null ? money(cover.sumInsured, cover.currency) : null;
  const note = sharedPolicyNote([person.name, ...others], person, [[{ ownerId: person.id, amount: ownSum }]]);
  if (!note) return null;
  if (ownSum && rows.every((r) => shortFigure(r).text === ownSum)) return null;
  return sharedPolicyText(note, person.name, "an amount listed below");
}
