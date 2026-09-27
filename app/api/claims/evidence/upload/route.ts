import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { scheduleRequestDrain } from "@/lib/jobs/request-drain";
import { recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { getClaimSession } from "@/lib/claims/session";
import { saveClaimEvidenceFile } from "@/lib/storage";
import { canonicalMimeType, validateEvidenceUpload } from "@/lib/claims/evidence/validation";
import { probeImageDecodes } from "@/lib/documents/formats";
import { createEvidenceDocument, getScopedEvidenceDocument, supersedeEvidenceDocument, EvidenceAlreadySupersededError } from "@/lib/claims/evidence/store";
import { appendClaimEvidenceAudit } from "@/lib/claims/evidence/audit";
import { enqueueClaimEvidenceProcessing } from "@/lib/claims/evidence/queue";
import type { ClaimEvidenceDocumentType } from "@/lib/claims/evidence/types";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    scheduleRequestDrain(); // bounded job drain after the response (lib/jobs/request-drain.ts)
    const form = await request.formData();
    const file = form.get("file");
    const familyMemberId = String(form.get("familyMemberId") ?? "");
    const claimSessionId = String(form.get("claimSessionId") ?? "");
    const documentType = String(form.get("documentType") ?? "");
    const supersedesId = form.get("supersedesId") ? String(form.get("supersedesId")) : null;

    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required." }, { status: 400 });
    if (!familyMemberId || !claimSessionId) return NextResponse.json({ error: "familyMemberId and claimSessionId are required." }, { status: 400 });

    const session = await getClaimSession(ctx.householdId, familyMemberId, claimSessionId);
    if (!session) return NextResponse.json({ error: "Claim session not found for this family member." }, { status: 404 });

    // D7/D33 (Wave 2 adversarial audit): a corrected re-upload's
    // `supersedesId` is now resolved through getScopedEvidenceDocument()
    // -- the SAME full-ownership-chain check (account + family member +
    // claim session) every other route uses -- BEFORE any file is saved
    // or any document row is created. Previously supersedesId was handed
    // straight to supersedeEvidenceDocument(), which only ever checked
    // account_id, so a request naming a document id from a DIFFERENT
    // family member's or claim's evidence (but the same household
    // account) could silently supersede -- and invalidate every match
    // built from -- evidence that had nothing to do with this upload.
    // getScopedEvidenceDocument() also now excludes an already-superseded
    // document (see its own doc comment in lib/claims/evidence/store.ts),
    // so re-submitting the same correction twice fails here with a clear
    // 400 instead of reaching supersedeEvidenceDocument()'s own
    // defense-in-depth race check.
    if (supersedesId) {
      const oldDocument = await getScopedEvidenceDocument({ accountId: ctx.householdId, familyMemberId, claimSessionId, id: supersedesId });
      if (!oldDocument) {
        return NextResponse.json({ error: "The document you are correcting could not be found for this claim, or has already been replaced." }, { status: 400 });
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateEvidenceUpload({ documentType, filename: file.name, mimeType: file.type, byteSize: bytes.byteLength, bytes });
    if (!validation.valid) return NextResponse.json({ error: validation.message, reasonCode: validation.reasonCode }, { status: 400 });
    const imageProblem = await probeImageDecodes(bytes, validation.format);
    if (imageProblem) return NextResponse.json({ error: imageProblem, reasonCode: "CORRUPTED_FILE" }, { status: 400 });

    const documentId = randomUUID();
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const storageKey = await saveClaimEvidenceFile({ accountId: ctx.householdId, familyMemberId, claimSessionId, documentId, filename: file.name, bytes });

    const { document, created } = await createEvidenceDocument({
      accountId: ctx.householdId, familyMemberId, claimSessionId,
      documentType: documentType as ClaimEvidenceDocumentType,
      originalFilename: file.name, storageKey, mimeType: canonicalMimeType(validation.format), byteSize: bytes.byteLength, fileHash,
    });

    if (!created) {
      return NextResponse.json({ documentId: document.id, status: document.status, duplicate: true }, { status: 200 });
    }

    if (supersedesId) {
      try {
        await supersedeEvidenceDocument({ accountId: ctx.householdId, oldId: supersedesId, newId: document.id, reason: "Replaced by a corrected re-upload." });
      } catch (error) {
        // Race backstop only -- the scoped lookup above already rejects a
        // foreign/superseded id before any file is saved. See
        // EvidenceAlreadySupersededError's own doc comment.
        if (error instanceof EvidenceAlreadySupersededError) {
          return NextResponse.json({ error: "The document you are correcting has already been replaced by another upload." }, { status: 409 });
        }
        throw error;
      }
    }

    await appendClaimEvidenceAudit(ctx.householdId, {
      actor: "household", action: "uploaded", evidenceDocumentId: document.id, claimSessionId,
      newValue: { documentType, originalFilename: file.name, supersedesId },
    });

    // D13 (Wave 2 adversarial audit): enqueueClaimEvidenceProcessing() is
    // now awaited directly instead of deferred via runAfterResponse()/
    // after(). The deferred version had no .catch() on this primary path,
    // so a failed background_jobs insert was silently swallowed -- the
    // client would see a 202 "queued" response for evidence that was never
    // actually enqueued for processing. The insert itself is a single fast
    // INSERT, so awaiting it adds negligible latency and lets a real
    // failure surface through this route's own catch block below instead
    // of disappearing.
    await enqueueClaimEvidenceProcessing({ accountId: ctx.householdId, documentId: document.id });

    // D23 (Wave 2 adversarial audit): "uploads" is a required telemetry
    // call site -- mirrors the exact recordEvent() shape
    // app/api/policies/upload/route.ts already uses (Checkpoint 14b).
    // Fire-and-forget (never awaited): recordEvent() is itself
    // failure-isolated and time-bounded, so this can never slow down or
    // fail the actual HTTP response.
    void recordEvent({
      name: "upload.evidence.queued",
      correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")),
      route: "/api/claims/evidence/upload",
      status: "success",
    });

    return NextResponse.json({ documentId: document.id, status: document.status }, { status: 202 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
      void recordEvent({
        name: "upload.evidence.rejected",
        correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")),
        route: "/api/claims/evidence/upload",
        status: "failure",
        errorCategory: "validation",
      });
      return NextResponse.json({ error: "This exact document is already on file for this claim." }, { status: 409 });
    }
    const authResponse = routeErrorResponse(error, { request, route: "/api/claims/evidence/upload" });
    if (authResponse.status === 500) return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    return authResponse;
  }
}
