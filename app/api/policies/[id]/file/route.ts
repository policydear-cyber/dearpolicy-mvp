import { NextResponse, type NextRequest } from "next/server";
import { isUuid, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { isPolicyProcessingAllowed } from "@/lib/policies/quarantine/store";
import { createPolicyFileSignedUrl, readPolicyFile } from "@/lib/storage";
import { sniffFileFormat } from "@/lib/documents/formats";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Preview: the household opens one of its own documents to see which one it
 * is (file names are often meaningless). Every request re-checks, on the
 * server, that the document belongs to the caller's household, is the current
 * active version and was cleared by the malware scan (or recorded as not
 * scanned in prototype mode, the same gate as processing). Only then does it
 * open, as what the file IS (its first bytes), never what its name says:
 *  - a PDF: on Supabase Storage, a redirect to a signed URL of at most five
 *    minutes (the bucket stays private); on local disk, the bytes inline.
 *  - a photo or scan: re-encoded here as a JPEG of at most 2000px, since every
 *    file is stored labelled as a PDF and a browser cannot show a TIFF. The
 *    re-encode also means no original image bytes are served from this origin.
 *  - a Word file or anything else: downloaded under its own name.
 *
 * Responses are private, no-store and never sniffed. As with claim evidence
 * (app/api/claims/evidence/[id]/file), a link already issued stays valid until
 * its own short expiry; a new one is never issued for a deleted, superseded or
 * uncleared document. */
const PREVIEW_MAX_PX = 2000;
/** sharp refuses larger images before decoding them (about a 50-megapixel photo). */
const PREVIEW_MAX_INPUT_PIXELS = 50_000_000;
const HEAD_BYTES = 64;

/** The first bytes of a stored file through its signed link (a range request, not the whole file). */
async function firstBytes(signedUrl: string): Promise<Uint8Array> {
  const res = await fetch(signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
  if (!res.ok) throw new Error(`Could not read the start of the stored file (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer()).subarray(0, HEAD_BYTES);
}

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

    // What the file IS, from its first bytes: its name can be wrong (an old .doc, a PDF saved as .jpg). On Supabase
    // Storage only those bytes are fetched, through the same short-lived signed link.
    const signed = await createPolicyFileSignedUrl(doc.storage_key);
    const head = signed ? await firstBytes(signed) : new Uint8Array((await readPolicyFile(doc.storage_key)).subarray(0, HEAD_BYTES));
    const sniffed = sniffFileFormat(head);
    const format = sniffed.ok ? sniffed.format : null;

    if (format === "pdf") {
      if (signed) return privateResponse(NextResponse.redirect(signed));
      return privateResponse(new NextResponse(new Uint8Array(await readPolicyFile(doc.storage_key)), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${headerFilename(name)}"` },
      }));
    }

    if (format === "jpeg" || format === "png" || format === "webp" || format === "tiff") {
      let jpeg: Buffer;
      try {
        const sharp = (await import("sharp")).default;
        jpeg = await sharp(await readPolicyFile(doc.storage_key), { pages: 1, limitInputPixels: PREVIEW_MAX_INPUT_PIXELS }).rotate()
          .resize({ width: PREVIEW_MAX_PX, height: PREVIEW_MAX_PX, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82 }).toBuffer();
      } catch {
        return json({ error: "This photo is too large or damaged to show here.", reasonCode: "PREVIEW_UNAVAILABLE" }, 422);
      }
      return privateResponse(new NextResponse(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Content-Disposition": "inline" } }));
    }

    // A Word file, or anything a browser can't show: saved under its own name, never opened as something else.
    const download = await createPolicyFileSignedUrl(doc.storage_key, headerFilename(name));
    if (download) return privateResponse(NextResponse.redirect(download));
    return privateResponse(new NextResponse(new Uint8Array(await readPolicyFile(doc.storage_key)), {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${headerFilename(name)}"` },
    }));
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return json({ error: "Could not open this document. Please try again." }, 500);
    return privateResponse(authResponse);
  }
}
