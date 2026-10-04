import { POLICY_PROCESSING_FAILED_MESSAGE, recordProcessingFailure } from "@/lib/diagnostics/processing-failures";
import { DOCUMENT_READ_IN_PART_MESSAGE, DOCUMENT_READING_FAILED_MESSAGE, DOCUMENT_READING_RETRY_MESSAGE, DOCUMENT_READING_SERVICE_MESSAGE, TemporaryProcessingError, isQuotaOrSpendStop, UNOPENABLE_DOCUMENT_MESSAGE, UNREADABLE_DOCUMENT_MESSAGE, USER_ACTIONABLE_PROCESSING_ERRORS, UserActionableProcessingError, unreadablePagesNote } from "@/lib/documents/processing-errors";
import { documentDateFrom, ensureEvidenceSchema, evidenceColumnsReady, policyNumberAppears, printedDateAppears } from "@/lib/documents/evidence";
import { annotateCoverageEvidence, annotateLedgerEvidence, markConflicts } from "@/lib/documents/evidence-store";
import { classifyPipelineError } from "@/lib/jobs/pipeline-worker";
import { createHash } from "node:crypto";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { readPolicyFile } from "@/lib/storage";
import { extractPdfPages } from "@/lib/documents/pdf";
import { ACCEPTED_FORMATS_MESSAGE, docxToPages, imageToPdf, sniffFileFormat } from "@/lib/documents/formats";
import { completePdfPagesWithOcr, pagesNeedingOcr } from "@/lib/documents/ocr";
import { chunkPages } from "@/lib/documents/chunk";
import { deletePolicyPassages, indexPolicyPassages, pineconeEnabled } from "@/lib/rag/pinecone";
import { buildCodeOnlyExtraction, extractPolicyStructure, detectHighConfidenceReferenceRole, type PolicyExtraction } from "@/lib/ai/extract-policy";
import { REFERENCE_ROLES, deterministicDocumentRole, documentAuthority, looksLikeActualPersonName, sanitizePolicyExtraction } from "@/lib/documents/intelligence";
import { factCheckExtraction, personPrinted } from "@/lib/documents/fact-check";
import { PolicyExtractionSchema } from "@/lib/ai/extract-policy";
import { normalizeCoverageCategory } from "@/lib/insurance";
import { familyMembersForAccount, findFamilyMatchWithKind, linkRelatedReferenceDocuments, printedCurrencyCode, syncInsuredPersonToMember } from "@/lib/policies/linking";
import { runPolicyQuarantineGate } from "@/lib/policies/quarantine/store";
import { recordErrorEvent, recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";

export type ProcessPolicyArgs = {
  accountId: string;
  familyMemberId: string;
  policyId: string;
  storageKey: string;
  pdfPassword?: string;
  linkUploadMember?: boolean;
  // D14 (background job durability): extends the job's lease while this
  // (potentially multi-minute) run is still making progress, so a
  // still-live worker is never reclaimed by recoverExpiredLeases() and
  // double-processed by a second worker. Supplied by
  // lib/jobs/processors.ts's processPolicyProcessingJob(), which is the
  // only real caller that has a jobId/workerId to heartbeat against;
  // left undefined for any other caller (e.g. scripts/reprocess-policy.ts
  // or a direct call from a regression suite), which simply gets no
  // heartbeat -- exactly today's (pre-fix) behavior.
  jobHeartbeat?: () => Promise<void>;
  /** V1.1: which attempt of the durable job this is (attempt_count is
   * incremented when the job is claimed). A temporary failure with attempts
   * left is shown as "still reading" and retried automatically; only the
   * last attempt records a failure the household sees. */
  attempt?: { number: number; max: number };
  /** Round 5: the durable job type running this (so a deferred retry lands
   * on the same queue), and whether this run IS that one deferred retry
   * (which never schedules another). */
  jobType?: string;
  deferredRetry?: boolean;
};

/** Round 5: the MediSave and cash portions a renewal notice or receipt
 * prints ("Less: MediSave deduction S$1,050.00", "cash payable S$362.00",
 * "Total cash payable S$1,120.00"), as one note for its premium records.
 * Only printed figures, copied as printed; null when none is printed. */
export function paymentSplitNote(text: string): string | null {
  const amountOn = (pattern: RegExp) => {
    for (const line of text.split(/\n/)) {
      if (!pattern.test(line)) continue;
      const amount = line.match(/(?:S\$|SGD\s?)\s?\d[\d,]*(?:\.\d{1,2})?/i)?.[0];
      if (amount) return amount.replace(/\s+/g, "");
    }
    return null;
  };
  const medisave = amountOn(/\bmedisave\b/i);
  const total = amountOn(/\btotal\s+cash\s+payable\b/i);
  const cash = amountOn(/^(?!.*\btotal\b).*\bcash\s+payable\b/i);
  const parts = [medisave ? "MediSave pays " + medisave : null, cash ? "cash payable " + cash : null, total ? "total cash payable " + total : null].filter(Boolean);
  return parts.length ? "As printed: " + parts.join("; ") : null;
}

/** Round 5: minutes until the one deferred retry after a reading-service
 * failure outlasted the job's own attempts. */
export const DEFERRED_READ_RETRY_MINUTES = 30;
/** A failure of a reading service, not of the document: retried while the
 * job has attempts left; quota/spend stops and actionable reasons pass
 * through unchanged. */
function asServiceFailure(error: unknown, what: string): unknown {
  if (error instanceof UserActionableProcessingError || error instanceof TemporaryProcessingError || isQuotaOrSpendStop(error)) return error;
  return new TemporaryProcessingError(what + " failed: " + (error instanceof Error ? error.name + ": " + error.message : String(error)).slice(0, 300), error);
}
function attemptsLeft(args: ProcessPolicyArgs) { return !!args.attempt && args.attempt.number < args.attempt.max; }
/** Schedules the single later re-read after the job's own attempts ran out
 * on a service failure. Idempotent (its own key); never from the deferred
 * run itself, so retries stay bounded. Returns whether one is scheduled. */
async function scheduleDeferredRead(args: ProcessPolicyArgs): Promise<boolean> {
  if (args.deferredRetry) return false;
  try {
    const [{ enqueueJob }, { pool }, { POLICY_PROCESSING_JOB_TYPE }] = await Promise.all([import("@/lib/jobs/queue"), import("@/lib/db/client"), import("@/lib/rag/processing-queue")]);
    await enqueueJob(pool, {
      jobType: args.jobType ?? POLICY_PROCESSING_JOB_TYPE,
      idempotencyKey: args.policyId + ":retry-read",
      accountId: args.accountId,
      resurrectTerminal: true,
      availableAt: new Date(Date.now() + DEFERRED_READ_RETRY_MINUTES * 60_000),
      payload: { policyId: args.policyId, familyMemberId: args.familyMemberId, storageKey: args.storageKey,
        pdfPassword: args.pdfPassword ?? null, linkUploadMember: Boolean(args.linkUploadMember), deferredRetry: true },
    });
    return true;
  } catch (error) {
    console.warn("Deferred re-read could not be scheduled for policy " + args.policyId + ":", error instanceof Error ? error.message : error);
    return false;
  }
}

/** V1.1 cross-check: a policy number or date the extraction reports is kept
 * only when it is printed in the document. What is not printed is not
 * usable; it becomes a document note instead of a fact. */
export function crossCheckPrintedFacts<T extends { policyNumber: string | null; startDate: string | null; renewalOrExpiryDate: string | null; documentNotes: string[] }>(extraction: T, pages: { text: string }[]): T {
  const notes = [...extraction.documentNotes];
  let { policyNumber, startDate, renewalOrExpiryDate } = extraction;
  if (policyNumber && !policyNumberAppears(pages, policyNumber)) { notes.push("A policy number was reported that is not printed in this document; it was not kept."); policyNumber = null; }
  if (startDate && !printedDateAppears(pages, startDate)) { notes.push("A start date was reported that is not printed in this document; it was not kept."); startDate = null; }
  if (renewalOrExpiryDate && !printedDateAppears(pages, renewalOrExpiryDate)) { notes.push("An expiry date was reported that is not printed in this document; it was not kept."); renewalOrExpiryDate = null; }
  return { ...extraction, policyNumber, startDate, renewalOrExpiryDate, documentNotes: notes };
}

function normalizeEvidence(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

// D14 (background job durability): premium_records has no natural unique
// key today (unlike policy_pages' (policy_id,page_number)), so two workers
// concurrently processing the SAME job -- e.g. one whose lease genuinely
// expired mid-run and was reclaimed while it was still alive -- could each
// run the DELETE-then-INSERT block below and leave duplicate rows behind.
// This computes a stable, deterministic identity for "the same extracted
// fact from the same processing pass" so a second worker's insert of the
// identical row collapses onto the first's instead of duplicating it. Two
// genuinely different processing passes over the SAME document (e.g. a
// corrected re-upload, which gets its own new policyId/source_document_id)
// never share a dedupe key, so this only ever collapses true duplicates.
function premiumRecordDedupeKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
function evidenceMatches(hay: string, needle: string) {
  const tokens = normalizeEvidence(needle).split(" ").filter((t) => t.length > 1);
  if (!tokens.length) return false;
  const unique = [...new Set(tokens)];
  const hits = unique.filter((t) => hay.includes(t)).length;
  return hits / unique.length >= 0.7;
}

function verifyExtractionEvidence(extraction: PolicyExtraction, pages: { pageNumber: number; text: string }[]) {
  const pageMap = new Map(pages.map((p) => [p.pageNumber, normalizeEvidence(p.text)]));
  return {
    ...extraction,
    insuredPeople: extraction.insuredPeople.map((person) => ({
      ...person,
      coverages: person.coverages.map((coverage) => {
        const hay = coverage.sourcePage ? pageMap.get(coverage.sourcePage) ?? "" : "";
        const needle = coverage.evidenceText ? normalizeEvidence(coverage.evidenceText) : "";
        const nameNeedle = normalizeEvidence(person.name);
        const evidenceVerified = Boolean(hay && needle.length >= 3 && evidenceMatches(hay, coverage.evidenceText ?? "") && hay.includes(nameNeedle));
        return { ...coverage, evidenceVerified };
      }),
    })),
  } satisfies PolicyExtraction;
}

/** The extraction an earlier, successful read of this document stored (not a
 * plain-code fallback), or null. */
async function previousReading(args: ProcessPolicyArgs): Promise<PolicyExtraction | null> {
  try {
    const row = (await query<{ extracted_json: unknown }>(`SELECT extracted_json FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`, [args.policyId, args.accountId])).rows[0];
    const parsed = PolicyExtractionSchema.safeParse(row?.extracted_json);
    if (!parsed.success) return null;
    const codeOnly = parsed.data.documentNotes.some((n) => /read this document's text and tables with plain code/.test(n));
    return codeOnly || (!parsed.data.insuredPeople.length && !parsed.data.insurer && !parsed.data.productName) ? null : parsed.data;
  } catch { return null; }
}

/** Round 9: a reading as it may be stored -- roles by the document's own
 * wording, people and cover re-found on their pages, and every name, figure,
 * unit, date, number and role checked against the printed text. */
export function verifiedExtraction(raw: PolicyExtraction, pages: { pageNumber: number; text: string }[]): PolicyExtraction {
  const roleFromReader = deterministicDocumentRole(pages, null) == null;
  const checked = factCheckExtraction(verifyExtractionEvidence(sanitizePolicyExtraction(raw, pages), pages), pages, { roleFromReader }).extraction;
  return crossCheckPrintedFacts(checked, pages);
}

async function progress(args: ProcessPolicyArgs, stage: string, percent: number, message: string, status?: string) {
  await query(
    `UPDATE policies
        SET processing_stage=$1,
            processing_progress=$2,
            processing_message=$3,
            processing_status=COALESCE($4,processing_status),
            updated_at=now()
      WHERE id=$5 AND account_id=$6`,
    [stage, Math.max(0, Math.min(100, Math.round(percent))), message, status ?? null, args.policyId, args.accountId],
  );
  // Best-effort: a heartbeat failure (including the job's lease already
  // having been lost to another worker, per lib/jobs/queue.ts's
  // LeaseLostError) is logged, never thrown -- this keeps the fix
  // additive rather than changing processPolicy()'s control flow. A
  // worker that has genuinely lost its lease will instead fail to CAS its
  // eventual completeJob()/failJob() call at the end of the run, which
  // lib/jobs/worker-runtime.ts's claimAndProcessOne() already surfaces.
  if (args.jobHeartbeat) {
    await args.jobHeartbeat().catch((error) => {
      console.warn(`processPolicy heartbeat failed for policy ${args.policyId}:`, error instanceof Error ? error.message : error);
    });
  }
}

export async function processPolicy(args: ProcessPolicyArgs) {
  // Round 5: a reading service failed on the last attempt, but the text
  // layer was readable: the document is completed from what code can read.
  let readInPart = false;
  // Quarantine gate (checkpoint 3, claude/v1-launch-hardening): this is the
  // SINGLE entry point for OCR, parsing, structured extraction, embeddings
  // and indexing on a policy document (see lib/rag/processing-queue.ts --
  // it is the only real caller), so gating here covers every route,
  // background job and UI action that can trigger processing, with no
  // separate copy of this check needed anywhere else. Always re-reads the
  // persisted quarantine_status from the database (never trusts anything
  // the caller assumed), so a reprocess or a resumed/retried background
  // job re-checks real state every time rather than an in-memory guess.
  const gate = await runPolicyQuarantineGate({
    accountId: args.accountId,
    policyId: args.policyId,
    readBytes: async () => new Uint8Array(await readPolicyFile(args.storageKey)),
  });
  if (!gate.cleared) return; // Still quarantined/scan_pending, rejected, deleted, or superseded -- the gate itself already recorded why.

  try {
    await ensureEvidenceSchema();
    await query(
      `UPDATE policies SET processing_status='extracting',processing_stage='opening',processing_progress=3,
       processing_message='Opening PDF…',processing_error=NULL,processing_started_at=now(),processing_completed_at=NULL,updated_at=now()
       WHERE id=$1 AND account_id=$2`,
      [args.policyId, args.accountId],
    );

    const file = await readPolicyFile(args.storageKey);
    await progress(args, "reading_pdf", 7, "Reading pages and extracting text…", "extracting");

    // The ORIGINAL uploaded bytes are what is stored; every supported
    // non-PDF format is normalized from them here, at processing time
    // (images become a one-page-per-frame PDF for the ordinary scanned-page
    // OCR path; .docx text is split into stored pages) -- see
    // lib/documents/formats.ts.
    const fileBytes = new Uint8Array(file);
    const sniffed = sniffFileFormat(fileBytes);
    if (!sniffed.ok) {
      console.warn(`Stored file is not in a supported format for policy ${args.policyId}. ${ACCEPTED_FORMATS_MESSAGE}`);
      throw new UserActionableProcessingError(UNOPENABLE_DOCUMENT_MESSAGE);
    }
    let pages;
    // The bytes the OCR step reads pages from: the original PDF, the PDF
    // built from the uploaded image, or null for a .docx (pure text; there
    // is nothing to OCR).
    let ocrSourceBytes: Uint8Array | null = null;
    // Opening the file is local work on the stored bytes: if it fails, the
    // file itself cannot be opened (damaged, not really that format), which
    // no retry will change. The household is told what is unavailable; the
    // parser's own error goes to the diagnostics table only.
    const opening = async <R>(work: () => Promise<R>): Promise<R> => {
      try { return await work(); } catch (error) {
        if (error instanceof UserActionableProcessingError) throw error;
        await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId: args.policyId, failureCode: "DOCUMENT_UNOPENABLE", error }).catch(() => undefined);
        throw new UserActionableProcessingError(UNOPENABLE_DOCUMENT_MESSAGE);
      }
    };
    if (sniffed.format === "docx") {
      await progress(args, "reading_pdf", 12, "Reading the Word document's text…", "extracting");
      pages = await opening(() => docxToPages(fileBytes));
    } else {
      let pdfBytes = fileBytes;
      if (sniffed.format !== "pdf") {
        await progress(args, "reading_pdf", 10, "Preparing the image for reading…", "extracting");
        pdfBytes = new Uint8Array(await opening(() => imageToPdf(fileBytes, sniffed.format)));
      }
      ocrSourceBytes = pdfBytes;
      let lastReportedPage = 0;
      pages = await opening(() => extractPdfPages(pdfBytes, args.pdfPassword, async (completed, total) => {
        // Avoid a database write for every page in very large PDFs. Progress
        // is cosmetic: its failure never fails (or misclassifies) the read.
        if (completed === total || completed - lastReportedPage >= Math.max(1, Math.ceil(total / 12))) {
          lastReportedPage = completed;
          const pct = 7 + (completed / Math.max(total, 1)) * 18;
          await progress(args, "reading_pdf", pct, `Reading page ${completed} of ${total}…`, "extracting").catch(() => undefined);
        }
      }));
    }

    const ocrPageNumbers = ocrSourceBytes ? pagesNeedingOcr(pages) : [];
    if (ocrPageNumbers.length) {
      await progress(
        args,
        "ocr",
        25,
        `Reading ${ocrPageNumbers.length} scanned page${ocrPageNumbers.length === 1 ? "" : "s"} with PaddleOCR…`,
        "extracting",
      );
      try {
        pages = await completePdfPagesWithOcr({
          accountId: args.accountId,
          resourceId: args.policyId,
          bytes: ocrSourceBytes as Uint8Array,
          password: args.pdfPassword,
          pages,
          pageNumbers: ocrPageNumbers,
        });
      } catch (error) {
        // The OCR service failed, not the file. With attempts left the job
        // retries; on the last one a readable text layer is still used (the
        // scanned pages are reported missing), and with none the document is
        // not called unreadable -- reading it simply has not finished.
        const failure = asServiceFailure(error, "OCR");
        const textLayer = pages.reduce((sum, p) => sum + p.text.trim().length, 0);
        if (!(failure instanceof TemporaryProcessingError) || attemptsLeft(args) || textLayer < 100) throw failure;
        await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId: args.policyId, failureCode: "OCR_SERVICE_DEGRADED", error }).catch(() => undefined);
        pages = pages.map((page) => ocrPageNumbers.includes(page.pageNumber) ? { ...page, unreadable: true } : page);
        readInPart = true;
      }
    }

    if (pages.reduce((sum, p) => sum + p.text.length, 0) < 100) {
      console.warn(`Policy ${args.policyId}: not enough readable text after the text layer and OCR.`);
      throw new UserActionableProcessingError(UNREADABLE_DOCUMENT_MESSAGE);
    }
    // Pages the reader could not transcribe even after its own retry: the
    // rest of the document is used, and the household is told which pages
    // are missing.
    const unreadableNote = unreadablePagesNote(pages.filter((p) => p.unreadable).map((p) => p.pageNumber));

    const ocrCount = pages.filter((page) => page.extractionMethod === "ocr").length;
    await progress(
      args,
      "saving_text",
      27,
      `Text extracted from ${pages.length} page${pages.length === 1 ? "" : "s"}${ocrCount ? `, including ${ocrCount} scanned by OCR` : ""}. Saving searchable text…`,
      "extracting",
    );
    await query("DELETE FROM policy_pages WHERE policy_id=$1 AND account_id=$2", [args.policyId, args.accountId]);
    const withMethod = evidenceColumnsReady("policy_pages");
    for (const page of pages) {
      await query(
        withMethod
          ? `INSERT INTO policy_pages(account_id,policy_id,page_number,text,extraction_method) VALUES($1,$2,$3,$4,$5)
             ON CONFLICT(policy_id,page_number) DO UPDATE SET text=EXCLUDED.text,extraction_method=EXCLUDED.extraction_method`
          : `INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)
             ON CONFLICT(policy_id,page_number) DO UPDATE SET text=EXCLUDED.text`,
        withMethod
          ? [args.accountId, args.policyId, page.pageNumber, page.text, page.unreadable ? "unreadable" : page.extractionMethod ?? "native"]
          : [args.accountId, args.policyId, page.pageNumber, page.text],
      );
    }
    const evidencePages = pages.map((p) => ({ page_number: p.pageNumber, text: p.text, extraction_method: p.extractionMethod ?? "native" }));

    const quickReferenceRole = detectHighConfidenceReferenceRole(pages);
    if (quickReferenceRole) {
      await progress(args, "classifying", 39, "Recognised as a reference document. Personal-name AI analysis is not needed.", "extracting");
    } else {
      await progress(args, "classifying", 36, "Checking document type and selecting the strongest evidence pages…", "extracting");
      await progress(args, "ai_extraction", 42, "Reading a compact evidence sample from this document…", "extracting");
    }

    let raw: PolicyExtraction;
    try {
      raw = await extractPolicyStructure(pages, { accountId: args.accountId, policyId: args.policyId });
    } catch (error) {
      // The reading service failed on a document whose text is readable.
      // With attempts left, the job retries. On the last attempt the
      // document is NOT failed: what code can read (its role, tables,
      // conditions and text search) is kept, nobody is guessed as insured,
      // and one later re-read is scheduled to finish the rest.
      const failure = asServiceFailure(error, "Policy reading");
      if (!(failure instanceof TemporaryProcessingError) || attemptsLeft(args)) throw failure;
      await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId: args.policyId, failureCode: "READING_SERVICE_DEGRADED", error }).catch(() => undefined);
      // Round 9: a re-read that fails never erases what an earlier read of
      // this same document established (and verified): that reading is used
      // again, re-checked below against these pages. Only a document never
      // read before falls back to what plain code can read.
      const previous = await previousReading(args);
      if (previous) raw = previous;
      else { raw = buildCodeOnlyExtraction(pages); readInPart = true; }
    }
    await progress(args, "verifying", 56, "Verifying extracted facts against the original PDF text…", "extracting");
    // Round 9: every name, figure, unit, date, person, number and role the
    // reading reports is re-found in the document's own pages (fact-check.ts);
    // what is not printed is not kept.
    const extraction = verifiedExtraction(raw, pages);
    // The reading named people, and none of them is printed in the document:
    // nobody is linked by name. Like a reading that could not finish, the
    // document stays with the profile it was uploaded to, for review.
    const namedNobodyPrinted = raw.insuredPeople.some((p) => looksLikeActualPersonName(p.name)) && extraction.insuredPeople.length === 0
      && !REFERENCE_ROLES.has(extraction.documentRole ?? "");
    // Deterministic cross-check of names against the household: when exactly
    // one family member's full name is printed in the document, that is who
    // it names (linked for review, with no cover amounts confirmed).
    const family = await familyMembersForAccount(args.accountId);
    let linkedByPrintedName = false;
    if (namedNobodyPrinted) {
      const fullText = pages.map((p) => p.text).join("\n");
      const printed = family.filter((m) => personPrinted(fullText, m.display_name));
      if (printed.length === 1) { extraction.insuredPeople = [{ name: printed[0].display_name, relationshipHint: null, coverages: [] }]; linkedByPrintedName = true; }
    }
    const documentDate = documentDateFrom(pages, [extraction.startDate]);
    const authority = documentAuthority(extraction.documentRole, extraction.personalCoverageConfirmed);

    await query(
      `UPDATE policies SET insurer=$1,product_name=$2,policy_number=$3,group_policy_number=$4,policy_type=$5,document_role=$6,
       personal_coverage_confirmed=$7,document_authority=$8,document_authority_label=$9,effective_date=$10,renewal_or_expiry_date=$11,
       page_count=$12,extracted_json=$13::jsonb,processing_status='indexing',processing_stage='organising',processing_progress=61,
       processing_message='Organising people, coverage and payment evidence…',updated_at=now()
       WHERE id=$14 AND account_id=$15`,
      [
        extraction.insurer, extraction.productName, extraction.policyNumber, extraction.groupPolicyNumber, extraction.policyType, extraction.documentRole,
        extraction.personalCoverageConfirmed, authority.level, authority.label, extraction.startDate || null, extraction.renewalOrExpiryDate || null,
        pages.length, JSON.stringify(extraction), args.policyId, args.accountId,
      ],
    );
    if (evidenceColumnsReady("policies")) {
      await query(`UPDATE policies SET document_date=$3 WHERE id=$1 AND account_id=$2`, [args.policyId, args.accountId, documentDate]);
    }

    // Clear generated data before rebuilding. Preserve explicit manual/upload links.
    await query(`DELETE FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND source IN ('ai_name_match','scheme_reference_match','legacy_upload')`, [args.policyId, args.accountId]);
    const isPaymentDocument = ["premium_receipt", "renewal_statement", "annual_statement"].includes(extraction.documentRole ?? "");
    if (args.linkUploadMember && (isPaymentDocument || readInPart || (namedNobodyPrinted && !linkedByPrintedName)) && !extraction.personalCoverageConfirmed) {
      await query(
        `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence)
         VALUES($1,$2,$3,'upload_hint',0.70) ON CONFLICT(policy_id,family_member_id) DO NOTHING`,
        [args.policyId, args.familyMemberId, args.accountId],
      );
    }
    // A personal document's upload-profile link is regenerated below from what
    // this read found (it is only ever a fallback for an unmatched name), so a
    // re-read never leaves a stale one behind. Payment documents keep theirs.
    if (extraction.personalCoverageConfirmed) {
      await query(`DELETE FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND source='upload_hint'`, [args.policyId, args.accountId]);
    }
    await query("DELETE FROM policy_detected_people WHERE policy_id=$1 AND account_id=$2", [args.policyId, args.accountId]);
    await query("DELETE FROM policy_coverages WHERE policy_id=$1 AND account_id=$2", [args.policyId, args.accountId]);
    await query("DELETE FROM policy_reference_coverages WHERE policy_id=$1 AND account_id=$2", [args.policyId, args.accountId]);
    await query("DELETE FROM premium_records WHERE source_document_id=$1 AND account_id=$2", [args.policyId, args.accountId]);

    for (const ref of extraction.referenceCoverages) {
      await query(
        `INSERT INTO policy_reference_coverages(account_id,policy_id,category,product_name,notes,source_page) VALUES($1,$2,$3,$4,$5,$6)`,
        [args.accountId, args.policyId, normalizeCoverageCategory(ref.category || ref.productName || "Other"), ref.productName, ref.notes, ref.sourcePage],
      );
    }

    const detected: { name: string; matchedMemberId: string | null }[] = [];
    const uploadProfileLinks: string[] = [];
    // A partial match ("Charmaine" for "Charmaine Tan") only stands when no
    // other person printed on this document lands on the same profile: two
    // printed Charmaines are never both folded into one profile.
    const matches = extraction.insuredPeople.map((person) => findFamilyMatchWithKind(person.name, family));
    const hitsPerMember = new Map<string, number>();
    for (const found of matches) if (found) hitsPerMember.set(found.member.id, (hitsPerMember.get(found.member.id) ?? 0) + 1);
    for (const [index, person] of extraction.insuredPeople.entries()) {
      const candidate = matches[index];
      const found = candidate && (candidate.kind === "exact" || hitsPerMember.get(candidate.member.id) === 1) ? candidate : null;
      let match = found?.member ?? null;
      let link: { source: "ai_name_match" | "upload_hint"; confidence: number } = found?.kind === "partial"
        ? { source: "ai_name_match", confidence: 0.85 }
        : { source: "ai_name_match", confidence: 0.95 };
      // The printed name matched no profile, but the person uploaded this
      // document to a profile they chose, and it names exactly ONE insured
      // person: that choice is the link (flagged for review below). With
      // several named people nothing is guessed.
      if (!match && args.linkUploadMember && extraction.personalCoverageConfirmed && extraction.insuredPeople.length === 1) {
        match = family.find((member) => member.id === args.familyMemberId) ?? null;
        if (match) { link = { source: "upload_hint", confidence: 0.70 }; uploadProfileLinks.push(`${person.name} (linked to ${match.display_name}, the profile it was uploaded to)`); }
      }
      await query(
        `INSERT INTO policy_detected_people(account_id,policy_id,detected_name,matched_family_member_id,confidence) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(policy_id,detected_name) DO UPDATE SET matched_family_member_id=EXCLUDED.matched_family_member_id,confidence=EXCLUDED.confidence`,
        [args.accountId, args.policyId, person.name, match?.id ?? null, match ? link.confidence : 0.60],
      );
      detected.push({ name: person.name, matchedMemberId: match?.id ?? null });
      if (match) {
        await syncInsuredPersonToMember({ accountId: args.accountId, sourcePolicyId: args.policyId, familyMemberId: match.id, detectedName: person.name, extraction, link });
      }
    }

    // Evidence for each coverage row: the passage, and whether the insured
    // person's printed name, the amount and the currency are all in it.
    try {
      const printedNames = new Map(detected.filter((d) => d.matchedMemberId).map((d) => [d.matchedMemberId as string, d.name]));
      await annotateCoverageEvidence(args.accountId, args.policyId, evidencePages, printedNames);
    } catch (error) { console.warn("Coverage evidence could not be written for policy " + args.policyId + ":", error instanceof Error ? error.message : error); }
    const matchedIds = [...new Set(detected.map((d) => d.matchedMemberId).filter((id): id is string => Boolean(id)))];
    const paymentSplit = paymentSplitNote(pages.map((p) => p.text).join("\n"));
    const unnamedPaymentTarget = matchedIds.length === 1 ? matchedIds[0] : (args.linkUploadMember && isPaymentDocument ? args.familyMemberId : null);
    for (const [paymentIndex, payment] of extraction.paymentRecords.filter((p) => p.amount != null && !p.insuredPersonName).entries()) {
      if (!extraction.personalCoverageConfirmed && !["premium_receipt", "renewal_statement", "annual_statement"].includes(extraction.documentRole ?? "")) continue;
      const dedupeKey = premiumRecordDedupeKey([
        "payment", paymentIndex, unnamedPaymentTarget, payment.insurer ?? extraction.insurer, payment.productName ?? extraction.productName,
        payment.policyNumber ?? extraction.policyNumber, payment.amount, printedCurrencyCode(payment.currency), payment.frequency,
        payment.paymentDate || null, payment.periodStart || null, payment.periodEnd || null, payment.sourcePage,
      ]);
      await query(
        `INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency,payment_date,period_start,period_end,source_document_id,source_page,notes,dedupe_key)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (source_document_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE SET
           family_member_id=EXCLUDED.family_member_id, insurer=EXCLUDED.insurer, product_name=EXCLUDED.product_name,
           policy_number=EXCLUDED.policy_number, amount=EXCLUDED.amount, currency=EXCLUDED.currency, frequency=EXCLUDED.frequency,
           payment_date=EXCLUDED.payment_date, period_start=EXCLUDED.period_start, period_end=EXCLUDED.period_end,
           source_page=EXCLUDED.source_page, notes=EXCLUDED.notes`,
        [args.accountId, args.policyId, unnamedPaymentTarget, payment.insurer ?? extraction.insurer, payment.productName ?? extraction.productName,
          payment.policyNumber ?? extraction.policyNumber, payment.amount, printedCurrencyCode(payment.currency), payment.frequency, payment.paymentDate || null,
          payment.periodStart || null, payment.periodEnd || null, args.policyId, payment.sourcePage,
          [payment.notes, matchedIds.length > 1 ? "Shared/aggregate payment across linked insured people" : null].filter(Boolean).join(" · ") || null,
          dedupeKey],
      );
    }
    if (extraction.premium.amount != null && extraction.personalCoverageConfirmed && extraction.paymentRecords.length === 0) {
      const target = matchedIds.length === 1 ? matchedIds[0] : null;
      const dedupeKey = premiumRecordDedupeKey([
        "current_premium", target, extraction.insurer, extraction.productName, extraction.policyNumber, extraction.premium.amount,
        printedCurrencyCode(extraction.premium.currency), extraction.premium.frequency,
      ]);
      await query(
        `INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency,source_document_id,notes,dedupe_key)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (source_document_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE SET
           family_member_id=EXCLUDED.family_member_id, insurer=EXCLUDED.insurer, product_name=EXCLUDED.product_name,
           policy_number=EXCLUDED.policy_number, amount=EXCLUDED.amount, currency=EXCLUDED.currency, frequency=EXCLUDED.frequency,
           notes=EXCLUDED.notes`,
        [args.accountId, args.policyId, target, extraction.insurer, extraction.productName, extraction.policyNumber, extraction.premium.amount,
          printedCurrencyCode(extraction.premium.currency), extraction.premium.frequency, args.policyId,
          target ? "Extracted current premium from personalised policy document" : "Shared/aggregate premium across linked insured people",
          dedupeKey],
      );
    }

    // The MediSave and cash portions the notice prints, on every premium
    // record read from it (named or not).
    if (isPaymentDocument && paymentSplit) {
      await query(`UPDATE premium_records SET notes=concat_ws(' · ',nullif(notes,''),$3::text) WHERE account_id=$1 AND source_document_id=$2`,
        [args.accountId, args.policyId, paymentSplit]);
    }
    await linkRelatedReferenceDocuments(args.accountId, args.policyId, extraction.groupPolicyNumber);

    const unverified = extraction.insuredPeople.flatMap((p) => p.coverages).filter((c) => !c.evidenceVerified).length;
    const unmatched = detected.filter((d) => !d.matchedMemberId).length;
    const needsReview = Boolean((extraction.personalCoverageConfirmed && (unmatched > 0 || unverified > 0 || uploadProfileLinks.length > 0)) || namedNobodyPrinted);
    const reasons = [
      unmatched ? `${unmatched} named insured ${unmatched === 1 ? "person is" : "people are"} not linked to a family profile` : null,
      uploadProfileLinks.length ? `The name on this document does not match a family profile, so it was linked to the profile it was uploaded to: ${uploadProfileLinks.join("; ")}. Check this is the right person` : null,
      unverified ? `${unverified} extracted coverage item${unverified === 1 ? "" : "s"} could not be source-verified` : null,
      namedNobodyPrinted ? (linkedByPrintedName ? "The people this document was read as covering are not named in it; it was linked to the one family member whose name it prints. Check this is the right person"
        : "The people this document was read as covering are not named in it, so it was kept with the profile it was uploaded to. Check this is the right person") : null,
    ].filter(Boolean).join("; ");
    await query(`UPDATE policies SET needs_review=$1,review_reason=$2 WHERE id=$3 AND account_id=$4`, [needsReview, reasons || null, args.policyId, args.accountId]);

    const chunks = chunkPages(pages);
    await query("DELETE FROM policy_chunks WHERE policy_id=$1 AND account_id=$2", [args.policyId, args.accountId]);
    // Re-reading a document must not leave the previous read's sentences in the
    // vector index, where they would go on answering questions about pages that
    // no longer exist.
    if (pineconeEnabled()) await deletePolicyPassages({ accountId: args.accountId, policyId: args.policyId })
      .catch((error) => console.warn("Pinecone cleanup failed for policy " + args.policyId + ":", error instanceof Error ? error.message : error));
    await progress(args, "indexing", 69, `Preparing ${chunks.length} search section${chunks.length === 1 ? "" : "s"}…`, "indexing");

    const configuredBatchSize = Number.parseInt(process.env.EMBED_BATCH_SIZE ?? "4", 10);
    const batchSize = Number.isFinite(configuredBatchSize) ? Math.min(Math.max(configuredBatchSize, 1), 12) : 4;
    if (pineconeEnabled()) {
      // Pinecone holds the vectors and does the embedding, so this stores each
      // passage once in Postgres -- still the one source of truth for the text
      // itself -- and sends the same text to Pinecone for semantic search.
      // Indexing is part of the upload the person is already waiting through,
      // never a separate command they have to know about.
      const stored: { chunkId: string; policyId: string; pageStart: number; pageEnd: number; heading: string | null; text: string }[] = [];
      for (const c of chunks) {
        const inserted = await query<{ id: string }>(
          `INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,heading,text)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [args.accountId, args.familyMemberId, args.policyId, c.pageStart, c.pageEnd, c.heading, c.text],
        );
        const chunkId = inserted.rows[0]?.id;
        if (chunkId) stored.push({ chunkId, policyId: args.policyId, pageStart: c.pageStart, pageEnd: c.pageEnd, heading: c.heading, text: c.text });
      }
      try {
        await indexPolicyPassages({
          accountId: args.accountId, policyId: args.policyId, passages: stored,
          report: (indexed, total) => { void progress(args, "indexing", 70 + (indexed / Math.max(total, 1)) * 24,
            `Building semantic search index ${indexed} of ${total}…`, "indexing"); },
        });
      } catch (error) {
        // Semantic search improves on keyword search; it is not a precondition
        // for it. Every passage is already stored and findable, so record the
        // gap where the person can see it and let the upload finish.
        const detail = error instanceof Error ? error.message : "Unknown indexing error";
        console.warn("Pinecone indexing failed for policy " + args.policyId + ":", detail);
        await query(
          `UPDATE policies SET needs_review=true,
             review_reason=coalesce(nullif(review_reason,''),'') ||
               CASE WHEN coalesce(review_reason,'')='' THEN '' ELSE '; ' END ||
               'Semantic search could not be built for this document, so questions about it rely on keyword matching until it is re-analysed'
           WHERE id=$1 AND account_id=$2`,
          [args.policyId, args.accountId],
        ).catch(() => { /* Never let the note itself fail the upload. */ });
      }
    } else {
      // No vector database configured: the passages are still stored and still
      // findable by keyword, which is a worse answer, never a missing one.
      await progress(args, "indexing", 80, `Saving ${chunks.length} searchable section${chunks.length === 1 ? "" : "s"}…`, "indexing");
      for (const c of chunks)
        await query(
          `INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,heading,text) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [args.accountId, args.familyMemberId, args.policyId, c.pageStart, c.pageEnd, c.heading, c.text],
        );
    }

    // Read the benefit rules now, once, while the user already expects to wait.
    // Every later question is then answered from the stored table without
    // reading this document again. A failure here leaves the document fully
    // usable: questions fall back to reading it at question time.
    // The benefit summary the finished document shows ("Ready. 4 benefit rules
    // read…"). Kept here because later progress messages overwrite the column.
    let benefitSummary: string | null = null;
    // A renewal notice, premium receipt or annual statement states what is
    // PAID ("Less: MediSave deduction", "Total cash payable"), not what the
    // plan pays: its lines are premium records (above), never benefits.
    if (isPaymentDocument) {
      const { replaceBenefitCatalog } = await import("@/lib/policies/benefit-catalog");
      await replaceBenefitCatalog(args.accountId, args.policyId, []).catch(() => undefined);
    } else try {
      await progress(args, "benefits", 82, "Reading the benefit rules page by page. This is the slow part, and it only happens once…", "indexing");
      const { catalogueDocument } = await import("@/lib/policies/catalog-builder");
      const stored = await catalogueDocument({
        accountId: args.accountId, policyId: args.policyId, productName: extraction.productName ?? null,
        pages: evidencePages,
        products: extraction.productsMentioned ?? [],
        report: (page, total) => { void progress(args, "benefits", 82 + Math.round((page / Math.max(1, total)) * 14),
          "Reading the benefit rules — page " + page + " of " + total + "…", "indexing"); },
      });
      const attention = await query<{ count: number }>(
        `SELECT count(*)::int AS count FROM policy_benefits WHERE account_id=$1 AND policy_id=$2 AND (formula_kind='none' OR (basis_inferred AND reviewed_at IS NULL))`,
        [args.accountId, args.policyId]).then(r => Number(r.rows[0]?.count ?? 0)).catch(() => 0);
      benefitSummary = stored + " benefit rule" + (stored === 1 ? "" : "s") + " read from this document"
        + (attention ? "; " + attention + " to confirm on the Benefits page" : "") + ".";
      await progress(args, "benefits", 96, benefitSummary, "indexing");
      // The other half of the contract. The benefit pass answers "how much";
      // this answers "unless" -- the exclusions, waiting periods, survival
      // periods and caps that live in prose and that a table parser walks
      // straight past. Read here, once, for the same reason.
      try {
        await progress(args, "conditions", 96, "Reading the exclusions and waiting periods…", "indexing");
        const { catalogueConditions } = await import("@/lib/policies/condition-catalog");
        const conditions = await catalogueConditions({
          accountId: args.accountId, policyId: args.policyId, productName: extraction.productName ?? null,
          pages: pages.map(page => ({ page_number: page.pageNumber, text: page.text })),
          report: (page, total) => { void progress(args, "conditions", 96,
            "Reading the exclusions and waiting periods — page " + page + " of " + total + "…", "indexing"); },
        });
        await progress(args, "conditions", 98, conditions + " policy condition" + (conditions === 1 ? "" : "s")
          + " read from this document.", "indexing");
      } catch { /* A document whose conditions cannot be read keeps its benefits. */ }
    } catch (error) {
      // Swallowing this silently told the person "Analysis complete" while the
      // document had in fact been read for nothing: every later question then
      // fell back to the slow path with no explanation. Record it so it shows
      // up as a document needing attention, and carry on — the document itself
      // is still fully usable.
      await query(
        `UPDATE policies SET needs_review=true,
           review_reason=coalesce(nullif(review_reason,''),'') ||
             CASE WHEN coalesce(review_reason,'')='' THEN '' ELSE '; ' END ||
             'DearPolicy could not finish reading this document''s benefit rules, so its amounts are not on the Benefits page yet'
         WHERE id=$1 AND account_id=$2`,
        [args.policyId, args.accountId],
      ).catch(() => { /* Never let the note itself fail the upload. */ });
      console.warn("Benefit cataloguing failed for policy " + args.policyId + ":", error instanceof Error ? error.message : error);
    }

    // Round 5: each linked person's column of a multi-column table (plan
    // tier / person class), and a hospital plan's Portfolio cover from its
    // policy-year limit when the reading left none that can be shown.
    try {
      const { applyMemberTiers } = await import("@/lib/policies/member-tiers");
      await applyMemberTiers({
        accountId: args.accountId, policyId: args.policyId, text: pages.map((p) => p.text).join("\n"),
        people: detected.filter((d) => d.matchedMemberId).map((d) => ({ name: d.name, memberId: d.matchedMemberId as string,
          relationshipHint: extraction.insuredPeople.find((p) => p.name === d.name)?.relationshipHint ?? null })),
        policyType: extraction.policyType ?? null, productName: extraction.productName ?? null,
        personalCoverageConfirmed: extraction.personalCoverageConfirmed,
      });
    } catch (error) { console.warn("Member tiers could not be written for policy " + args.policyId + ":", error instanceof Error ? error.message : error); }
    await progress(args, "finalising", 97, "Final checks and portfolio update…", "indexing");
    await query(
      `UPDATE policies SET processing_status='ready',processing_stage='complete',processing_progress=100,
       processing_message=$3,
       processing_error=NULL,processing_completed_at=now(),updated_at=now()
       WHERE id=$1 AND account_id=$2`,
      // V1.1: the household sees that the document is ready and, when some
      // pages could not be read, what is unavailable -- not counts of
      // internal rules or tasks to confirm them (benefitSummary stays in
      // the progress history above for operators).
      [args.policyId, args.accountId, readInPart ? DOCUMENT_READ_IN_PART_MESSAGE : unreadableNote ? "Ready. " + unreadableNote : "Ready."],
    );
    if (readInPart) {
      await query(
        `UPDATE policies SET needs_review=true,review_reason=concat_ws('; ',nullif(review_reason,''),$3::text) WHERE id=$1 AND account_id=$2`,
        [args.policyId, args.accountId, "DearPolicy has not finished reading who this document covers and its cover amounts; it will try again automatically"],
      ).catch(() => undefined);
      await scheduleDeferredRead(args);
    }
    // The Coverage Ledger gains this document's rows the moment it is ready,
    // so the next payout question is a lookup rather than a read.
    try {
      // No status argument here: the document was already marked 'ready' just
      // above, and this progress() call previously passed "indexing" as the
      // status override, which flipped processing_status back from 'ready' to
      // 'indexing' -- and nothing after this step ever set it back. The Coverage
      // Ledger read (a background enhancement) would then leave every
      // successfully-processed document stuck showing as "processing" in the
      // UI forever, even though the analysis and the ledger rows were both
      // already done. Omitting the status here leaves it at 'ready' via the
      // COALESCE in progress().
      // The document is already 'ready' with its final stage and message
      // ("Ready. N benefit rules read…"); a progress() write here used to
      // leave it at stage 'finalising', 98% and "Reading the document into
      // your coverage ledger…" for good. Only keep the job lease alive.
      if (args.jobHeartbeat) await args.jobHeartbeat().catch(() => undefined);
      const { readDocumentIntoLedger } = await import("@/lib/ledger/extract");
      // A payment document states premiums, not cover: nothing to read into the ledger.
      if (!isPaymentDocument) await readDocumentIntoLedger({ accountId: args.accountId, policyId: args.policyId }).catch((error) => {
        console.warn("Ledger reading failed for policy " + args.policyId + ":", error instanceof Error ? error.message : error);
      });
      const { seedLedger } = await import("@/lib/ledger/store");
      await seedLedger(args.accountId);
      // Rows seeded from the benefit catalogue get the same evidence columns
      // (and inherit any conflict) as the rows they came from.
      await annotateLedgerEvidence(args.accountId, args.policyId);
      await markConflicts(args.accountId, args.policyId);
    } catch (error) {
      console.warn("Coverage ledger update failed for policy " + args.policyId + ":", error instanceof Error ? error.message : error);
    }
    // Checkpoint 14i: "Policy ingest/extraction" was named as a required
    // telemetry call site (scripts/launch-check.ts's privacy_safe_
    // observability capability) -- processPolicy() is the SINGLE entry
    // point for OCR, extraction AND embeddings/indexing on a policy
    // document (see this function's own doc comment above), so one event
    // at its real success/failure boundary genuinely covers all three,
    // the same "one call = one event" convention every other Checkpoint
    // 14b/14i call site uses. Fire-and-forget, never awaited.
    void recordEvent({
      name: "rag.policy_ingest.completed",
      correlationId: resolveCorrelationId(undefined),
      status: "success",
      householdRef: pseudonymizeId(args.accountId),
      resourceRef: pseudonymizeId(args.policyId),
      extra: { pages: pages.length, chunks: chunks.length, needsReview, pineconeEnabled: pineconeEnabled() },
    });
    return { pages: pages.length, chunks: chunks.length, extraction, detectedPeople: detected, needsReview };
  } catch (error) {
    // policies.processing_error is household-readable (RLS SELECT): store the
    // fixed message only; the raw error goes to the service-only diagnostics
    // table (lib/diagnostics/processing-failures.ts).
    await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId: args.policyId, failureCode: "PROCESSING_FAILED", error });
    // V1.1: a temporary failure (provider timeout, rate limit, network) with
    // job attempts left is retried automatically by the durable queue
    // (lib/jobs/pipeline-worker.ts classifyPipelineError, bounded by
    // background_jobs.max_attempts). The household sees that reading
    // continues -- not a failure, and nothing to click. Every stage replaces
    // its own output, and model readings are cached by content, so the retry
    // neither duplicates facts nor pays for work already done.
    const willRetry = !(error instanceof UserActionableProcessingError)
      && classifyPipelineError(error) === "transient"
      && !!args.attempt && args.attempt.number < args.attempt.max;
    if (willRetry) {
      await query(
        `UPDATE policies SET processing_status='queued',processing_stage='retrying',processing_message=$1,processing_error=NULL,updated_at=now() WHERE id=$2 AND account_id=$3`,
        [DOCUMENT_READING_RETRY_MESSAGE, args.policyId, args.accountId],
      ).catch(() => undefined);
      void recordErrorEvent({ name: "rag.policy_ingest.retrying", correlationId: resolveCorrelationId(undefined), householdRef: pseudonymizeId(args.accountId), resourceRef: pseudonymizeId(args.policyId), error });
      throw error;
    }
    // A reason the person can act on (missing/wrong PDF password) is stored
    // verbatim so the UI can say what to do; every other failure keeps the
    // fixed message and its raw detail stays in the diagnostics table.
    // Round 5: a reading service that is still failing after the job's own
    // attempts is not an unreadable document. One later re-read is scheduled
    // and the household is told reading will continue.
    if (error instanceof TemporaryProcessingError && await scheduleDeferredRead(args)) {
      await query(
        `UPDATE policies SET processing_status='queued',processing_stage='retry_scheduled',processing_message=$1,processing_error=NULL,updated_at=now() WHERE id=$2 AND account_id=$3`,
        [DOCUMENT_READING_SERVICE_MESSAGE, args.policyId, args.accountId],
      ).catch(() => undefined);
      void recordErrorEvent({ name: "rag.policy_ingest.retry_scheduled", correlationId: resolveCorrelationId(undefined), householdRef: pseudonymizeId(args.accountId), resourceRef: pseudonymizeId(args.policyId), error });
      throw error;
    }
    const userReason = error instanceof UserActionableProcessingError && USER_ACTIONABLE_PROCESSING_ERRORS.has(error.message) ? error.message
      : error instanceof TemporaryProcessingError ? DOCUMENT_READING_SERVICE_MESSAGE : DOCUMENT_READING_FAILED_MESSAGE;
    await query(
      `UPDATE policies SET processing_status='failed',processing_stage='failed',processing_message='Analysis stopped',processing_error=$1,
       processing_completed_at=now(),updated_at=now() WHERE id=$2 AND account_id=$3`,
      [userReason ?? POLICY_PROCESSING_FAILED_MESSAGE, args.policyId, args.accountId],
    ).catch(() => undefined);
    void recordErrorEvent({
      name: "rag.policy_ingest.failed",
      correlationId: resolveCorrelationId(undefined),
      householdRef: pseudonymizeId(args.accountId),
      resourceRef: pseudonymizeId(args.policyId),
      error,
    });
    throw error;
  }
}
