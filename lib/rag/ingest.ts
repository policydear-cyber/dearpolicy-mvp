import { query } from "@/lib/db/client";
import { readPolicyFile } from "@/lib/storage";
import { extractPdfPages } from "@/lib/documents/pdf";
import { completePdfPagesWithOcr, pagesNeedingOcr } from "@/lib/documents/ocr";
import { chunkPages } from "@/lib/documents/chunk";
import { embeddingsEnabled, toPgVector, withEmbeddingSession } from "@/lib/ai/embeddings";
import { deletePolicyPassages, indexPolicyPassages, pineconeEnabled } from "@/lib/rag/pinecone";
import { extractPolicyStructure, detectHighConfidenceReferenceRole, type PolicyExtraction } from "@/lib/ai/extract-policy";
import { documentAuthority, sanitizePolicyExtraction } from "@/lib/documents/intelligence";
import { normalizeCoverageCategory } from "@/lib/insurance";
import { familyMembersForAccount, findFamilyMatch, linkRelatedReferenceDocuments, syncInsuredPersonToMember } from "@/lib/policies/linking";
import { normalizeCurrencyCode } from "@/lib/format/currency";

export type ProcessPolicyArgs = {
  accountId: string;
  familyMemberId: string;
  policyId: string;
  storageKey: string;
  pdfPassword?: string;
  linkUploadMember?: boolean;
};

function normalizeEvidence(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
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
}

