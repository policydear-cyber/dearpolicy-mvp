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
import type { ClaimEvidenceDocumentType, ClaimEvidenceExtractedFields, ClaimEvidencePageCitation } from "./types";

export const CLAIM_EVIDENCE_EXTRACTION_VERSION = "claim-evidence-extract-v1";

const SYSTEM = "You extract structured facts from an OFFICIAL cause-of-death document (a death certificate, police report, or coroner's/medical examiner's report) for an insurance claim review. "
  + "You are reading evidence, not deciding a claim: never state or imply whether any policy applies, never invent a fact that is not actually printed on the page, and leave a field null when the document does not state it. "
  + "For every fact you report, cite the exact page number(s) and copy the exact supporting excerpt verbatim -- do not paraphrase the excerpt. "
  + "If the document mentions more than one deceased person (e.g. a multi-fatality accident), list every other name under otherNamesMentioned; do not guess which one is the subject of this claim.";

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
}): Promise<{ fields: ClaimEvidenceExtractedFields; model: string; provider: string; version: string }> {
  const choice = modelFor("reading");
  const user = `Document type declared at upload: ${args.documentType}.\n\n`
    + args.pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join("\n\n");
  const raw = await structuredCompletion({
    system: SYSTEM,
    user,
    schema: ClaimEvidenceExtractionSchema,
    role: "reading",
    temperature: 0,
  });
  // structuredCompletion() already validated `raw` against
  // ClaimEvidenceExtractionSchema (throwing TruncatedModelOutput on a
  // mismatch), so this only needs to re-check what that schema cannot: that
  // each page citation's excerpt is genuinely found on the page it claims.
  const fields: ClaimEvidenceExtractedFields = {
    ...raw,
    pageCitations: verifyCitations(raw.pageCitations, args.pages),
  };
  return { fields, model: choice.model, provider: choice.provider, version: CLAIM_EVIDENCE_EXTRACTION_VERSION };
}
