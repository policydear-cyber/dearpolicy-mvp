import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { appendPolicyUploadPart } from "@/lib/storage";
import { MAX_DOCUMENT_BYTES } from "../accept";
import { verifyUploadIntent } from "../intent-token";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** At most one part's worth (4 MB) plus slack; see start/route.ts. */
const MAX_PART_BYTES = 4 * 1024 * 1024 + 64 * 1024;

/**
 * Local storage driver only: receives one part of a direct upload. The
 * signed intent token names the object; the session must be the same
 * household and user the token was minted for. Parts are written strictly
 * in order and never past the declared size.
 */
export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const intent = verifyUploadIntent(request.headers.get("x-upload-token"));
    if (!intent || intent.driver !== "local" || intent.householdId !== ctx.householdId || intent.userId !== ctx.userId) {
      return NextResponse.json({ error: "This upload has expired. Choose the file again." }, { status: 403 });
    }
    const offset = Number(request.nextUrl.searchParams.get("offset"));
    if (!Number.isInteger(offset) || offset < 0) return NextResponse.json({ error: "Invalid upload part." }, { status: 400 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_PART_BYTES) return NextResponse.json({ error: "Invalid upload part." }, { status: 400 });
    if (offset + bytes.length > Math.min(intent.byteSize, MAX_DOCUMENT_BYTES)) return NextResponse.json({ error: "The file is larger than it said it was. Choose the file again." }, { status: 400 });
    try {
      const received = await appendPolicyUploadPart(intent.storageKey, offset, bytes);
      return NextResponse.json({ received });
    } catch {
      return NextResponse.json({ error: "Part of the upload went missing. Please try again.", reasonCode: "PART_OUT_OF_ORDER" }, { status: 409 });
    }
  } catch (error) {
    const authResponse = routeErrorResponse(error, { request, route: "/api/policies/upload/part" });
    if (authResponse.status === 500) return NextResponse.json({ error: "The upload was interrupted. Please try again." }, { status: 500 });
    return authResponse;
  }
}
