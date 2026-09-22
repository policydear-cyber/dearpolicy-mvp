import { NextResponse } from "next/server";
import { devAccountId, isUuid } from "@/lib/db/client";
import { confirmCIDefinitionMatch, ClaimEvidenceMatchError } from "@/lib/claims/evidence/ci-matches";
import type { CIDefinitionMatchResult } from "@/lib/claims/calculators/evidence";

export const runtime = "nodejs";

const RESULTS: CIDefinitionMatchResult[] = ["matches", "does_not_match", "needs_medical_review", "needs_policy_review", "insufficient_evidence", "ambiguous"];
const BENEFIT_CODES = ["ci-major", "ci-early", "ci-intermediate"] as const;

/** The single, explicit reviewer action that can finalise a
 * CIDefinitionMatch (see lib/claims/evidence/ci-matches.ts's module doc
 * comment for why this -- never chat text, never model output -- is the
 * only path that can). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid claim-evidence document id." }, { status: 400 });
    const body = (await request.json()) as {
      familyMemberId?: string; claimSessionId?: string; contractId?: string; coverageId?: string | null;
      benefitCode?: string; illnessName?: string;
      result?: string; reason?: string; reviewerName?: string;
      medicalEvidence?: { pageStart?: number; pageEnd?: number; sourceLocation?: string };
    };
    if (!body.familyMemberId || !body.claimSessionId || !body.contractId) {
      return NextResponse.json({ error: "familyMemberId, claimSessionId and contractId are required." }, { status: 400 });
    }
    if (!body.benefitCode || !BENEFIT_CODES.includes(body.benefitCode as (typeof BENEFIT_CODES)[number])) {
      return NextResponse.json({ error: "benefitCode must be one of ci-major, ci-early, ci-intermediate." }, { status: 400 });
    }
    if (!body.illnessName || !body.illnessName.trim()) {
      return NextResponse.json({ error: "illnessName is required and must name the exact condition this decision is scoped to." }, { status: 400 });
    }
    if (!body.result || !RESULTS.includes(body.result as CIDefinitionMatchResult)) {
      return NextResponse.json({ error: "result must be one of matches, does_not_match, needs_medical_review, needs_policy_review, insufficient_evidence, ambiguous." }, { status: 400 });
    }

    const accountId = devAccountId();
    const reviewerName = (body.reviewerName ?? "Household reviewer").trim() || "Household reviewer";
    const match = await confirmCIDefinitionMatch({
      accountId, reviewerName, familyMemberId: body.familyMemberId, claimSessionId: body.claimSessionId,
      evidenceDocumentId: id, contractId: body.contractId, coverageId: body.coverageId ?? null,
      benefitCode: body.benefitCode as (typeof BENEFIT_CODES)[number], illnessName: body.illnessName.trim(),
      result: body.result as CIDefinitionMatchResult, reason: body.reason ?? null, medicalEvidenceOverride: body.medicalEvidence,
    });
    return NextResponse.json({ match });
  } catch (error) {
    if (error instanceof ClaimEvidenceMatchError) return NextResponse.json({ error: error.message, reasonCode: error.code }, { status: 409 });
    return NextResponse.json({ error: "Could not record the match decision." }, { status: 500 });
  }
}
