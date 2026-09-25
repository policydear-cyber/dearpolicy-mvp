import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { getClaimSession } from "@/lib/claims/session";
import { listEvidenceDocuments, getLatestExtraction } from "@/lib/claims/evidence/store";
import { documentTypeGroup } from "@/lib/claims/evidence/document-catalogue";
import { loadHouseholdReviewStatuses } from "@/lib/claims/reviewers/status";
import { householdEvidenceDocument } from "@/lib/claims/evidence/household-view";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const url = new URL(request.url);
    const familyMemberId = url.searchParams.get("familyMemberId") ?? "";
    const claimSessionId = url.searchParams.get("claimSessionId") ?? "";
    if (!familyMemberId || !claimSessionId) return NextResponse.json({ error: "familyMemberId and claimSessionId are required." }, { status: 400 });

    const session = await getClaimSession(ctx.householdId, familyMemberId, claimSessionId);
    if (!session) return NextResponse.json({ error: "Claim session not found for this family member." }, { status: 404 });

    const documents = await listEvidenceDocuments(ctx.householdId, claimSessionId);
    // Policy-definition documents (everything except bills, which the
    // household reviews itself) carry one of four review statuses. Nothing
    // about the reviewer -- identity, notes, reasons -- is ever included.
    const definitionDocumentIds = documents.filter((doc) => documentTypeGroup(doc.document_type) !== "bills_and_settlements").map((doc) => doc.id);
    const reviewStatuses = await loadHouseholdReviewStatuses(ctx.householdId, claimSessionId, definitionDocumentIds);
    const withExtractions = await Promise.all(documents.map(async (doc) => ({
      ...householdEvidenceDocument(doc),
      extraction: await getLatestExtraction(ctx.householdId, doc.id),
      reviewStatus: reviewStatuses.get(doc.id) ?? null,
    })));
    return NextResponse.json({ documents: withExtractions });
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Could not load claim evidence." }, { status: 500 });
    return authResponse;
  }
}
