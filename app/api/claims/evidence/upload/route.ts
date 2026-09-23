import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { runAfterResponse } from "@/lib/http/background";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { getClaimSession } from "@/lib/claims/session";
import { saveClaimEvidenceFile } from "@/lib/storage";
import { validateEvidenceUpload, looksLikePdf } from "@/lib/claims/evidence/validation";
import { createEvidenceDocument, supersedeEvidenceDocument } from "@/lib/claims/evidence/store";
import { appendClaimEvidenceAudit } from "@/lib/claims/evidence/audit";
import { enqueueClaimEvidenceProcessing } from "@/lib/claims/evidence/queue";
import type { ClaimEvidenceDocumentType } from "@/lib/claims/evidence/types";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
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

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateEvidenceUpload({ documentType, filename: file.name, mimeType: file.type, byteSize: bytes.byteLength });
    if (!validation.valid) return NextResponse.json({ error: validation.message, reasonCode: validation.reasonCode }, { status: 400 });
    if (!looksLikePdf(bytes)) return NextResponse.json({ error: "The uploaded file is not a valid PDF.", reasonCode: "NOT_A_PDF" }, { status: 400 });

    const documentId = randomUUID();
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const storageKey = await saveClaimEvidenceFile({ accountId: ctx.householdId, familyMemberId, claimSessionId, documentId, filename: file.name, bytes });

    const { document, created } = await createEvidenceDocument({
      accountId: ctx.householdId, familyMemberId, claimSessionId,
      documentType: documentType as ClaimEvidenceDocumentType,
      originalFilename: file.name, storageKey, mimeType: "application/pdf", byteSize: bytes.byteLength, fileHash,
    });

    if (!created) {
      return NextResponse.json({ documentId: document.id, status: document.status, duplicate: true }, { status: 200 });
    }

    if (supersedesId) await supersedeEvidenceDocument({ accountId: ctx.householdId, oldId: supersedesId, newId: document.id, reason: "Replaced by a corrected re-upload." });

    await appendClaimEvidenceAudit(ctx.householdId, {
      actor: "household", action: "uploaded", evidenceDocumentId: document.id, claimSessionId,
      newValue: { documentType, originalFilename: file.name, supersedesId },
    });

    runAfterResponse(() => enqueueClaimEvidenceProcessing({ accountId: ctx.householdId, documentId: document.id }));

    return NextResponse.json({ documentId: document.id, status: document.status }, { status: 202 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "This exact document is already on file for this claim." }, { status: 409 });
    }
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    return authResponse;
  }
}
