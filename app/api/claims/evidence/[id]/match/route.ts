import { NextResponse } from "next/server";
import { devAccountId, isUuid } from "@/lib/db/client";
import { confirmCauseDefinitionMatch, ClaimEvidenceMatchError } from "@/lib/claims/evidence/matches";
import type { CauseDefinitionMatchResult } from "@/lib/claims/calculators/evidence";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

const RESULTS: CauseDefinitionMatchResult[] = ["matches", "does_not_match", "needs_review"];

/** The single, explicit reviewer action that can finalise a
 * CauseDefinitionMatch (see lib/claims/evidence/matches.ts's module doc
 * comment for why this -- never chat text, never model output -- is the
 * only path that can). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid claim-evidence document id." }, { status: 400 });
    const body = (await request.json()) as {
      familyMemberId?: string; claimSessionId?: string; contractId?: string; coverageId?: string | null;
      result?: string; reason?: string; reviewerName?: string;
      causeEvidence?: { pageStart?: number; pageEnd?: number; sourceLocation?: string };
    };
    if (!body.familyMemberId || !body.claimSessionId || !body.contractId) {
      return NextResponse.json({ error: "familyMemberId, claimSessionId and contractId are required." }, { status: 400 });
    }
    if (!body.result || !RESULTS.includes(body.result as CauseDefinitionMatchResult)) {
      return NextResponse.json({ error: "result must be one of matches, does_not_match, needs_review." }, { status: 400 });
    }

    const accountId = devAccountId();
    const reviewerName = (body.reviewerName ?? "Household reviewer").trim() || "Household reviewer";
    const match = await confirmCauseDefinitionMatch({
      accountId, reviewerName, familyMemberId: body.familyMemberId, claimSessionId: body.claimSessionId,
      evidenceDocumentId: id, contractId: body.contractId, coverageId: body.coverageId ?? null,
      result: body.result as CauseDefinitionMatchResult, reason: body.reason ?? null, causeEvidenceOverride: body.causeEvidence,
    });
    return NextResponse.json({ match });
  } catch (error) {
    if (error instanceof ClaimEvidenceMatchError) return NextResponse.json({ error: error.message, reasonCode: error.code }, { status: 409 });
    return NextResponse.json({ error: "Could not record the match decision." }, { status: 500 });
  }
}
