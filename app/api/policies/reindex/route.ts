import { NextResponse } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { backfillSemanticIndex, semanticIndexState } from "@/lib/rag/backfill";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
// Sending a household's stored passages to Pinecone is quick per document, but
// a large library on a cold start should not be cut off half way.
export const maxDuration = 300;

/** How much of this household's library semantic search can actually see. */
export async function GET() {
  let householdId: string;
  try {
    householdId = (await requireHouseholdContext()).householdId;
  } catch (error) {
    return routeErrorResponse(error);
  }
  try {
    return NextResponse.json(await semanticIndexState(householdId));
  } catch {
    return NextResponse.json({ enabled: false, total: 0, indexed: 0, pending: 0 });
  }
}

export async function POST() {
  let householdId: string;
  try {
    householdId = (await requireHouseholdContext()).householdId;
  } catch (error) {
    return routeErrorResponse(error);
  }
  try {
    const result = await backfillSemanticIndex(householdId);
    const state = await semanticIndexState(householdId);
    return NextResponse.json({ ...result, state });
  } catch (error) {
    // The underlying failure (a Pinecone/embedding-provider error, a
    // malformed API response, etc.) can carry provider-internal detail that
    // has no business reaching the browser -- log it server-side and hand
    // back a message that says only what the household can act on.
    console.error("Semantic index backfill failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not build the search index." }, { status: 500 });
  }
}
