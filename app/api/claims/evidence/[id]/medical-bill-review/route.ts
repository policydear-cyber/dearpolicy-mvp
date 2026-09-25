import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { confirmMedicalBillReview, MedicalBillEvidenceError } from "@/lib/claims/evidence/medical-bill-evidence";
import { validateBillReviewFields } from "@/lib/claims/evidence/bill-review-validation";
import { householdReviewerIdentity } from "@/lib/claims/evidence/reviewer";
import type { ClaimEvidenceExtractedFields } from "@/lib/claims/evidence/types";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** A household member's confirmation (with optional corrections) of the
 * facts printed on ONE medical-claim bill document -- transcription review,
 * not a policy-definition decision. This is the single explicit action that
 * moves a bill document to "matched" so loadVerifiedMedicalBillFacts() may
 * use it; every downstream monetary gate (verified extraction provenance,
 * deterministic amount parsing, the calculators themselves) still applies.
 *
 * Hardening: the reviewer identity is derived from the authenticated
 * request, never taken from the body; only bill-fact fields can be
 * corrected, each validated server-side (amounts must parse exactly as
 * printed); and the caller must explicitly confirm the transcription. The
 * document itself is resolved through the full ownership chain (household +
 * family member + claim) inside confirmMedicalBillReview(). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid claim-evidence document id." }, { status: 400 });
    const ctx = await requireHouseholdContext(request);
    const body = (await request.json().catch(() => ({}))) as {
      familyMemberId?: string; claimSessionId?: string; reviewedFields?: unknown; reason?: string; confirmTranscription?: unknown;
    };
    if (!body.familyMemberId || !body.claimSessionId || !isUuid(body.familyMemberId) || !isUuid(body.claimSessionId)) {
      return NextResponse.json({ error: "familyMemberId and claimSessionId are required." }, { status: 400 });
    }
    if (body.confirmTranscription !== true) {
      return NextResponse.json({ error: "Confirm that you have checked these details against the document.", reasonCode: "CONFIRMATION_REQUIRED" }, { status: 400 });
    }
    let reviewedFields: Partial<ClaimEvidenceExtractedFields> | undefined;
    if (body.reviewedFields !== undefined) {
      const validation = validateBillReviewFields(body.reviewedFields);
      if (!validation.ok) {
        return NextResponse.json({ error: "Some details need fixing before they can be saved.", reasonCode: "INVALID_REVIEWED_FIELDS", fieldErrors: validation.fieldErrors }, { status: 400 });
      }
      reviewedFields = validation.fields;
    }

    const result = await confirmMedicalBillReview({
      accountId: ctx.householdId, reviewerName: householdReviewerIdentity(ctx.userId),
      familyMemberId: body.familyMemberId, claimSessionId: body.claimSessionId,
      evidenceDocumentId: id, reviewedFields, reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MedicalBillEvidenceError) return NextResponse.json({ error: error.message, reasonCode: error.code }, { status: 409 });
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Could not record the medical-bill review." }, { status: 500 });
    return authResponse;
  }
}
