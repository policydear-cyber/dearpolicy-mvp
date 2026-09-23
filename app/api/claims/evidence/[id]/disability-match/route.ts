import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { confirmDisabilityDefinitionMatch, ClaimEvidenceMatchError } from "@/lib/claims/evidence/disability-matches";
import type { DisabilityDefinitionMatchResult } from "@/lib/claims/calculators/evidence";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

const RESULTS: DisabilityDefinitionMatchResult[] = ["matches", "does_not_match", "needs_medical_review", "needs_policy_review", "insufficient_evidence", "ambiguous"];
const BENEFIT_CODES = ["tpd-lump-sum", "ppd-schedule", "di-monthly"] as const;

/** The single, explicit reviewer action that can finalise a
 * DisabilityDefinitionMatch (see lib/claims/evidence/disability-matches.ts's
 * module doc comment for why this -- never chat text, never model output,
 * and never a fuzzy injury-to-schedule-row match -- is the only path that
 * can). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid claim-evidence document id." }, { status: 400 });
    const ctx = await requireHouseholdContext(request);
    const body = (await request.json()) as {
      familyMemberId?: string; claimSessionId?: string; contractId?: string; coverageId?: string | null;
      benefitCode?: string; matchKey?: string;
      result?: string; reason?: string; reviewerName?: string;
      medicalEvidence?: { pageStart?: number; pageEnd?: number; sourceLocation?: string };
    };
    if (!body.familyMemberId || !body.claimSessionId || !body.contractId) {
      return NextResponse.json({ error: "familyMemberId, claimSessionId and contractId are required." }, { status: 400 });
    }
    if (!body.benefitCode || !BENEFIT_CODES.includes(body.benefitCode as (typeof BENEFIT_CODES)[number])) {
      return NextResponse.json({ error: "benefitCode must be one of tpd-lump-sum, ppd-schedule, di-monthly." }, { status: 400 });
    }
    if (!body.matchKey || !body.matchKey.trim()) {
      return NextResponse.json({ error: "matchKey is required and must name the exact, already-evidenced definition or schedule row this decision is scoped to." }, { status: 400 });
    }
    if (!body.result || !RESULTS.includes(body.result as DisabilityDefinitionMatchResult)) {
      return NextResponse.json({ error: "result must be one of matches, does_not_match, needs_medical_review, needs_policy_review, insufficient_evidence, ambiguous." }, { status: 400 });
    }

    const reviewerName = (body.reviewerName ?? "Household reviewer").trim() || "Household reviewer";
    const match = await confirmDisabilityDefinitionMatch({
      accountId: ctx.householdId, reviewerName, familyMemberId: body.familyMemberId, claimSessionId: body.claimSessionId,
      evidenceDocumentId: id, contractId: body.contractId, coverageId: body.coverageId ?? null,
      benefitCode: body.benefitCode as (typeof BENEFIT_CODES)[number], matchKey: body.matchKey.trim(),
      result: body.result as DisabilityDefinitionMatchResult, reason: body.reason ?? null, medicalEvidenceOverride: body.medicalEvidence,
    });
    return NextResponse.json({ match });
  } catch (error) {
    if (error instanceof ClaimEvidenceMatchError) return NextResponse.json({ error: error.message, reasonCode: error.code }, { status: 409 });
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Could not record the match decision." }, { status: 500 });
    return authResponse;
  }
}
