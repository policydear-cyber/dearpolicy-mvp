import { NextResponse } from "next/server";
import { devAccountId } from "@/lib/db/client";
import { getClaimSession } from "@/lib/claims/session";
import { listEvidenceDocuments } from "@/lib/claims/evidence/store";
import { getLatestExtraction } from "@/lib/claims/evidence/store";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const familyMemberId = url.searchParams.get("familyMemberId") ?? "";
    const claimSessionId = url.searchParams.get("claimSessionId") ?? "";
    if (!familyMemberId || !claimSessionId) return NextResponse.json({ error: "familyMemberId and claimSessionId are required." }, { status: 400 });

    const accountId = devAccountId();
    const session = await getClaimSession(accountId, familyMemberId, claimSessionId);
    if (!session) return NextResponse.json({ error: "Claim session not found for this family member." }, { status: 404 });

    const documents = await listEvidenceDocuments(accountId, claimSessionId);
    const withExtractions = await Promise.all(documents.map(async (doc) => ({
      ...doc,
      extraction: await getLatestExtraction(accountId, doc.id),
    })));
    return NextResponse.json({ documents: withExtractions });
  } catch {
    return NextResponse.json({ error: "Could not load claim evidence." }, { status: 500 });
  }
}
