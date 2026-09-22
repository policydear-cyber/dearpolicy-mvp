import { NextResponse } from "next/server";
import { devAccountId, isUuid } from "@/lib/db/client";
import { getClaimSession } from "@/lib/claims/session";
import { getScopedEvidenceDocument } from "@/lib/claims/evidence/store";
import { readClaimEvidenceFile, createClaimEvidenceSignedUrl } from "@/lib/storage";

export const runtime = "nodejs";

/** Never a public URL. On the Supabase driver this redirects to a
 * short-lived signed URL (see lib/storage/supabase.ts); on local disk,
 * where there is no such thing, it streams the bytes itself after
 * re-checking the full account/family-member/claim ownership chain on
 * every single request -- there is no cached, reusable "you may fetch
 * this" token to leak or share. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const familyMemberId = url.searchParams.get("familyMemberId") ?? "";
    const claimSessionId = url.searchParams.get("claimSessionId") ?? "";
    if (!familyMemberId || !claimSessionId || !isUuid(id)) return NextResponse.json({ error: "familyMemberId and claimSessionId are required." }, { status: 400 });

    const accountId = devAccountId();
    const session = await getClaimSession(accountId, familyMemberId, claimSessionId);
    if (!session) return NextResponse.json({ error: "Claim session not found for this family member." }, { status: 404 });
    const document = await getScopedEvidenceDocument({ accountId, familyMemberId, claimSessionId, id });
    if (!document) return NextResponse.json({ error: "Claim evidence document not found." }, { status: 404 });

    const signedUrl = await createClaimEvidenceSignedUrl(document.storage_key);
    if (signedUrl) return NextResponse.redirect(signedUrl);

    const bytes = await readClaimEvidenceFile(document.storage_key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${document.original_filename.replace(/["\r\n]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not read the claim-evidence file." }, { status: 500 });
  }
}
