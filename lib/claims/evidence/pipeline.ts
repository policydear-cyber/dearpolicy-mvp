/**
 * Background processing pipeline for one claim-evidence document:
 *
 *   uploaded -> quarantined -> processing -> extracted -> needs_review
 *
 * Mirrors lib/rag/ingest.ts's processPolicy() in shape (read file -> extract
 * pages -> OCR if needed -> run structured extraction -> persist), but for
 * claim evidence rather than policy documents, and stopping at
 * `needs_review` rather than ever auto-finalising -- only an explicit
 * reviewer action (see ./matches.ts) can move a document to `matched` or
 * `rejected`.
 *
 * Idempotent and retry-safe throughout: re-running this for a document that
 * has already reached `needs_review` (or beyond) is a silent no-op, so a
 * duplicated or retried background-job delivery can never create duplicate
 * extracted facts, matches, or audit events. A document stuck in `failed`
 * (or still `uploaded`/`quarantined`/`processing` from a crashed run) is
 * resumed from the top on the next call.
 *
 * No raw document text or extracted personal facts are ever written to the
 * application log -- only status, stage and error CODES. See the catch
 * block below.
 */
import { query } from "@/lib/db/client";
import { readClaimEvidenceFile } from "@/lib/storage";
import { extractPdfPages } from "@/lib/documents/pdf";
import { completePdfPagesWithOcr, pagesNeedingOcr } from "@/lib/documents/ocr";
import { looksLikePdf } from "./validation";
import { currentScanAdapter } from "./scan-adapter";
import { extractClaimEvidence } from "./extract";
import { evaluateClaimEvidenceIdentity } from "./identity";
import { appendClaimEvidenceAudit } from "./audit";
import {
  findReusedEvidenceAcrossScopes, getEvidenceDocument, incrementProcessingAttempts,
  listEvidenceDocuments, recordExtraction, transitionEvidenceStatus,
} from "./store";
import type { ClaimEvidenceDocumentRow, ClaimEvidenceStatus } from "./types";
import type { ClaimFacts } from "@/lib/claims/types";
import { activePredicate } from "@/lib/lifecycle/scopes";

export type ProcessClaimEvidenceArgs = { accountId: string; documentId: string };

const RESUMABLE: ClaimEvidenceStatus[] = ["uploaded", "quarantined", "processing", "failed"];

async function markFailed(accountId: string, id: string, from: ClaimEvidenceStatus, errorCode: string, message: string) {
  const moved = await transitionEvidenceStatus({ accountId, id, from, to: "failed", errorCode, errorMessage: message });
  if (moved) {
    await appendClaimEvidenceAudit(accountId, {
      actor: "system", action: "processing_failed", evidenceDocumentId: id,
      claimSessionId: moved.claim_session_id, reasonCode: errorCode, reason: message,
      previousValue: { status: from }, newValue: { status: "failed" },
    });
  }
  // Deliberately no document text, excerpt or extracted field anywhere in
  // this log line -- only the id, stage and a stable error code.
  console.error(`Claim-evidence processing failed [${errorCode}] for document ${id}`);
}

