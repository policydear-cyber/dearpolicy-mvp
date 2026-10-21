import { NextResponse, type NextRequest } from "next/server";
import { isUuid, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { isPolicyProcessingAllowed } from "@/lib/policies/quarantine/store";
import { createPolicyFileSignedUrl, readPolicyFile } from "@/lib/storage";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Preview: the household opens one of its own documents to see which one it
 * is (file names are often meaningless). Every request re-checks, on the
 * server, that the document belongs to the caller's household, is the current
 * active version and was cleared by the malware scan (or recorded as not
 * scanned in prototype mode, the same gate as processing). Only then:
 *
 *  - a PDF: on Supabase Storage, a redirect to a signed URL of at most five
 *    minutes (the bucket stays private); on local disk, the bytes inline.
 *  - a photo or scan: re-encoded here as a JPEG of at most 2000px, since every
 *    file is stored labelled as a PDF and a browser cannot show a TIFF. The
 *    re-encode also means no original image bytes are served from this origin.
 *  - a Word file: downloaded under its own name (no browser shows one inline).
 *
 * Responses are private, no-store and never sniffed. As with claim evidence
 * (app/api/claims/evidence/[id]/file), a link already issued stays valid until
 * its own short expiry; a new one is never issued for a deleted, superseded or
 * uncleared document. */
const PREVIEW_MAX_PX = 2000;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|tiff?)$/i;

function privateResponse<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
const json = (body: Record<string, unknown>, status: number) => privateResponse(NextResponse.json(body, { status }));
const headerFilename = (name: string) => name.replace(/["\\\r\n]/g, "_").replace(/[^\x20-\x7e]/g, "_");

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireHouseholdContext(request);
    if (!isUuid(id)) return json({ error: "Document not found." }, 404);
    const found = await query<{ original_filename: string; storage_key: string; quarantine_status: string | null }>(
      `SELECT original_filename,storage_key,quarantine_status FROM policies
        WHERE id=$1 AND account_id=$2 AND superseded_at IS NULL AND ${activePredicate()}`,
      [id, ctx.householdId],
    );
    const doc = found.rows[0];
    if (!doc) return json({ error: "Document not found." }, 404);
    if (!isPolicyProcessingAllowed({ quarantine_status: doc.quarantine_status ?? "" })) {
      return json({ error: "This document can be opened once its security check has finished.", reasonCode: "DOCUMENT_NOT_CLEARED" }, 409);
    }
    const name = doc.original_filename || "document.pdf";

    if (IMAGE_EXTENSIONS.test(name)) {
      const sharp = (await import("sharp")).default;
      const jpeg = await sharp(await readPolicyFile(doc.storage_key), { pages: 1 }).rotate()
        .resize({ width: PREVIEW_MAX_PX, height: PREVIEW_MAX_PX, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 }).toBuffer();
      return privateResponse(new NextResponse(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Content-Disposition": "inline" } }));
    }

    const isWord = /\.docx$/i.test(name);
    const signed = await createPolicyFileSignedUrl(doc.storage_key, isWord ? headerFilename(name) : undefined);
    if (signed) return privateResponse(NextResponse.redirect(signed));
    const bytes = await readPolicyFile(doc.storage_key);
    return privateResponse(new NextResponse(new Uint8Array(bytes), {
      headers: isWord
        ? { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${headerFilename(name)}"` }
        : { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${headerFilename(name)}"` },
    }));
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return json({ error: "Could not open this document. Please try again." }, 500);
    return privateResponse(authResponse);
  }
}
