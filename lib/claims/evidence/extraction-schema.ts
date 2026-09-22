import { z } from "zod";
import { CLAIM_EVIDENCE_DOCUMENT_TYPES, type ClaimEvidenceDocumentType } from "./types";

/** What the model is asked to propose from a claim-evidence document. This
 * is a PROPOSAL schema, not a source of truth -- see extract.ts's module
 * doc comment. Every field is nullable/optional because the model must
 * never invent a value it did not actually find on the page. */
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
  issuingAuthority: z.string().nullable(),
  documentReference: z.string().nullable(),
  documentType: z.enum(CLAIM_EVIDENCE_DOCUMENT_TYPES as [ClaimEvidenceDocumentType, ...ClaimEvidenceDocumentType[]]).nullable(),
  pageCitations: z.array(PageCitationSchema),
  /** Per-field confidence in [0,1], keyed by field name. Missing = unknown,
   * never assumed to be high confidence. */
  confidence: z.record(z.string(), z.number()),
});

export type ClaimEvidenceExtractionModelOutput = z.infer<typeof ClaimEvidenceExtractionSchema>;
