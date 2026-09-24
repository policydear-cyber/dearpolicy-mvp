/**
 * Confirms reviewed medical-CLAIM bill evidence and aggregates it into the
 * one shape a medical calculator may treat as verified
 * (VerifiedMedicalBillFacts, see lib/claims/calculators/evidence.ts).
 *
 * Unlike critical illness, a medical-claim bill has no "policy definition"
 * to match against -- a bill amount is either accurately transcribed or it
 * is not, so there is no `ci-matches.ts`-style per-benefit/per-illness
 * confirmation table. Confirming a bill document's review is therefore
 * just the generic claim-evidence pipeline's own `needs_review -> matched`
 * transition (see ./state-machine.ts), plus an optional reviewer
 * correction of specific fields via the already-generic `correctExtraction()`
 * -- exactly the same primitives lib/claims/evidence/matches.ts and
 * ./ci-matches.ts already build on, with no new database table required.
 *
 * `loadVerifiedMedicalBillFacts()` is the ONLY function a medical
 * calculator (lib/claims/medical-rules.ts) may call for a verified
 * eligible-expense figure, a verified admission/discharge date, or a
 * verified panel/ward/third-party-payment fact. It reads ONLY documents
 * that have reached "matched" status -- a chat-reported figure never
 * substitutes for this, and an unreviewed extraction never substitutes for
 * this either.
 */
import { validateMedicalClaimEvidence, type MedicalBillLineItem, type MedicalBillThirdPartyPayment, type VerifiedMedicalBillFacts } from "@/lib/claims/calculators/evidence";
import { appendClaimEvidenceAudit } from "./audit";
import { correctExtraction, getLatestExtraction, getScopedEvidenceDocument, listEvidenceDocuments, transitionEvidenceStatus } from "./store";
import { isMedicalClaimEligibleDocumentType, type ClaimEvidenceExtractedFields } from "./types";

export class MedicalBillEvidenceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

function effectiveFields(extracted: ClaimEvidenceExtractedFields, reviewed: Partial<ClaimEvidenceExtractedFields> | null): ClaimEvidenceExtractedFields {
  return reviewed ? { ...extracted, ...reviewed } : extracted;
}

/** Deterministically parses a document's own printed amount text (e.g.
 * "1,250.00", "S$1,250", "1250") into integer minor units (cents). Never
 * trusts arithmetic the model may have performed -- a value that is not a
 * clean, non-negative, finite number after stripping thousands separators
 * and an optional currency marker is rejected (returns null) rather than
 * guessed at. */
