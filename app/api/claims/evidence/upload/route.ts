import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { runAfterResponse } from "@/lib/http/background";
import { devAccountId } from "@/lib/db/client";
import { getClaimSession } from "@/lib/claims/session";
import { saveClaimEvidenceFile } from "@/lib/storage";
import { validateEvidenceUpload, looksLikePdf } from "@/lib/claims/evidence/validation";
import { createEvidenceDocument, supersedeEvidenceDocument } from "@/lib/claims/evidence/store";
import { appendClaimEvidenceAudit } from "@/lib/claims/evidence/audit";
import { enqueueClaimEvidenceProcessing } from "@/lib/claims/evidence/queue";
import type { ClaimEvidenceDocumentType } from "@/lib/claims/evidence/types";

export const runtime = "nodejs";
// Same rationale as app/api/policies/upload/route.ts: hosted OCR + LLM
// extraction on a scanned document can take a while; keep the background
// job alive past the response instead of racing the function being frozen.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const familyMemberId = String(form.get("familyMemberId") ?? "");
    const claimSessionId = String(form.get("claimSessionId") ?? "");
    const documentType = String(form.get("documentType") ?? "");
    // A re-upload replacing an earlier, already-reviewed document for this
    // same claim/document-type slot -- see supersedeEvidenceDocument().
    const supersedesId = form.get("supersedesId") ? String(form.get("supersedesId")) : null;

    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required." }, { status: 400 });
    if (!familyMemberId || !claimSessionId) return NextResponse.json({ error: "familyMemberId and claimSessionId are required." }, { status: 400 });

    const accountId = devAccountId();
    // Proves the FULL ownership chain: this claim session must belong to
    // this account AND this family member together, not merely exist.
    const session = await getClaimSession(accountId, familyMemberId, claimSessionId);
    if (!session) return NextResponse.json({ error: "Claim session not found for this family member." }, { status: 404 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateEvidenceUpload({ documentType, filename: file.name, mimeType: file.type, byteSize: bytes.byteLength });
    if (!validation.valid) return NextResponse.json({ error: validation.message, reasonCode: validation.reasonCode }, { status: 400 });
    if (!looksLikePdf(bytes)) return NextResponse.json({ error: "The uploaded file is not a valid PDF.", reasonCode: "NOT_A_PDF" }, { status: 400 });

    const documentId = randomUUID();
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const storageKey = await saveClaimEvidenceFile({ accountId, familyMemberId, claimSessionId, documentId, filename: file.name, bytes });

    const { document, created } = await createEvidenceDocument({
      accountId, familyMemberId, claimSessionId,
      documentType: documentType as ClaimEvidenceDocumentType,
      originalFilename: file.name, storageKey, mimeType: "application/pdf", byteSize: bytes.byteLength, fileHash,
    });

    if (!created) {
      // Idempotent: the exact same bytes were already uploaded for this
      // claim. Hand back the existing document rather than reprocessing.
      return NextResponse.json({ documentId: document.id, status: document.status, duplicate: true }, { status: 200 });
    }

    if (supersedesId) await supersedeEvidenceDocument({ accountId, oldId: supersedesId, newId: document.id, reason: "Replaced by a corrected re-upload." });

    await appendClaimEvidenceAudit(accountId, {
      actor: "household", action: "uploaded", evidenceDocumentId: document.id, claimSessionId,
      newValue: { documentType, originalFilename: file.name, supersedesId },
    });

    runAfterResponse(() => enqueueClaimEvidenceProcessing({ accountId, documentId: document.id }));

    return NextResponse.json({ documentId: document.id, status: document.status }, { status: 202 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "This exact document is already on file for this claim." }, { status: 409 });
    }
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
