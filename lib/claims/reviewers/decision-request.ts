/**
 * Client-safe request building for the reviewer decision form. The form
 * offers exactly three choices; each maps to one of the target route's own
 * existing results. The body carries only the assignment id, the policy and
 * benefit the reviewer chose from the server-provided definitions list, the
 * result and the reason -- never a reviewer name, household, member or
 * claim (the server resolves all of those from the assignment).
 */
export type ReviewerDecisionChoice = "matches" | "does_not_match" | "needs_further_review";
export type ReviewerDefinitionRoute = "match" | "ci-match" | "disability-match" | "travel-match";

export const REVIEWER_DECISION_CHOICES: { value: ReviewerDecisionChoice; label: string }[] = [
  { value: "matches", label: "Matches the policy definition" },
  { value: "does_not_match", label: "Does not match the policy definition" },
  { value: "needs_further_review", label: "Needs further review or evidence" },
];

export const REVIEWER_REASON_MIN_LENGTH = 3;

export function resultForChoice(route: ReviewerDefinitionRoute, choice: ReviewerDecisionChoice): string {
  if (choice !== "needs_further_review") return choice;
  return route === "match" || route === "travel-match" ? "needs_review" : "insufficient_evidence";
}

export type ReviewerDecisionTarget = {
  route: ReviewerDefinitionRoute; contractId: string; coverageId: string;
  benefitCode?: string; illnessName?: string; matchKey?: string;
};

export function buildReviewerDecisionRequest(args: {
  assignmentId: string; evidenceDocumentId: string; target: ReviewerDecisionTarget; choice: ReviewerDecisionChoice | ""; reason: string;
}): { ok: true; url: string; body: Record<string, string> } | { ok: false; message: string } {
  if (!args.choice) return { ok: false, message: "Choose a decision." };
  const reason = args.reason.trim();
  if (reason.length < REVIEWER_REASON_MIN_LENGTH) return { ok: false, message: "Write the reason for this decision." };
  const { target } = args;
  const body: Record<string, string> = {
    assignmentId: args.assignmentId, contractId: target.contractId, coverageId: target.coverageId,
    result: resultForChoice(target.route, args.choice), reason,
  };
  if (target.benefitCode) body.benefitCode = target.benefitCode;
  if (target.illnessName) body.illnessName = target.illnessName;
  if (target.matchKey) body.matchKey = target.matchKey;
  return { ok: true, url: `/api/claims/evidence/${args.evidenceDocumentId}/${target.route}`, body };
}