export function parseAmountMinor(amountText: string): number | null {
  const cleaned = amountText.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;
  // Normalise "1.250,00"-style thousands separators only when unambiguous
  // (a single comma followed by exactly two digits at the end, with a
  // period used earlier, is treated as a decimal comma); otherwise commas
  // are treated as thousands separators, matching this codebase's SGD/US
  // convention (see lib/claims/medical-evidence.ts's parseMoney()).
  const normalised = cleaned.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return null;
  const amount = Number(normalised);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function normaliseCurrency(value: string | null | undefined, fallback = "SGD"): string {
  const v = (value ?? "").toUpperCase().trim();
  return /^[A-Z]{3}$/.test(v) ? v : fallback;
}

/** Marks a medical-claim document's evidence as reviewed and moves it to
 * "matched" -- the single explicit action that lets `loadVerifiedMedicalBillFacts()`
 * ever include anything from it. Never reachable from chat text or a raw
 * model proposal; see this module's own doc comment. */
export async function confirmMedicalBillReview(args: {
  accountId: string;
  reviewerName: string;
  familyMemberId: string;
  claimSessionId: string;
  evidenceDocumentId: string;
  /** Reviewer corrections to specific extracted fields (e.g. fixing a
   * misread amount) -- optional; when omitted, the model's own
   * citation-verified proposal is confirmed as-is. */
  reviewedFields?: Partial<ClaimEvidenceExtractedFields>;
  reason?: string | null;
}) {
  const document = await getScopedEvidenceDocument({
    accountId: args.accountId, familyMemberId: args.familyMemberId, claimSessionId: args.claimSessionId, id: args.evidenceDocumentId,
  });
  if (!document) throw new MedicalBillEvidenceError("EVIDENCE_NOT_FOUND", "That claim-evidence document was not found for this family member and claim.");
  if (!isMedicalClaimEligibleDocumentType(document.document_type)) {
    throw new MedicalBillEvidenceError("NOT_MEDICAL_CLAIM_EVIDENCE", "That document is not medical-claim (bill) evidence, so it cannot be confirmed as reviewed for a medical claim.");
  }
  if (!["needs_review", "matched"].includes(document.status)) {
    throw new MedicalBillEvidenceError("EVIDENCE_NOT_READY", "This document has not finished processing yet, or was rejected, so it cannot be confirmed reviewed.");
  }
  if (document.identity_status !== "confirmed") {
    throw new MedicalBillEvidenceError("IDENTITY_NOT_CONFIRMED", "This document's identity has not been confirmed for this family member, so its figures cannot be confirmed reviewed yet.");
  }

  const extraction = await getLatestExtraction(args.accountId, document.id);
  if (!extraction) throw new MedicalBillEvidenceError("EXTRACTION_NOT_FOUND", "This document has not been read yet.");

  let extractionId = extraction.id;
  if (args.reviewedFields) {
    const corrected = await correctExtraction({ accountId: args.accountId, extractionId: extraction.id, reviewedFields: args.reviewedFields, reviewedBy: args.reviewerName });
    if (corrected) extractionId = corrected.id;
  }

  const evidenceRef = {
    documentId: document.id, documentType: document.document_type,
    familyMemberId: args.familyMemberId, claimEventId: args.claimSessionId,
  };
  const check = validateMedicalClaimEvidence(evidenceRef);
  if (!check.valid) throw new MedicalBillEvidenceError(check.reasonCode, check.message);

  if (document.status === "needs_review") {
    await transitionEvidenceStatus({ accountId: args.accountId, id: document.id, from: "needs_review", to: "matched" });
  }
  await appendClaimEvidenceAudit(args.accountId, {
    actor: args.reviewerName, action: "medical_bill_review_confirmed", evidenceDocumentId: document.id,
    claimSessionId: args.claimSessionId, reason: args.reason ?? undefined,
    newValue: { extractionId, documentType: document.document_type },
  });
  return { documentId: document.id, extractionId };
}

/** Aggregates every "matched" medical-claim document's reviewed extraction
 * for one family member's one claim into a single VerifiedMedicalBillFacts.
 * When more than one matched document states a conflicting single-valued
 * fact (e.g. two different admission dates), the most recently created
 * matched document's value wins for that field and the conflict is never
 * silently averaged or summed -- callers that need certainty about which
 * document a field came from should read `sourceDocumentIds`. Line items
 * and third-party payments are never deduplicated across documents beyond
 * exact (documentId, category, amountMinor) repeats within the SAME
 * document's own extraction -- the calculator layer (lib/claims/
 * medical-rules.ts) is responsible for any further duplicate-bill
 * detection, since only it has the full claim context to judge that. */
/** Checkpoint (Wave 2, D4/D8/D9): a "matched" document whose OWN row has
 * since been superseded (a corrected re-upload -- see ./store.ts's
 * supersedeEvidenceDocument()) must never keep contributing its line
 * items to the aggregate below. listEvidenceDocuments() itself does not
 * filter on superseded_at (it is a general listing used for UI/audit
 * history, where a superseded document must still be visible), so this
 * module -- the ONE source a medical calculator may treat as verified --
 * is responsible for excluding it here. Before this fix, an old document
 * and its corrected replacement could both be "matched" at once and both
 * contribute line items, double-counting the bill. */
function isCurrentlyVerifiable(document: { status: string; superseded_at: string | null }): boolean {
  return document.status === "matched" && document.superseded_at == null;
}

export async function loadVerifiedMedicalBillFacts(accountId: string, familyMemberId: string, claimSessionId: string): Promise<VerifiedMedicalBillFacts> {
  const documents = (await listEvidenceDocuments(accountId, claimSessionId))
    .filter((d) => d.family_member_id === familyMemberId && isCurrentlyVerifiable(d) && isMedicalClaimEligibleDocumentType(d.document_type))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const lineItems: MedicalBillLineItem[] = [];
  const thirdPartyPayments: MedicalBillThirdPartyPayment[] = [];
  let admissionISO: string | null = null, dischargeISO: string | null = null;
  let hospitalName: string | null = null, hospitalCountry: string | null = null;
  let admissionType: string | null = null, wardType: string | null = null;
  const sourceDocumentIds: string[] = [];

  for (const document of documents) {
    const extraction = await getLatestExtraction(accountId, document.id);
    if (!extraction) continue;
    const fields = effectiveFields(extraction.extracted_fields, extraction.reviewed_fields);
    sourceDocumentIds.push(document.id);

    for (const row of fields.billLineItems ?? []) {
      const amountMinor = parseAmountMinor(row.amountText);
      if (amountMinor == null) continue;
      lineItems.push({
        category: row.category.toLowerCase().trim().replace(/\s+/g, "_"), description: row.description,
        amountMinor, currency: normaliseCurrency(row.currency), documentId: document.id, documentType: document.document_type,
      });
    }
    for (const row of fields.thirdPartyPayments ?? []) {
      const amountMinor = parseAmountMinor(row.amountText);
      if (amountMinor == null) continue;
      thirdPartyPayments.push({ source: row.source, amountMinor, currency: normaliseCurrency(row.currency), documentId: document.id });
    }
    if (fields.admissionDate) admissionISO = fields.admissionDate;
    if (fields.dischargeDate) dischargeISO = fields.dischargeDate;
    if (fields.hospitalName) hospitalName = fields.hospitalName;
    if (fields.hospitalCountry) hospitalCountry = fields.hospitalCountry;
    if (fields.admissionType) admissionType = fields.admissionType;
    if (fields.wardType) wardType = fields.wardType;
  }

  return { lineItems, thirdPartyPayments, admissionISO, dischargeISO, hospitalName, hospitalCountry, admissionType, wardType, sourceDocumentIds };
}
