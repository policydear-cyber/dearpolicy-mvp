import type { EvidenceProvenance } from "@/lib/claims/evidence-authority";

/** Test-only projection of a current, provider-identified extraction.
 * Safety gates must stay fail-closed; calculator fixtures that intend to
 * exercise a successful reviewed match therefore supply the same provenance
 * fields production evidence is required to persist. */
export function verifiedEvidenceProvenance(sourceDocumentId: string): EvidenceProvenance {
  return {
    modelExecutionId: `fixture-execution:${sourceDocumentId}`,
    operation: "claim_evidence_extraction",
    verified: true,
    resolvedModel: "gemini-3.6-flash",
    promptVersion: "claim-evidence-extract-v1",
    schemaVersion: "claim-evidence-extract-v1",
    validatorVersion: "claim-evidence-extract-v1",
    sourceDocumentId,
    sourceDocumentVersion: "sha256:fixture-v1",
  };
}
