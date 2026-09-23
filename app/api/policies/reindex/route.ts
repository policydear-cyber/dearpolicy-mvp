import { NextResponse } from "next/server";
import { devAccountId } from "@/lib/db/client";
import { backfillSemanticIndex, semanticIndexState } from "@/lib/rag/backfill";

export const runtime = "nodejs";
// Sending a household's stored passages to Pinecone is quick per document, but
// a large library on a cold start should not be cut off half way.
export const maxDuration = 300;

/** How much of this household's library semantic search can actually see. */
export async function GET() {
  try {
    return NextResponse.json(await semanticIndexState(devAccountId()));
  } catch {
    return NextResponse.json({ enabled: false, total: 0, indexed: 0, pending: 0 });
  }
}

export async function POST() {
  try {
    const result = await backfillSemanticIndex(devAccountId());
    const state = await semanticIndexState(devAccountId());
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
