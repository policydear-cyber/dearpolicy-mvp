/** User-facing wording shared by the reviewer area, the reviewer API and
 * the household claim page. Kept free of any promise that an amount will be
 * paid (scripts/claim-reviewer-authorization-regressions.ts checks it). */
export const INDICATIVE_ESTIMATE_NOTICE =
  "Any amount DearPolicy shows after this review is an indicative estimate from the policy wording only. The insurer makes every claim decision.";

export type HouseholdReviewStatus = "awaiting_assignment" | "in_review" | "more_evidence_required" | "reviewed";

export const HOUSEHOLD_REVIEW_STATUS_COPY: Record<HouseholdReviewStatus, { label: string; detail: string }> = {
  awaiting_assignment: {
    label: "Awaiting reviewer",
    detail: "A DearPolicy reviewer has not been assigned to this document yet.",
  },
  in_review: {
    label: "In review",
    detail: "A DearPolicy reviewer is checking this document against your policy's own definition.",
  },
  more_evidence_required: {
    label: "More evidence needed",
    detail: "The reviewer could not settle this from the documents so far. Adding a clearer or more detailed document may help.",
  },
  reviewed: {
    label: "Reviewed",
    detail: "The policy-definition review is done. Any estimate appears with your claim; it is indicative only and the insurer makes every claim decision.",
  },
};
