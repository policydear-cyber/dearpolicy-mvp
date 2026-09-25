import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { getClaimSession } from "@/lib/claims/session";
import { getScopedEvidenceDocument } from "@/lib/claims/evidence/store";
import { readClaimEvidenceFile, createClaimEvidenceSignedUrl } from "@/lib/storage";
import { isEvidenceDownloadable, PRIVATE_NO_STORE } from "@/lib/claims/evidence/household-view";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Never a public URL. On the Supabase driver this redirects to a
 * short-lived signed URL (see lib/storage/supabase.ts); on local disk,
 * where there is no such thing, it streams the bytes itself after
 * re-checking the full account/family-member/claim ownership chain on
 * every single request -- there is no cached, reusable "you may fetch
 * this" token to leak or share.
 *
 * D34 (Wave 2 adversarial audit): getScopedEvidenceDocument() now also
 * excludes a superseded document (superseded_at IS NULL -- see its own
 * doc comment in lib/claims/evidence/store.ts), so this route 404s BEFORE
 * ever calling createClaimEvidenceSignedUrl() for evidence that has been
 * superseded (a corrected re-upload) or soft-deleted. That is this
 * application's own access boundary, and it is enforced immediately, on
 * every request -- there is no caching of "may this account fetch this
 * document" anywhere.
 *
 * What this route CANNOT do anything about: a signed URL minted on an
 * EARLIER request, before the document was superseded/deleted, is a
 * capability the storage driver itself (Supabase Storage) has already
 * handed out and will honor directly, with no further app-side check,
 * until that URL's own TTL (SIGNED_URL_TTL_SECONDS = 300s, see
 * lib/storage/supabase.ts) expires. That is an unavoidable property of
 * using pre-signed direct-storage URLs at all, not something a Next.js
 * route can revoke after the fact -- the only way to close that window
 * completely would be to never redirect to a signed URL and instead
 * always stream bytes through this authenticated route (paying the
 * latency/throughput cost of proxying every download). This route
 * already keeps that window as short as practical (300s, the shortest
 * TTL Supabase's own createSignedUrl() meaningfully supports for a
 * multi-page PDF fetch) and never mints a NEW one for superseded/deleted
 * evidence -- it cannot retroactively invalidate one already issued. */
/** Every response from this route -- redirect, bytes or error -- is
 * private and never stored by a browser or shared cache. */
function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
const json = (body: Record<string, unknown>, status: number) => noStore(NextResponse.json(body, { status }));

/** Ownership, active lifecycle and not-superseded are enforced by
 * getScopedEvidenceDocument(); a NEW link or byte stream is additionally
 * issued only for a file the malware scan has cleared and that is not
 * uploaded/quarantined/rejected (isEvidenceDownloadable()). All of it is
 * re-checked on every request. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireHouseholdContext(request);
    const url = new URL(request.url);
    const familyMemberId = url.searchParams.get("familyMemberId") ?? "";
    const claimSessionId = url.searchParams.get("claimSessionId") ?? "";
    if (!familyMemberId || !claimSessionId || !isUuid(id)) return json({ error: "familyMemberId and claimSessionId are required." }, 400);

    const session = await getClaimSession(ctx.householdId, familyMemberId, claimSessionId);
    if (!session) return json({ error: "Claim session not found for this family member." }, 404);
    const document = await getScopedEvidenceDocument({ accountId: ctx.householdId, familyMemberId, claimSessionId, id });
    if (!document) return json({ error: "Claim evidence document not found." }, 404);
    if (!isEvidenceDownloadable(document)) {
      return json({ error: "This document can't be opened until its security check has cleared it.", reasonCode: "EVIDENCE_NOT_DOWNLOADABLE" }, 409);
    }

    const signedUrl = await createClaimEvidenceSignedUrl(document.storage_key);
    if (signedUrl) return noStore(NextResponse.redirect(signedUrl));

    const bytes = await readClaimEvidenceFile(document.storage_key);
    return noStore(new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${document.original_filename.replace(/["\r\n]/g, "_")}"`,
      },
    }));
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return json({ error: "Could not read the claim-evidence file." }, 500);
    return noStore(authResponse);
  }
}
