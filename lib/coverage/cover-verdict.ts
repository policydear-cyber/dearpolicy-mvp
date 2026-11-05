/** The one answer Home's tile and the Coverage page give for a person and a cover (UI/UX 5 Nov: Home said "Not found"
 * where Coverage said "Covered"). Both pages count the same evidence, read from released, current documents only
 * (lib/policies/trusted.ts):
 *  - "covered": a schedule line matched to its page on the person's own document, a benefit of a plan they own described
 *    in its wording, a benefit-table row of theirs, or a whole-policy kind (travel, savings, investment);
 *  - "on_file": nothing of that, but a schedule line not yet matched to its page, or wording about the product linked to
 *    the person with no plan of theirs that it describes. The person is asked to confirm; no amount is ever shown for it,
 *    and it is never counted as their cover;
 *  - "not_found": none of these. */
export type CoverVerdict = "covered" | "on_file" | "not_found";
export type CoverEvidence = { proven: number; unmatchedLines: number; referenceOnly: number };
export function coverVerdict(e: CoverEvidence): CoverVerdict {
  if (e.proven > 0) return "covered";
  return e.unmatchedLines > 0 || e.referenceOnly > 0 ? "on_file" : "not_found";
}
/** Whether a stored schedule line is proof: confirmed and matched to the words on its page. */
export const provenLine = (r: { confirmed?: boolean | null; evidence_verified?: boolean | null }) => r.confirmed === true && r.evidence_verified === true;
