import { NextResponse } from "next/server";
import { devAccountId, isUuid } from "@/lib/db/client";
import { getClaimSession } from "@/lib/claims/session";
import { getScopedEvidenceDocument, transitionEvidenceStatus } from "@/lib/claims/evidence/store";
import { appendClaimEvidenceAudit } from "@/lib/claims/evidence/audit";
import { InvalidEvidenceTransitionError } from "@/lib/claims/evidence/state-machine";

export const runtime = "nodejs";

/** A reviewer rejecting the DOCUMENT itself (wrong file, unreadable,
 * unrelated) -- distinct from rejecting a policy-specific MATCH (see
 * ../match/route.ts): rejecting the document here means DearPolicy should
 * stop treating it as usable evidence at all. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid claim-evidence document id." }, { status: 400 });
    const body = (await request.json().catch(() => ({}))) as { familyMemberId?: string; claimSessionId?: string; reason?: string; reviewerName?: string };
    if (!body.familyMemberId || !body.claimSessionId) return NextResponse.json({ error: "familyMemberId and claimSessionId are required." }, { status: 400 });

    const accountId = devAccountId();
    const session = await getClaimSession(accountId, body.familyMemberId, body.claimSessionId);
    if (!session) return NextResponse.json({ error: "Claim session not found for this family member." }, { status: 404 });
    const document = await getScopedEvidenceDocument({ accountId, familyMemberId: body.familyMemberId, claimSessionId: body.claimSessionId, id });
    if (!document) return NextResponse.json({ error: "Claim evidence document not found." }, { status: 404 });

    const reviewerName = (body.reviewerName ?? "Household reviewer").trim() || "Household reviewer";
    const moved = await transitionEvidenceStatus({ accountId, id, from: document.status, to: "rejected", errorMessage: body.reason ?? null });
    if (!moved) return NextResponse.json({ error: "This document cannot be rejected from its current status." }, { status: 409 });
    await appendClaimEvidenceAudit(accountId, {
      actor: reviewerName, action: "rejected", evidenceDocumentId: id, claimSessionId: body.claimSessionId,
      previousValue: { status: document.status }, newValue: { status: "rejected" }, reason: body.reason ?? undefined,
    });
    return NextResponse.json({ document: moved });
  } catch (error) {
    if (error instanceof InvalidEvidenceTransitionError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Could not reject this document." }, { status: 500 });
  }
}
