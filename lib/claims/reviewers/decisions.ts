/**
 * Records one assigned reviewer's policy-definition decision through the
 * existing, unchanged confirm*Match() functions. Called by the four match
 * routes only AFTER requireAssignedClaimReviewer() (lib/claims/reviewers/
 * boundary.ts) has resolved the household, family member, claim, evidence
 * document, contract and coverage from the reviewer's own assignment -- so
 * nothing below reads any of those from the request. The request supplies
 * only the decision itself (result + a required reason) and, for critical
 * illness and disability, which of the policy's own benefits it is about;
 * those are still checked verbatim against the policy's current wording by
 * the confirm*Match() functions.
 *
 * Never accepted from a request: reviewer name or id, household, family
 * member, claim, evidence page overrides, policy wording, amounts or model
 * provenance.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { CauseDefinitionMatchResult, CIDefinitionMatchResult, DisabilityDefinitionMatchResult } from "@/lib/claims/calculators/evidence";
import type { DisabilityBenefitCode } from "@/lib/claims/disability-evidence";
import { POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE } from "@/lib/claims/evidence/document-catalogue";
import { confirmCauseDefinitionMatch, ClaimEvidenceMatchError as CauseMatchError } from "@/lib/claims/evidence/matches";
import { confirmCIDefinitionMatch, ClaimEvidenceMatchError as CIMatchError } from "@/lib/claims/evidence/ci-matches";
import { confirmDisabilityDefinitionMatch, ClaimEvidenceMatchError as DisabilityMatchError } from "@/lib/claims/evidence/disability-matches";
import { confirmTravelDeathMatch, ClaimEvidenceMatchError as TravelMatchError } from "@/lib/claims/evidence/travel-matches";
import { appendReviewerAudit } from "./audit";
import { ReviewAssignmentNotFoundError, type AssignedClaimReview } from "./boundary";
import { INDICATIVE_ESTIMATE_NOTICE } from "./copy";

export type DefinitionDecisionRoute = "match" | "ci-match" | "disability-match" | "travel-match";

/** What a household member (or anyone who is not an active reviewer) gets
 * from a definition-match route: the same response as before reviewers
 * existed. */
export const DEFINITION_REVIEW_DENIED = { error: POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE, reasonCode: "POLICY_DEFINITION_REVIEW_REQUIRED" };

export const CAUSE_RESULTS: readonly CauseDefinitionMatchResult[] = ["matches", "does_not_match", "needs_review"];
export const MEDICAL_DEFINITION_RESULTS: readonly (CIDefinitionMatchResult & DisabilityDefinitionMatchResult)[] = [
  "matches", "does_not_match", "needs_medical_review", "needs_policy_review", "insufficient_evidence", "ambiguous",
];
const CI_BENEFIT_CODES = ["ci-major", "ci-early", "ci-intermediate"] as const;
const DISABILITY_BENEFIT_CODES: readonly DisabilityBenefitCode[] = ["tpd-lump-sum", "ppd-schedule", "di-monthly"];
export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 2000;

/** Tolerant body read: a missing or malformed body is just an empty one,
 * so the authorization boundary -- not a JSON parse error -- decides what a
 * caller who is not an assigned reviewer sees. */
export async function readDecisionBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function validateDecisionReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= REASON_MIN_LENGTH && reason.length <= REASON_MAX_LENGTH ? reason : null;
}

const badRequest = (error: string, reasonCode: string) => NextResponse.json({ error, reasonCode }, { status: 400 });
const isMatchError = (error: unknown): error is { code: string; message: string } =>
  error instanceof CauseMatchError || error instanceof CIMatchError || error instanceof DisabilityMatchError || error instanceof TravelMatchError;

export async function recordReviewerDefinitionDecision(
  review: AssignedClaimReview,
  route: DefinitionDecisionRoute,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const document = review.evidenceDocument;
  const coverage = review.coverage;
  if (!document || !coverage) throw new ReviewAssignmentNotFoundError("Review assignment not found.");

  const reason = validateDecisionReason(body.reason);
  if (!reason) return badRequest(`A reason of ${REASON_MIN_LENGTH}-${REASON_MAX_LENGTH} characters is required for every decision.`, "REASON_REQUIRED");
  const result = typeof body.result === "string" ? body.result : "";
  const allowed: readonly string[] = route === "match" || route === "travel-match" ? CAUSE_RESULTS : MEDICAL_DEFINITION_RESULTS;
  if (!allowed.includes(result)) return badRequest(`result must be one of ${allowed.join(", ")}.`, "INVALID_RESULT");

  const common = {
    accountId: review.accountId,
    reviewerName: review.reviewerIdentity,
    familyMemberId: review.familyMemberId,
    claimSessionId: review.claimSessionId,
    evidenceDocumentId: document.id,
    contractId: coverage.policyId,
    // Validated by the boundary: either absent, or exactly this coverage.
    coverageId: typeof body.coverageId === "string" ? coverage.id : null,
    reason,
  };
  const scope: Record<string, string> = {};
  try {
    let match: { id: string; reviewed_at: string; result: string };
    if (route === "match") {
      match = await confirmCauseDefinitionMatch({ ...common, result: result as CauseDefinitionMatchResult });
    } else if (route === "travel-match") {
      match = await confirmTravelDeathMatch({ ...common, result: result as CauseDefinitionMatchResult });
    } else if (route === "ci-match") {
      const benefitCode = CI_BENEFIT_CODES.find((c) => c === body.benefitCode);
      const illnessName = typeof body.illnessName === "string" ? body.illnessName.trim() : "";
      if (!benefitCode) return badRequest("benefitCode must be one of ci-major, ci-early, ci-intermediate.", "INVALID_BENEFIT");
      if (!illnessName) return badRequest("illnessName must name the exact condition in the policy's own wording.", "INVALID_BENEFIT");
      Object.assign(scope, { benefitCode, illnessName });
      match = await confirmCIDefinitionMatch({ ...common, benefitCode, illnessName, result: result as CIDefinitionMatchResult });
    } else {
      const benefitCode = DISABILITY_BENEFIT_CODES.find((c) => c === body.benefitCode);
      const matchKey = typeof body.matchKey === "string" ? body.matchKey.trim() : "";
      if (!benefitCode) return badRequest("benefitCode must be one of tpd-lump-sum, ppd-schedule, di-monthly.", "INVALID_BENEFIT");
      if (!matchKey) return badRequest("matchKey must name the exact benefit row in the policy's own wording.", "INVALID_BENEFIT");
      Object.assign(scope, { benefitCode, matchKey });
      match = await confirmDisabilityDefinitionMatch({ ...common, benefitCode, matchKey, result: result as DisabilityDefinitionMatchResult });
    }

    await appendReviewerAudit({
      actor: review.reviewerIdentity, action: "definition_decision_recorded", reviewerUserId: review.userId,
      assignmentId: review.assignmentId, accountId: review.accountId, claimSessionId: review.claimSessionId, evidenceDocumentId: document.id,
      details: { route, result, matchId: match.id, contractId: common.contractId, coverageId: common.coverageId, ...scope },
    });
    return NextResponse.json({ match: { id: match.id, result: match.result, reviewedAt: match.reviewed_at }, notice: INDICATIVE_ESTIMATE_NOTICE });
  } catch (error) {
    if (isMatchError(error)) return NextResponse.json({ error: error.message, reasonCode: error.code }, { status: 409 });
    throw error;
  }
}
