import { z } from "zod";
import { CLAIM_EVIDENCE_DOCUMENT_TYPES, type ClaimEvidenceDocumentType } from "./types";

/** What the model is asked to propose from a claim-evidence document. This
 * is a PROPOSAL schema, not a source of truth -- see extract.ts's module
 * doc comment. Every field is nullable/optional because the model must
 * never invent a value it did not actually find on the page.
 *
 * The medical-evidence-only fields (patientName..priorCriticalIllnessClaims)
 * use `.default(null)` / `.default([])` rather than `.optional()` so a
 * proposal that omits them entirely (e.g. a cause-of-death-only extraction
 * that never mentions them) still parses -- while the *parsed* output type
 * keeps them always-present (never `undefined`), matching
 * ClaimEvidenceExtractedFields in ./types.ts exactly, so extract.ts's
 * `{ ...raw, ... }` spread stays type-safe with no cast. */
export const PageCitationSchema = z.object({
  field: z.string(),
  pageStart: z.number().int(),
  pageEnd: z.number().int(),
  excerpt: z.string(),
});

export const ClaimEvidenceExtractionSchema = z.object({
  deceasedName: z.string().nullable(),
  /** Any OTHER person's name the document mentions as deceased or
   * potentially deceased -- a multi-fatality accident report, or a report
   * that also discusses a different case. A non-empty list here is a
   * MULTIPLE_PEOPLE_MENTIONED identity conflict, never resolved silently. */
  otherNamesMentioned: z.array(z.string()),
  personIdentifiers: z.array(z.object({ label: z.string(), value: z.string() })),
  dateOfDeath: z.string().nullable(),
  statedCauseOfDeath: z.string().nullable(),
  mannerOfDeath: z.string().nullable(),
  patientName: z.string().nullable().default(null),
  exactDiagnosis: z.string().nullable().default(null),
  diagnosisDate: z.string().nullable().default(null),
  firstSymptomDate: z.string().nullable().default(null),
  firstConsultationDate: z.string().nullable().default(null),
  diseaseStage: z.string().nullable().default(null),
  supportingFindings: z.array(z.object({ type: z.string(), description: z.string(), excerpt: z.string() })).default([]),
  treatingSpecialist: z.string().nullable().default(null),
  issuingInstitution: z.string().nullable().default(null),
  survivalPeriodDates: z.array(z.string()).default([]),
  priorDiagnosisHistory: z.string().nullable().default(null),
  priorCriticalIllnessClaims: z.string().nullable().default(null),
  hospitalName: z.string().nullable().default(null),
  hospitalCountry: z.string().nullable().default(null),
  admissionDate: z.string().nullable().default(null),
  dischargeDate: z.string().nullable().default(null),
  admissionType: z.string().nullable().default(null),
  wardType: z.string().nullable().default(null),
  billLineItems: z.array(z.object({
    category: z.string(), description: z.string().nullable(), amountText: z.string(), currency: z.string().nullable(),
  })).default([]),
  thirdPartyPayments: z.array(z.object({
    source: z.string(), amountText: z.string(), currency: z.string().nullable(),
  })).default([]),
  issuingAuthority: z.string().nullable(),
  documentReference: z.string().nullable(),
  documentType: z.enum(CLAIM_EVIDENCE_DOCUMENT_TYPES as [ClaimEvidenceDocumentType, ...ClaimEvidenceDocumentType[]]).nullable(),
  pageCitations: z.array(PageCitationSchema),
  /** Per-field confidence in [0,1], keyed by field name. Missing = unknown,
   * never assumed to be high confidence. */
  confidence: z.record(z.string(), z.number()),
});

export type ClaimEvidenceExtractionModelOutput = z.infer<typeof ClaimEvidenceExtractionSchema>;
