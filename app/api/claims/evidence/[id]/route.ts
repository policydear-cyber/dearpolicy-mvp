import { NextResponse } from "next/server";
import { devAccountId, isUuid } from "@/lib/db/client";
import { getClaimSession } from "@/lib/claims/session";
import { getScopedEvidenceDocument, getLatestExtraction, correctExtraction } from "@/lib/claims/evidence/store";
import { listClaimEvidenceAudit, appendClaimEvidenceAudit } from "@/lib/claims/evidence/audit";
import type { ClaimEvidenceExtractedFields } from "@/lib/claims/evidence/types";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

async function scopedDocument(request: Request, id: string) {
  const url = new URL(request.url);
  const familyMemberId = url.searchParams.get("familyMemberId") ?? "";
  const claimSessionId = url.searchParams.get("claimSessionId") ?? "";
  if (!familyMemberId || !claimSessionId || !isUuid(id)) return { error: "familyMemberId and claimSessionId are required." as const, status: 400 as const };
  const accountId = devAccountId();
  const session = await getClaimSession(accountId, familyMemberId, claimSessionId);
  if (!session) return { error: "Claim session not found for this family member." as const, status: 404 as const };
  const document = await getScopedEvidenceDocument({ accountId, familyMemberId, claimSessionId, id });
  if (!document) return { error: "Claim evidence document not found." as const, status: 404 as const };
  return { accountId, familyMemberId, claimSessionId, document };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const scoped = await scopedDocument(request, id);
    if ("error" in scoped) return NextResponse.json({ error: scoped.error }, { status: scoped.status });
    const [extraction, audit] = await Promise.all([
      getLatestExtraction(scoped.accountId, scoped.document.id),
      listClaimEvidenceAudit(scoped.accountId, scoped.claimSessionId),
    ]);
    return NextResponse.json({
      document: scoped.document,
      extraction,
      audit: audit.filter((entry) => entry.evidence_document_id === scoped.document.id),
    });
  } catch {
    return NextResponse.json({ error: "Could not load claim evidence." }, { status: 500 });
  }
}

/** A reviewer correcting or rejecting one or more extracted fields. The
 * model's own proposal (extraction.extracted_fields) is never overwritten
 * -- the correction is stored separately (reviewed_fields) and audited, so
 * both what the model said and what the reviewer decided stay inspectable. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const scoped = await scopedDocument(request, id);
    if ("error" in scoped) return NextResponse.json({ error: scoped.error }, { status: scoped.status });
    const body = (await request.json()) as { reviewedFields?: Partial<ClaimEvidenceExtractedFields>; reviewerName?: string };
    if (!body.reviewedFields || typeof body.reviewedFields !== "object") return NextResponse.json({ error: "reviewedFields is required." }, { status: 400 });

    const extraction = await getLatestExtraction(scoped.accountId, scoped.document.id);
    if (!extraction) return NextResponse.json({ error: "This document has not been read yet." }, { status: 409 });

    const reviewerName = (body.reviewerName ?? "Household reviewer").trim() || "Household reviewer";
    const updated = await correctExtraction({ accountId: scoped.accountId, extractionId: extraction.id, reviewedFields: body.reviewedFields, reviewedBy: reviewerName });
    await appendClaimEvidenceAudit(scoped.accountId, {
      actor: reviewerName, action: "extraction_corrected", evidenceDocumentId: scoped.document.id, claimSessionId: scoped.claimSessionId,
      previousValue: extraction.extracted_fields, newValue: body.reviewedFields,
    });
    return NextResponse.json({ extraction: updated });
  } catch {
    return NextResponse.json({ error: "Could not save the correction." }, { status: 500 });
  }
}
