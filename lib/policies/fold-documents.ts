/** What a Documents card needs the household to answer. A long library folds only the cards with nothing to answer, so a card
 * that asks (who it is for, which plan, a failed or partial reading, a review flag) is never behind the fold (TE #657).
 * Pure and import-free, so a test can run it. Anything unknown counts as "asks": the fold is the exception, not the rule. */
export type FoldFacts = {
  /** Still reading, held by the scan, or rejected by it. */
  busy: boolean;
  /** Not "ready" on the card's read label (failed, read in part, and so on). */
  notReadyLabel: boolean;
  needsReview: boolean;
  /** Ready, so the Covers picker and the benefits line are shown. */
  ready: boolean;
  hasProcessingError: boolean;
  /** An unplaced printed name, a name matched only by part, or an upload choice overridden by the names printed in it. */
  asksWho: boolean;
  /** The "who is this" block is shown instead of the Covers picker. */
  whoIsThisBlock: boolean;
  coveredCount: number;
  referenceLinkCount: number;
  planMissing: boolean;
  /** The benefit reading has any state at all (reading, failed, backed off). */
  benefitState: boolean;
};

export function canFold(f: FoldFacts): boolean {
  if (!f.ready || f.busy || f.notReadyLabel || f.needsReview || f.hasProcessingError) return false;
  if (f.asksWho || f.benefitState) return false;
  if (f.whoIsThisBlock) return true;
  return (f.coveredCount > 0 || f.referenceLinkCount > 0) && !f.planMissing;
}
