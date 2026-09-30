import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { scheduleRequestDrain } from "@/lib/jobs/request-drain";
import { isUuid } from "@/lib/db/client";
import { recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { acceptPolicyUpload, MULTIPART_MAX_BYTES, resolveUploadFamilyMember, uploadErrorResponse } from "./accept";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
// Reading a scanned PDF (hosted OCR + LLM extraction) can take a couple of
// minutes for a long policy document; give the background job room to finish
// inside after() rather than being cut off.
export const maxDuration = 300;

/**
 * Classic multipart upload, for SMALL files only. A serverless function
 * cannot receive a large request body (about 4.5 MB on Vercel; the Next.js
 * proxy buffers at most 10 MB), so the app's own pages upload through the
 * direct-to-storage flow instead: start/route.ts -> the browser sends the
 * file to storage -> finalize/route.ts. Both paths share every check in
 * ./accept.ts.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    scheduleRequestDrain(); // bounded job drain after the response (lib/jobs/request-drain.ts)
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MULTIPART_MAX_BYTES + 64 * 1024) {
      void recordEvent({ name: "upload.policy.rejected", correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")), route: "/api/policies/upload", status: "failure", errorCategory: "validation" });
      return NextResponse.json({ error: "This file is too large to send this way. Upload it from the Documents page, which sends large files directly to secure storage.", reasonCode: "USE_DIRECT_UPLOAD" }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    const requestedMember = String(form.get("familyMemberId") ?? "");
    const pdfPassword = String(form.get("pdfPassword") ?? "");
    // Optional: a corrected re-upload of an existing document; the OLD row is
    // marked superseded (never deleted) once the new row is safely inserted.
    const supersedesPolicyIdRaw = String(form.get("supersedesPolicyId") ?? "");
    if (!(file instanceof File)) return NextResponse.json({ error: "A document file is required." }, { status: 400 });

    const familyMemberId = await resolveUploadFamilyMember(ctx, requestedMember);
    return await acceptPolicyUpload({
      request, ctx, policyId: randomUUID(),
      bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mimeType: file.type,
      familyMemberId, explicitFamilyMember: Boolean(requestedMember), pdfPassword,
      supersedesPolicyId: isUuid(supersedesPolicyIdRaw) ? supersedesPolicyIdRaw : null,
    });
  } catch (error) {
    const known = uploadErrorResponse(error, request);
    if (known) return known;
    const authResponse = routeErrorResponse(error, { request, route: "/api/policies/upload" });
    if (authResponse.status === 500) return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    return authResponse;
  }
}
