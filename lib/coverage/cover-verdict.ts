/** The one answer Home's tile and the Coverage page give for a person and a cover (UI/UX 5 Nov: Home said "Not found"
 * where Coverage said "Covered"). Both pages count the same evidence, read from released, current documents only
 * (lib/policies/trusted.ts):
 *  - "covered": a schedule line matched to its page on the person's own document, a benefit of a plan they own described
 *    in its wording, a benefit-table row of theirs, or a whole-policy kind (travel, savings, investment);
 *    It is also "covered" by a schedule line whose figure is not confirmed but whose own quote and person are printed on
 *    its page (lib/coverage/held-line.ts): the cover is held, and its figure is never shown as the amount;
 *  - "on_file": nothing of that, but a schedule line that proves nothing on its page, or wording about the product linked
 *    to the person with no plan of theirs that it describes. Home shows no card for it (DC 16 Nov: covered or not, no
 *    "please confirm"); Coverage lists it without an amount, and it is never counted as their cover;
 *  - "not_found": none of these. */
export type CoverVerdict = "covered" | "on_file" | "not_found";
export type CoverEvidence = { proven: number; unmatchedLines: number; referenceOnly: number; held?: number };
export function coverVerdict(e: CoverEvidence): CoverVerdict {
  if (e.proven > 0 || (e.held ?? 0) > 0) return "covered";
  return e.unmatchedLines > 0 || e.referenceOnly > 0 ? "on_file" : "not_found";
}
/** Whether a stored schedule line is proof: confirmed and matched to the words on its page. */
export const provenLine = (r: { confirmed?: boolean | null; evidence_verified?: boolean | null }) => r.confirmed === true && r.evidence_verified === true;
