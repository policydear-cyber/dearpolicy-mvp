import type { NextRequest } from "next/server";
import { requireAssignedClaimReviewer, reviewerRouteErrorResponse } from "@/lib/claims/reviewers/boundary";
import { DEFINITION_REVIEW_DENIED, readDecisionBody, recordReviewerDefinitionDecision } from "@/lib/claims/reviewers/decisions";

export const runtime = "nodejs";
export const ROUTE_AUTH = "internal-reviewer" as const;

/** Disability policy-definition decision (lib/claims/evidence/disability-matches.ts).
 *
 * A "matches" record is what lets a calculator unlock an amount, so only an
 * assigned DearPolicy reviewer may record any decision here -- never a
 * household owner or member (they receive POLICY_DEFINITION_REVIEW_REQUIRED,
 * exactly as before reviewers existed). requireAssignedClaimReviewer()
 * resolves the household, family member, claim, this document, the contract
 * and the coverage from the reviewer's own active assignment; the body may
 * only name them, and any name outside that assignment is refused with the
 * same 404. The reviewer identity recorded is always the authenticated
 * user's; any reviewer name, household, member or claim id in the body is
 * ignored. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readDecisionBody(request);
    const review = await requireAssignedClaimReviewer({
      assignmentId: body.assignmentId, evidenceDocumentId: id, contractId: body.contractId, coverageId: body.coverageId,
    });
    return await recordReviewerDefinitionDecision(review, "disability-match", body);
  } catch (error) {
    return reviewerRouteErrorResponse(error, { request, deniedBody: DEFINITION_REVIEW_DENIED });
  }
}
