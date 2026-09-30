import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { scheduleRequestDrain } from "@/lib/jobs/request-drain";
import { readPolicyFile } from "@/lib/storage";
import { acceptPolicyUpload, MAX_DOCUMENT_BYTES, TOO_LARGE_MESSAGE, uploadErrorResponse } from "../accept";
import { verifyUploadIntent } from "../intent-token";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration = 300;

const Schema = z.object({ token: z.string().min(1).max(8192), pdfPassword: z.string().max(500).optional() });

/**
 * Step 3 of a direct upload: the browser has sent the file to storage; the
 * server now reads the STORED bytes and runs every check the classic upload
 * runs (./accept.ts) -- size, file-signature sniffing, extension/MIME
 * agreement, image decodability, household-scoped family member, duplicate
 * detection -- then records the document and queues it for the malware scan
 * and processing. Nothing the browser says about the file is trusted; a
 * refused file's object is deleted.
 */
export async function POST(request: NextRequest) {
  try {
    const body = Schema.parse(await request.json().catch(() => ({})));
    const ctx = await requireHouseholdContext(request);
    scheduleRequestDrain();
    const intent = verifyUploadIntent(body.token);
    if (!intent || intent.householdId !== ctx.householdId || intent.userId !== ctx.userId) {
      return NextResponse.json({ error: "This upload has expired. Choose the file again." }, { status: 403 });
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readPolicyFile(intent.storageKey));
    } catch {
      return NextResponse.json({ error: "The file did not finish uploading. Please try again.", reasonCode: "UPLOAD_INCOMPLETE" }, { status: 409 });
    }
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      return NextResponse.json({ error: TOO_LARGE_MESSAGE, reasonCode: "FILE_TOO_LARGE" }, { status: 400 });
    }
    if (bytes.length !== intent.byteSize) {
      return NextResponse.json({ error: "The file did not finish uploading. Please try again.", reasonCode: "UPLOAD_INCOMPLETE" }, { status: 409 });
    }
    return await acceptPolicyUpload({
      request, ctx, policyId: intent.policyId, bytes, filename: intent.filename, mimeType: intent.mimeType,
      familyMemberId: intent.familyMemberId, explicitFamilyMember: intent.explicitFamilyMember,
      pdfPassword: body.pdfPassword ?? "", supersedesPolicyId: intent.supersedesPolicyId, storedKey: intent.storageKey,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "This upload has expired. Choose the file again." }, { status: 400 });
    const known = uploadErrorResponse(error, request);
    if (known) return known;
    const authResponse = routeErrorResponse(error, { request, route: "/api/policies/upload/finalize" });
    if (authResponse.status === 500) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
    return authResponse;
  }
}