async function familyMemberIdentity(accountId: string, familyMemberId: string) {
  const result = await query<{ display_name: string; preferred_name: string | null }>(
    `SELECT display_name, preferred_name FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
    [familyMemberId, accountId],
  );
  return result.rows[0] ?? null;
}

async function existingDeathDate(accountId: string, claimSessionId: string): Promise<string | null> {
  const result = await query<{ facts: Partial<ClaimFacts> | null }>(
    `SELECT facts FROM claim_sessions WHERE id=$1 AND account_id=$2`,
    [claimSessionId, accountId],
  );
  const facts = result.rows[0]?.facts;
  return (facts?.deathDate ?? facts?.eventDate) ?? null;
}

async function existingDiagnosisDate(accountId: string, claimSessionId: string): Promise<string | null> {
  const result = await query<{ facts: Partial<ClaimFacts> | null }>(
    `SELECT facts FROM claim_sessions WHERE id=$1 AND account_id=$2`,
    [claimSessionId, accountId],
  );
  const facts = result.rows[0]?.facts;
  return facts?.diagnosisDate ?? null;
}

export async function processClaimEvidence(args: ProcessClaimEvidenceArgs): Promise<void> {
  const initial = await getEvidenceDocument(args.accountId, args.documentId);
  if (!initial) return; // Deleted/foreign id -- nothing to do, not an error.
  if (!RESUMABLE.includes(initial.status)) return; // Already past needs_review -- idempotent no-op.

  await incrementProcessingAttempts(args.accountId, args.documentId);
  let current: ClaimEvidenceDocumentRow = initial;

  try {
    // --- uploaded -> quarantined --------------------------------------
    if (current.status === "uploaded") {
      const bytes = await readClaimEvidenceFile(current.storage_key);
      const scan = await currentScanAdapter().scanFile(bytes);
      if (scan.status === "infected") {
        const moved = await transitionEvidenceStatus({ accountId: args.accountId, id: current.id, from: "uploaded", to: "rejected", errorCode: "MALWARE_DETECTED", errorMessage: "This file was flagged by malware scanning and cannot be processed.", scanStatus: scan.status });
        if (moved) await appendClaimEvidenceAudit(args.accountId, { actor: "system", action: "rejected", evidenceDocumentId: current.id, claimSessionId: current.claim_session_id, reasonCode: "MALWARE_DETECTED", newValue: { status: "rejected", scanStatus: scan.status } });
        return;
      }
      // scan.status here is "clean" or "scan_unavailable" (never
      // "pending_scan" -- that value only ever describes a document that
      // has not been scanned yet, i.e. before this call). Persisted to the
      // real scan_status column (previously only ever recorded in the
      // audit log's JSON blob, never queryable) so both the gate just
      // below and the UI can see the real outcome.
      const moved = await transitionEvidenceStatus({ accountId: args.accountId, id: current.id, from: "uploaded", to: "quarantined", scanStatus: scan.status });
      if (moved) {
        current = moved;
        await appendClaimEvidenceAudit(args.accountId, { actor: "system", action: "status_transition", evidenceDocumentId: current.id, claimSessionId: current.claim_session_id, previousValue: { status: "uploaded" }, newValue: { status: "quarantined", scanStatus: scan.status } });
      } else {
        current = (await getEvidenceDocument(args.accountId, args.documentId)) ?? current;
      }
    }
    if (!RESUMABLE.includes(current.status)) return;

    // --- quarantined -> processing -------------------------------------
    // Gate strictly on an explicit clean scan: "Only scan_clean documents
    // may be parsed, OCRed, embedded, indexed, or sent to a model." A
    // document whose recorded scan_status is "scan_unavailable" (no
    // scanner configured -- see ./scan-adapter.ts) or still "pending_scan"
    // stays in `quarantined`: a safe, expected hold state, not a failure,
    // and this is exactly what makes reprocessing a quarantined document
    // safe too (reprocessNeedsAttention() below calls this function for
    // every RESUMABLE document including "quarantined" ones -- it can
    // never bypass this gate, only re-check it). No audit event is written
    // here for the "still not clean" case: retrying a still-quarantined
    // document on every queue pass must not spam the audit log; the one
    // audit event recorded above already captures the scan outcome.
    if (current.status === "quarantined") {
      if (current.scan_status !== "clean") return;
      const moved = await transitionEvidenceStatus({ accountId: args.accountId, id: current.id, from: "quarantined", to: "processing" });
      if (moved) {
        current = moved;
        await appendClaimEvidenceAudit(args.accountId, { actor: "system", action: "status_transition", evidenceDocumentId: current.id, claimSessionId: current.claim_session_id, previousValue: { status: "quarantined" }, newValue: { status: "processing" } });
      } else {
        current = (await getEvidenceDocument(args.accountId, args.documentId)) ?? current;
      }
    }
    if (!RESUMABLE.includes(current.status)) return;
    if (current.status !== "processing") return;

    // --- processing: read, OCR, extract, verify identity ----------------
    const bytes = await readClaimEvidenceFile(current.storage_key);
    if (!looksLikePdf(bytes)) throw Object.assign(new Error("Stored claim-evidence file is not a valid PDF."), { code: "NOT_A_PDF" });

    let pages = await extractPdfPages(bytes);
    const ocrPageNumbers = pagesNeedingOcr(pages);
    if (ocrPageNumbers.length) {
      pages = await completePdfPagesWithOcr({ accountId: args.accountId, bytes, pages, pageNumbers: ocrPageNumbers });
    }
    if (pages.reduce((sum, p) => sum + p.text.length, 0) < 20) {
      throw Object.assign(new Error("Could not obtain enough readable text from this document."), { code: "UNREADABLE_DOCUMENT" });
    }

    const { fields, model, provider, version } = await extractClaimEvidence({
      pages: pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
      documentType: current.document_type,
      documentId: args.documentId,
    });

    const [member, deathDate, diagnosisDate, reused] = await Promise.all([
      familyMemberIdentity(args.accountId, current.family_member_id),
      existingDeathDate(args.accountId, current.claim_session_id),
      existingDiagnosisDate(args.accountId, current.claim_session_id),
      findReusedEvidenceAcrossScopes({ accountId: args.accountId, familyMemberId: current.family_member_id, claimSessionId: current.claim_session_id, fileHash: current.file_hash }),
    ]);
    if (!member) throw Object.assign(new Error("Family member for this claim evidence no longer exists."), { code: "FAMILY_MEMBER_NOT_FOUND" });

    const identity = evaluateClaimEvidenceIdentity({
      familyMember: { displayName: member.display_name, preferredName: member.preferred_name },
      fields, existingDeathDate: deathDate, existingDiagnosisDate: diagnosisDate, reusedDocuments: reused,
      claimSessionId: current.claim_session_id, familyMemberId: current.family_member_id,
    });

    await recordExtraction({
      accountId: args.accountId, evidenceDocumentId: current.id, sourceDocumentVersion: current.file_hash,
      extractedFields: fields, extractionModel: model, extractionProvider: provider, extractionVersion: version,
      identityConflicts: identity.conflicts,
    });

    const extractedRow = await transitionEvidenceStatus({ accountId: args.accountId, id: current.id, from: "processing", to: "extracted", identityStatus: identity.status });
    if (extractedRow) {
      current = extractedRow;
      await appendClaimEvidenceAudit(args.accountId, { actor: "system", action: "status_transition", evidenceDocumentId: current.id, claimSessionId: current.claim_session_id, previousValue: { status: "processing" }, newValue: { status: "extracted", identityStatus: identity.status } });
    } else {
      current = (await getEvidenceDocument(args.accountId, args.documentId)) ?? current;
    }
    if (current.status !== "extracted") return;

    const reviewRow = await transitionEvidenceStatus({ accountId: args.accountId, id: current.id, from: "extracted", to: "needs_review" });
    if (reviewRow) {
      await appendClaimEvidenceAudit(args.accountId, { actor: "system", action: "status_transition", evidenceDocumentId: current.id, claimSessionId: current.claim_session_id, previousValue: { status: "extracted" }, newValue: { status: "needs_review" }, reason: identity.conflicts.map((c) => c.code).join(", ") || undefined });
    }
  } catch (error) {
    const code = (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string")
      ? (error as { code: string }).code
      : "PROCESSING_ERROR";
    const message = error instanceof Error ? error.message : "Claim-evidence processing failed.";
    await markFailed(args.accountId, args.documentId, current.status, code, message);
    // Checkpoint 8 (claude/v1-launch-hardening): re-throw after recording the
    // document-level failure. The document's own status='failed' is the
    // user-visible terminal state either way -- this throw exists so the
    // caller (lib/jobs/pipeline-worker.ts's runAsDurableJob(), when this runs
    // as a durable job) actually sees the failure and can classify it into
    // bounded retry vs. immediate dead-letter, instead of every failure
    // silently reading as a successful background_jobs row. Previously this
    // function swallowed every error here, which meant the durable-job
    // framework's retry/dead-letter logic could never fire for this pipeline
    // no matter how it was invoked.
    throw error;
  }
}

export async function reprocessNeedsAttention(accountId: string, claimSessionId: string): Promise<void> {
  const documents = await listEvidenceDocuments(accountId, claimSessionId);
  for (const doc of documents) {
    if (!RESUMABLE.includes(doc.status)) continue;
    try {
      await processClaimEvidence({ accountId, documentId: doc.id });
    } catch {
      // processClaimEvidence() now re-throws after recording its own
      // document-level failure (Checkpoint 8) so a durable-job caller can
      // classify it -- this direct batch caller isn't one, so a failure on
      // one document must not stop the rest of the batch from reprocessing.
    }
  }
}
