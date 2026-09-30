import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createPolicyUploadUrl, policyUploadDriver, policyUploadKey } from "@/lib/storage";
import { ACCEPTED_FORMATS_MESSAGE, FORMAT_EXTENSIONS, SUPPORTED_UPLOAD_FORMATS } from "@/lib/documents/formats";
import { MAX_DOCUMENT_BYTES, TOO_LARGE_MESSAGE, resolveUploadFamilyMember, uploadErrorResponse } from "../accept";
import { signUploadIntent, UPLOAD_INTENT_TTL_MS } from "../intent-token";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Local-driver part size: under Vercel's ~4.5 MB and the proxy's 10 MB body limits. */
const UPLOAD_PART_BYTES = 4 * 1024 * 1024;

const Schema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().max(200).optional().default(""),
  byteSize: z.number().int().nonnegative(),
  familyMemberId: z.string().uuid().optional().nullable(),
  supersedesPolicyId: z.string().uuid().optional().nullable(),
});

/**
 * Step 1 of a direct upload (Round 5, item 1). Authorizes the session and
 * the family member, checks the declared size and extension (the bytes are
 * checked again, fully, at finalize), fixes a server-generated object key,
 * and returns where the browser should send the file:
 *   - Supabase Storage (production): a one-time signed upload URL;
 *   - local disk (development): this app's own part endpoint, in parts of
 *     at most 4 MB.
 * plus a signed intent token for /api/policies/upload/finalize.
 */
export async function POST(request: NextRequest) {
  try {
    const body = Schema.parse(await request.json().catch(() => ({})));
    const ctx = await requireHouseholdContext(request);
    if (body.byteSize <= 0) return NextResponse.json({ error: "The uploaded file is empty.", reasonCode: "EMPTY_FILE" }, { status: 400 });
    if (body.byteSize > MAX_DOCUMENT_BYTES) return NextResponse.json({ error: TOO_LARGE_MESSAGE, reasonCode: "FILE_TOO_LARGE" }, { status: 400 });
    const extension = (body.filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
    const known = SUPPORTED_UPLOAD_FORMATS.some((f) => FORMAT_EXTENSIONS[f].some((e) => e.replace(/^\./, "") === extension));
    if (!known) return NextResponse.json({ error: `"${extension ? "." + extension : "(none)"}" is not a supported file extension. ${ACCEPTED_FORMATS_MESSAGE}`, reasonCode: "UNSUPPORTED_EXTENSION" }, { status: 400 });

    const familyMemberId = await resolveUploadFamilyMember(ctx, body.familyMemberId ?? "");
    const policyId = randomUUID();
    const driver = policyUploadDriver();
    const storageKey = policyUploadKey({ accountId: ctx.householdId, familyMemberId, policyId, filename: body.filename });
    const token = signUploadIntent({
      v: 1, householdId: ctx.householdId, userId: ctx.userId, familyMemberId, explicitFamilyMember: Boolean(body.familyMemberId),
      policyId, storageKey, filename: body.filename, mimeType: body.mimeType, byteSize: body.byteSize,
      supersedesPolicyId: body.supersedesPolicyId ?? null, driver, expiresAt: Date.now() + UPLOAD_INTENT_TTL_MS,
    });
    if (driver === "supabase") {
      const target = await createPolicyUploadUrl(storageKey);
      return NextResponse.json({ token, mode: "signed-url", uploadUrl: target.url, method: "PUT", maxBytes: MAX_DOCUMENT_BYTES });
    }
    return NextResponse.json({ token, mode: "parts", partUrl: "/api/policies/upload/part", partBytes: UPLOAD_PART_BYTES, maxBytes: MAX_DOCUMENT_BYTES });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "That file could not be prepared for upload." }, { status: 400 });
    const known = uploadErrorResponse(error, request);
    if (known) return known;
    const authResponse = routeErrorResponse(error, { request, route: "/api/policies/upload/start" });
    if (authResponse.status === 500) return NextResponse.json({ error: "The upload could not be started. Please try again." }, { status: 500 });
    return authResponse;
  }
}
