import { NextResponse } from "next/server";
import { devAccountId, isUuid } from "@/lib/db/client";
import { confirmMedicalBillReview, MedicalBillEvidenceError } from "@/lib/claims/evidence/medical-bill-evidence";
import type { ClaimEvidenceExtractedFields } from "@/lib/claims/evidence/types";

export const runtime = "nodejs";

/** The single, explicit reviewer action that can move a medical-claim bill
 * document to "matched" and make its figures usable by
 * loadVerifiedMedicalBillFacts() -- never chat text, never model output.
 * See lib/claims/evidence/medical-bill-evidence.ts's own module doc
 * comment for why a medical-claim bill needs no separate per-benefit match
 * table the way lib/claims/evidence/ci-matches.ts's CI definition match
 * does. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid claim-evidence document id." }, { status: 400 });
    const body = (await request.json()) as {
      familyMemberId?: string; claimSessionId?: string;
      reviewedFields?: Partial<ClaimEvidenceExtractedFields>;
      reason?: string; reviewerName?: string;
    };
    if (!body.familyMemberId || !body.claimSessionId) {
      return NextResponse.json({ error: "familyMemberId and claimSessionId are required." }, { status: 400 });
    }

    const accountId = devAccountId();
    const reviewerName = (body.reviewerName ?? "Household reviewer").trim() || "Household reviewer";
    const result = await confirmMedicalBillReview({
      accountId, reviewerName, familyMemberId: body.familyMemberId, claimSessionId: body.claimSessionId,
      evidenceDocumentId: id, reviewedFields: body.reviewedFields, reason: body.reason ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MedicalBillEvidenceError) return NextResponse.json({ error: error.message, reasonCode: error.code }, { status: 409 });
    return NextResponse.json({ error: "Could not record the medical-bill review." }, { status: 500 });
  }
}
