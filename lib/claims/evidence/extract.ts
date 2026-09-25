/**
 * Structured extraction from a reviewed cause-of-death document (death
 * certificate, police report, coroner's/medical examiner's report).
 *
 * The model's output is treated as UNTRUSTED input end to end: it is
 * parsed against a strict Zod schema (extraction-schema.ts) with every
 * field nullable/optional so the model can never be forced to invent a
 * value, and every page citation is then verified against the document's
 * OWN extracted page text before being trusted -- an excerpt the model
 * claims is on a page it is not actually found on is dropped rather than
 * persisted. Nothing here ever authorises a benefit amount, decides an
 * accidental-death match, or resolves an identity conflict: this module's
 * only job is to produce a well-formed, evidence-checked PROPOSAL for a
 * human reviewer (or a later deterministic rule) to act on.
 */
import { structuredCompletion } from "@/lib/ai/llm";
import { modelFor } from "@/lib/ai/providers";
import { ClaimEvidenceExtractionSchema } from "./extraction-schema";
import { isMedicalClaimEligibleDocumentType, isMedicalEvidenceDocumentType } from "./types";
import type { ClaimEvidenceDocumentType, ClaimEvidenceExtractedFields, ClaimEvidencePageCitation } from "./types";
import { recordErrorEvent, recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import type { ModelExecutionRecord } from "@/lib/ai/provenance";
import { storedExecutionFromRecord, type StoredExtractionExecution } from "./extraction-provenance";

export const CLAIM_EVIDENCE_EXTRACTION_VERSION = "claim-evidence-extract-v1";

const CAUSE_OF_DEATH_SYSTEM = "You extract structured facts from an OFFICIAL cause-of-death document (a death certificate, police report, or coroner's/medical examiner's report) for an insurance claim review. "
  + "You are reading evidence, not deciding a claim: never state or imply whether any policy applies, never invent a fact that is not actually printed on the page, and leave a field null when the document does not state it. "
  + "For every fact you report, cite the exact page number(s) and copy the exact supporting excerpt verbatim -- do not paraphrase the excerpt. "
  + "If the document mentions more than one deceased person (e.g. a multi-fatality accident), list every other name under otherNamesMentioned; do not guess which one is the subject of this claim. "
  + "Leave every medical-evidence-only field (patientName, exactDiagnosis, diagnosisDate, firstSymptomDate, firstConsultationDate, diseaseStage, supportingFindings, treatingSpecialist, issuingInstitution, survivalPeriodDates, priorDiagnosisHistory, priorCriticalIllnessClaims) null or empty -- this is not a medical document.";

/** You are NEVER diagnosing anyone and you NEVER decide whether a finding
 * meets any policy's definition -- you only transcribe what THIS document
 * itself explicitly states, with a citation, so a later deterministic
 * comparison (see lib/claims/ci-rules.ts) can check it against a policy's
 * own wording. Never infer a stage, diagnosis or finding from context, a
 * condition's usual presentation, or general medical knowledge -- only
 * from words actually printed on the page. */
const MEDICAL_EVIDENCE_SYSTEM = "You extract structured facts from a MEDICAL EVIDENCE document (a specialist memo, medical report, pathology report, imaging report, laboratory report, discharge summary, surgical report, or other insurer-requested medical evidence) for a critical-illness insurance claim review. "
  + "You are reading evidence, not deciding a claim: never state or imply whether any policy applies, never diagnose, never invent a fact that is not actually printed on the page, and leave a field null when the document does not state it. "
  + "For every fact you report -- especially exactDiagnosis, diseaseStage, and every entry in supportingFindings -- cite the exact page number(s) and copy the exact supporting excerpt verbatim; do not paraphrase the excerpt and do not infer a stage or diagnosis that is not explicitly stated in the document's own words. "
  + "Report the patient's name under patientName, not deceasedName. If the document mentions more than one patient, list every other name under otherNamesMentioned. "
  + "Leave every cause-of-death-only field (deceasedName, dateOfDeath, statedCauseOfDeath, mannerOfDeath) null and every medical-CLAIM-only field (hospitalName, hospitalCountry, admissionDate, dischargeDate, admissionType, wardType, billLineItems, thirdPartyPayments) null/empty -- this is not a cause-of-death document or a hospital bill.";

/** You never compute a total, apply a discount, or decide whether an
 * expense is eligible under any policy -- you only transcribe what THIS
 * bill/record itself explicitly states, with a citation, so a later
 * deterministic parser (lib/claims/evidence/medical-bill-evidence.ts's
 * parseAmountMinor()) can turn each amountText into minor units itself,
 * never trusting arithmetic you performed. Report every amount exactly as
 * printed (e.g. "1,250.00"), never rounded, summed, or converted. */
const MEDICAL_BILL_SYSTEM = "You extract structured facts from a MEDICAL-CLAIM document (a hospital bill, itemised bill, doctor's memo, referral letter, pre-authorisation letter, procedure report, receipt/payment proof, other-insurer settlement statement, MediSave/MediShield/Integrated Shield Plan settlement statement, discharge summary, or surgical report) for a hospital-cash/medical-reimbursement insurance claim review. "
  + "You are reading evidence, not deciding a claim: never state or imply whether any policy applies, never decide whether an expense is eligible, never invent a fact that is not actually printed on the page, and leave a field null/empty when the document does not state it. "
  + "Report the patient's name under patientName. Report the hospital/clinic name under hospitalName, its country under hospitalCountry, the admission and discharge dates under admissionDate/dischargeDate exactly as printed, whether this was inpatient/day surgery/emergency/outpatient/ICU treatment under admissionType, and the ward/room type under wardType. "
  + "List every itemised bill row under billLineItems with its category (e.g. surgical fees, room and board, specialist fees, medication, diagnostic tests), an optional description, and the EXACT amount as printed in amountText (e.g. \"1,250.00\") -- never a number you calculated, summed, rounded, or converted yourself. List every amount the document shows as already paid by another party (an insurer, MediShield, employer, or other third party) under thirdPartyPayments the same way. "
  + "For every fact you report, cite the exact page number(s) and copy the exact supporting excerpt verbatim. "
  + "Leave every cause-of-death-only field (deceasedName, dateOfDeath, statedCauseOfDeath, mannerOfDeath) and every critical-illness-only field (exactDiagnosis, diseaseStage, supportingFindings, priorDiagnosisHistory, priorCriticalIllnessClaims) null/empty -- this is not a cause-of-death document or a critical-illness clinical report.";

function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function tokenOverlap(hay: string, needle: string) {
  const tokens = normalize(needle).split(" ").filter((t) => t.length > 1);
  if (!tokens.length) return 0;
  const unique = [...new Set(tokens)];
  const hits = unique.filter((t) => hay.includes(t)).length;
  return hits / unique.length;
}

/** Drops a page citation whose page number is out of range or whose excerpt
 * cannot actually be found (by loose token overlap, the same technique
 * lib/rag/ingest.ts uses to verify policy-extraction evidence) on the page
 * it claims -- a citation the model fabricated must never look like a
 * verified one. */
function verifyCitations(citations: ClaimEvidencePageCitation[], pages: { pageNumber: number; text: string }[]): ClaimEvidencePageCitation[] {
  const pageMap = new Map(pages.map((p) => [p.pageNumber, normalize(p.text)]));
  return citations.filter((c) => {
    if (!Number.isInteger(c.pageStart) || c.pageStart < 1) return false;
    if (!Number.isInteger(c.pageEnd) || c.pageEnd < c.pageStart) return false;
    if (!pageMap.has(c.pageStart)) return false;
    const hay = pageMap.get(c.pageStart) ?? "";
    if (!c.excerpt || c.excerpt.trim().length < 3) return false;
    return tokenOverlap(hay, c.excerpt) >= 0.7;
  });
}

export async function extractClaimEvidence(args: {
  pages: { pageNumber: number; text: string }[];
  documentType: ClaimEvidenceDocumentType;
  documentId?: string;
}): Promise<{ fields: ClaimEvidenceExtractedFields; model: string; provider: string; version: string; execution: StoredExtractionExecution | null }> {
  const choice = modelFor("reading");
  const system = isMedicalClaimEligibleDocumentType(args.documentType) && !isMedicalEvidenceDocumentType(args.documentType)
    ? MEDICAL_BILL_SYSTEM
    : isMedicalEvidenceDocumentType(args.documentType) ? MEDICAL_EVIDENCE_SYSTEM : CAUSE_OF_DEATH_SYSTEM;
  const user = `Document type declared at upload: ${args.documentType}.\n\n`
    + args.pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join("\n\n");
  // Checkpoint 14i: "Claim-evidence extraction" was named as a required
  // telemetry call site (scripts/launch-check.ts's privacy_safe_
  // observability capability) -- this function is the ONE chokepoint
  // every claim-evidence extraction goes through (lib/claims/evidence/
  // pipeline.ts's processClaimEvidence() is its only real caller), the
  // same "one call = one event" convention lib/claims/composition/
  // engine.ts's composeClaim() already uses. Fire-and-forget, never
  // awaited -- telemetry must never slow down or fail extraction itself.
  const correlationId = resolveCorrelationId(undefined);
  // The exact persisted model_executions record for the attempt whose
  // output this extraction is built from -- handed over by
  // structuredCompletion() itself, never looked up afterwards and never
  // inferred from `choice` (a requested identity, possibly an alias).
  const captured: { record: ModelExecutionRecord | null } = { record: null };
  try {
    const raw = await structuredCompletion({
      system,
      user,
      schema: ClaimEvidenceExtractionSchema,
      role: "reading",
      operation: "claim_evidence_extraction",
      promptVersion: CLAIM_EVIDENCE_EXTRACTION_VERSION,
      schemaVersion: CLAIM_EVIDENCE_EXTRACTION_VERSION,
      temperature: 0,
      onExecutionRecord: (record) => { captured.record = record; },
    });
    // structuredCompletion() already validated `raw` against
    // ClaimEvidenceExtractionSchema (throwing TruncatedModelOutput on a
    // mismatch), so this only needs to re-check what that schema cannot: that
    // each page citation's excerpt is genuinely found on the page it claims.
    const fields: ClaimEvidenceExtractedFields = {
      ...raw,
      pageCitations: verifyCitations(raw.pageCitations, args.pages),
    };
    void recordEvent({
      name: "claims.evidence.extraction.completed",
      correlationId,
      status: "success",
      resourceRef: args.documentId ? pseudonymizeId(args.documentId) : null,
      resolvedModel: choice.model,
      schemaVersion: CLAIM_EVIDENCE_EXTRACTION_VERSION,
      extra: { documentType: args.documentType, pageCitationsKept: fields.pageCitations.length, pageCitationsProposed: raw.pageCitations.length },
    });
    const execution = captured.record ? storedExecutionFromRecord(captured.record) : null;
    return { fields, model: choice.model, provider: choice.provider, version: CLAIM_EVIDENCE_EXTRACTION_VERSION, execution };
  } catch (error) {
    void recordErrorEvent({
      name: "claims.evidence.extraction.failed",
      correlationId,
      resourceRef: args.documentId ? pseudonymizeId(args.documentId) : null,
      resolvedModel: choice.model,
      schemaVersion: CLAIM_EVIDENCE_EXTRACTION_VERSION,
      error,
      extra: { documentType: args.documentType },
    });
    throw error;
  }
}