export async function processPolicy(args: ProcessPolicyArgs) {
  try {
    await query(
      `UPDATE policies SET processing_status='extracting',processing_stage='opening',processing_progress=3,
       processing_message='Opening PDF…',processing_error=NULL,processing_started_at=now(),processing_completed_at=NULL,updated_at=now()
       WHERE id=$1 AND account_id=$2`,
      [args.policyId, args.accountId],
    );

    const file = await readPolicyFile(args.storageKey);
    await progress(args, "reading_pdf", 7, "Reading pages and extracting text…", "extracting");

    let lastReportedPage = 0;
    const fileBytes = new Uint8Array(file);
    let pages = await extractPdfPages(fileBytes, args.pdfPassword, async (completed, total) => {
      // Avoid a database write for every page in very large PDFs.
      if (completed === total || completed - lastReportedPage >= Math.max(1, Math.ceil(total / 12))) {
        lastReportedPage = completed;
        const pct = 7 + (completed / Math.max(total, 1)) * 18;
        await progress(args, "reading_pdf", pct, `Reading PDF page ${completed} of ${total}…`, "extracting");
      }
    });

    const ocrPageNumbers = pagesNeedingOcr(pages);
    if (ocrPageNumbers.length) {
      await progress(
        args,
        "ocr",
        25,
        `Reading ${ocrPageNumbers.length} scanned page${ocrPageNumbers.length === 1 ? "" : "s"} with PaddleOCR…`,
        "extracting",
      );
      pages = await completePdfPagesWithOcr({
        accountId: args.accountId,
        bytes: fileBytes,
        password: args.pdfPassword,
        pages,
        pageNumbers: ocrPageNumbers,
      });
    }

    if (pages.reduce((sum, p) => sum + p.text.length, 0) < 100) {
      throw new Error("DearPolicy could not obtain enough readable text from this PDF, even after checking its text layer and available OCR.");
    }

    const ocrCount = pages.filter((page) => page.extractionMethod === "ocr").length;
    await progress(
      args,
      "saving_text",
      27,
      `Text extracted from ${pages.length} page${pages.length === 1 ? "" : "s"}${ocrCount ? `, including ${ocrCount} scanned by OCR` : ""}. Saving searchable text…`,
      "extracting",
    );
    await query("DELETE FROM policy_pages WHERE policy_id=$1 AND account_id=$2", [args.policyId, args.accountId]);
    for (const page of pages) {
      await query(
        `INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)
         ON CONFLICT(policy_id,page_number) DO UPDATE SET text=EXCLUDED.text`,
        [args.accountId, args.policyId, page.pageNumber, page.text],
      );
    }

    const quickReferenceRole = detectHighConfidenceReferenceRole(pages);
    if (quickReferenceRole) {
      await progress(args, "classifying", 39, "Recognised as a reference document. Personal-name AI analysis is not needed.", "extracting");
    } else {
      await progress(args, "classifying", 36, "Checking document type and selecting the strongest evidence pages…", "extracting");
      await progress(args, "ai_extraction", 42, "Reading a compact evidence sample from this document…", "extracting");
    }

    const raw = await extractPolicyStructure(pages);
    await progress(args, "verifying", 56, "Verifying extracted facts against the original PDF text…", "extracting");
    const extraction = verifyExtractionEvidence(sanitizePolicyExtraction(raw, pages), pages);
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

    // Clear generated data before rebuilding. Preserve explicit manual/upload links.
    await query(`DELETE FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND source IN ('ai_name_match','scheme_reference_match','legacy_upload')`, [args.policyId, args.accountId]);
    const isPaymentDocument = ["premium_receipt", "renewal_statement", "annual_statement"].includes(extraction.documentRole ?? "");
    if (args.linkUploadMember && isPaymentDocument && !extraction.personalCoverageConfirmed) {
      await query(
        `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence)
         VALUES($1,$2,$3,'upload_hint',0.70) ON CONFLICT(policy_id,family_member_id) DO NOTHING`,
        [args.policyId, args.familyMemberId, args.accountId],
      );
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

    const family = await familyMembersForAccount(args.accountId);
    const detected: { name: string; matchedMemberId: string | null }[] = [];
    for (const person of extraction.insuredPeople) {
      const match = findFamilyMatch(person.name, family);
      await query(
        `INSERT INTO policy_detected_people(account_id,policy_id,detected_name,matched_family_member_id,confidence) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(policy_id,detected_name) DO UPDATE SET matched_family_member_id=EXCLUDED.matched_family_member_id,confidence=EXCLUDED.confidence`,
        [args.accountId, args.policyId, person.name, match?.id ?? null, match ? 0.98 : 0.60],
      );
      detected.push({ name: person.name, matchedMemberId: match?.id ?? null });
      if (match) {
        await syncInsuredPersonToMember({ accountId: args.accountId, sourcePolicyId: args.policyId, familyMemberId: match.id, detectedName: person.name, extraction });
      }
    }

    const matchedIds = [...new Set(detected.map((d) => d.matchedMemberId).filter((id): id is string => Boolean(id)))];
    const unnamedPaymentTarget = matchedIds.length === 1 ? matchedIds[0] : (args.linkUploadMember && isPaymentDocument ? args.familyMemberId : null);
    for (const payment of extraction.paymentRecords.filter((p) => p.amount != null && !p.insuredPersonName)) {
      if (!extraction.personalCoverageConfirmed && !["premium_receipt", "renewal_statement", "annual_statement"].includes(extraction.documentRole ?? "")) continue;
      await query(
        `INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency,payment_date,period_start,period_end,source_document_id,source_page,notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [args.accountId, args.policyId, unnamedPaymentTarget, payment.insurer ?? extraction.insurer, payment.productName ?? extraction.productName,
          payment.policyNumber ?? extraction.policyNumber, payment.amount, normalizeCurrencyCode(payment.currency,"SGD"), payment.frequency, payment.paymentDate || null,
          payment.periodStart || null, payment.periodEnd || null, args.policyId, payment.sourcePage,
          [payment.notes, matchedIds.length > 1 ? "Shared/aggregate payment across linked insured people" : null].filter(Boolean).join(" · ") || null],
      );
    }
    if (extraction.premium.amount != null && extraction.personalCoverageConfirmed && extraction.paymentRecords.length === 0) {
      const target = matchedIds.length === 1 ? matchedIds[0] : null;
      await query(
        `INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency,source_document_id,notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [args.accountId, args.policyId, target, extraction.insurer, extraction.productName, extraction.policyNumber, extraction.premium.amount,
          normalizeCurrencyCode(extraction.premium.currency,"SGD"), extraction.premium.frequency, args.policyId,
          target ? "Extracted current premium from personalised policy document" : "Shared/aggregate premium across linked insured people"],
      );
    }

    await linkRelatedReferenceDocuments(args.accountId, args.policyId, extraction.groupPolicyNumber);

    const unverified = extraction.insuredPeople.flatMap((p) => p.coverages).filter((c) => !c.evidenceVerified).length;
    const unmatched = detected.filter((d) => !d.matchedMemberId).length;
    const needsReview = Boolean(extraction.personalCoverageConfirmed && (unmatched > 0 || unverified > 0));
    const reasons = [
      unmatched ? `${unmatched} named insured ${unmatched === 1 ? "person is" : "people are"} not linked to a family profile` : null,
      unverified ? `${unverified} extracted coverage item${unverified === 1 ? "" : "s"} could not be source-verified` : null,
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
    } else if (!embeddingsEnabled()) {
      // Full-text search only. The stored benefit rules answer questions; the
      // page text is still searchable for the fallback reading path.
      await progress(args, "indexing", 80, `Saving ${chunks.length} searchable section${chunks.length === 1 ? "" : "s"}…`, "indexing");
      for (const c of chunks)
        await query(
          `INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,heading,text) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [args.accountId, args.familyMemberId, args.policyId, c.pageStart, c.pageEnd, c.heading, c.text],
        );
    } else await withEmbeddingSession(async (embed) => {
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const end = Math.min(i + batch.length, chunks.length);
        const pct = 70 + (i / Math.max(chunks.length, 1)) * 24;
        await progress(args, "indexing", pct, `Building semantic search index ${i + 1}–${end} of ${chunks.length}…`, "indexing");
        let vectors: number[][];
        try {
          vectors = await embed(batch.map((c) => c.text));
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Unknown embedding error";
          throw new Error(`Policy extraction succeeded, but BGE-M3 indexing failed at section ${i + 1}-${end} of ${chunks.length}: ${detail}`);
        }
        for (let j = 0; j < batch.length; j++) {
          const c = batch[j];
          await query(
            `INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,heading,text,embedding)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8::vector)`,
            [args.accountId, args.familyMemberId, args.policyId, c.pageStart, c.pageEnd, c.heading, c.text, toPgVector(vectors[j])],
          );
        }
      }
    });

    // Read the benefit rules now, once, while the user already expects to wait.
    // Every later question is then answered from the stored table without
    // reading this document again. A failure here leaves the document fully
    // usable: questions fall back to reading it at question time.
    try {
      await progress(args, "benefits", 82, "Reading the benefit rules page by page. This is the slow part, and it only happens once…", "indexing");
      const { catalogueDocument } = await import("@/lib/policies/catalog-builder");
      const stored = await catalogueDocument({
        accountId: args.accountId, policyId: args.policyId, productName: extraction.productName ?? null,
        pages: pages.map(page => ({ page_number: page.pageNumber, text: page.text })),
        products: extraction.productsMentioned ?? [],
        report: (page, total) => { void progress(args, "benefits", 82 + Math.round((page / Math.max(1, total)) * 14),
          "Reading the benefit rules — page " + page + " of " + total + "…", "indexing"); },
      });
      const attention = await query<{ count: number }>(
        `SELECT count(*)::int AS count FROM policy_benefits WHERE account_id=$1 AND policy_id=$2 AND (formula_kind='none' OR (basis_inferred AND reviewed_at IS NULL))`,
        [args.accountId, args.policyId]).then(r => Number(r.rows[0]?.count ?? 0)).catch(() => 0);
      await progress(args, "benefits", 96, stored + " benefit rule" + (stored === 1 ? "" : "s") + " read from this document"
        + (attention ? "; " + attention + " to confirm on the Benefits page" : "") + ".", "indexing");
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

    await progress(args, "finalising", 97, "Final checks and portfolio update…", "indexing");
    await query(
      `UPDATE policies SET processing_status='ready',processing_stage='complete',processing_progress=100,
       processing_message=CASE WHEN processing_message LIKE '%benefit rule%' THEN 'Ready. '||processing_message ELSE 'Analysis complete' END,
       processing_error=NULL,processing_completed_at=now(),updated_at=now()
       WHERE id=$1 AND account_id=$2`,
      [args.policyId, args.accountId],
    );
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
      await progress(args, "finalising", 98, "Reading the document into your coverage ledger…");
      const { readDocumentIntoLedger } = await import("@/lib/ledger/extract");
      await readDocumentIntoLedger({ accountId: args.accountId, policyId: args.policyId }).catch((error) => {
        console.warn("Ledger reading failed for policy " + args.policyId + ":", error instanceof Error ? error.message : error);
      });
      const { seedLedger } = await import("@/lib/ledger/store");
      await seedLedger(args.accountId);
    } catch (error) {
      console.warn("Coverage ledger update failed for policy " + args.policyId + ":", error instanceof Error ? error.message : error);
    }
    return { pages: pages.length, chunks: chunks.length, extraction, detectedPeople: detected, needsReview };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    await query(
      `UPDATE policies SET processing_status='failed',processing_stage='failed',processing_message='Analysis stopped',processing_error=$1,
       processing_completed_at=now(),updated_at=now() WHERE id=$2 AND account_id=$3`,
      [message, args.policyId, args.accountId],
    ).catch(() => undefined);
    throw error;
  }
}
