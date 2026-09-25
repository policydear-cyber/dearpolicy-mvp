import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { getClaimSession } from "@/lib/claims/session";
import { getScopedEvidenceDocument, getLatestExtraction, correctExtraction } from "@/lib/claims/evidence/store";
import { listClaimEvidenceAudit, appendClaimEvidenceAudit } from "@/lib/claims/evidence/audit";
import type { ClaimEvidenceExtractedFields } from "@/lib/claims/evidence/types";
import { householdEvidenceDocument } from "@/lib/claims/evidence/household-view";
import {
  DeletionValidationError,
  finishClaimEvidenceDeletion,
  requestClaimEvidenceDeletion,
} from "@/lib/lifecycle/coordinator";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

async function scopedDocument(request: NextRequest, id: string) {
  const ctx = await requireHouseholdContext(request);
  const url = new URL(request.url);
  const familyMemberId = url.searchParams.get("familyMemberId") ?? "";
  const claimSessionId = url.searchParams.get("claimSessionId") ?? "";
  if (!familyMemberId || !claimSessionId || !isUuid(id)) return { error: "familyMemberId and claimSessionId are required." as const, status: 400 as const };
  const session = await getClaimSession(ctx.householdId, familyMemberId, claimSessionId);
  if (!session) return { error: "Claim session not found for this family member." as const, status: 404 as const };
  const document = await getScopedEvidenceDocument({ accountId: ctx.householdId, familyMemberId, claimSessionId, id });
  if (!document) return { error: "Claim evidence document not found." as const, status: 404 as const };
  // userId is threaded through alongside accountId so DELETE (below) can
  // open its own RLS-scoped transaction via createUserSupabaseClient()
  // without re-resolving requireHouseholdContext() a second time -- GET/
  // PATCH simply ignore this extra field, unaffected by its addition.
  return { accountId: ctx.householdId, userId: ctx.userId, familyMemberId, claimSessionId, document };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const scoped = await scopedDocument(request, id);
    if ("error" in scoped) return NextResponse.json({ error: scoped.error }, { status: scoped.status });
    const [extraction, audit] = await Promise.all([
      getLatestExtraction(scoped.accountId, scoped.document.id),
      listClaimEvidenceAudit(scoped.accountId, scoped.claimSessionId),
    ]);
    return NextResponse.json({
      document: householdEvidenceDocument(scoped.document),
      extraction,
      audit: audit.filter((entry) => entry.evidence_document_id === scoped.document.id),
    });
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Could not load claim evidence." }, { status: 500 });
    return authResponse;
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Could not save the correction." }, { status: 500 });
    return authResponse;
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const scoped = await scopedDocument(request, id);
    if ("error" in scoped) return NextResponse.json({ error: scoped.error }, { status: scoped.status });

    const idempotencyKey = request.headers.get("idempotency-key") || `delete:${scoped.document.id}`;

    const outcome = await createUserSupabaseClient(scoped.userId, async (client) => {
      try {
        return await requestClaimEvidenceDeletion({
          client,
          accountId: scoped.accountId,
          actorUserId: scoped.userId,
          evidenceDocumentId: scoped.document.id,
          reasonCategory: "user_requested",
          idempotencyKey,
        });
      } catch (error) {
        if (error instanceof DeletionValidationError) return null;
        throw error;
      }
    });

    if (!outcome) return NextResponse.json({ error: "Claim evidence document not found." }, { status: 404 });

    if (outcome.status === "accepted") {
      await finishClaimEvidenceDeletion({
        accountId: scoped.accountId,
        actorUserId: scoped.userId,
        evidenceDocumentId: scoped.document.id,
        deletionRequestId: outcome.deletionRequestId,
      });
    }

    return NextResponse.json({
      deleted: true,
      id: scoped.document.id,
      filename: outcome.filename,
      affectedOpenClaimSessionIds: outcome.affectedOpenClaimSessionIds,
      deletionRequestId: outcome.deletionRequestId,
      status: outcome.status === "accepted" ? "completed" : outcome.status,
    });
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Could not delete the claim-evidence document." }, { status: 500 });
    return authResponse;
  }
}
