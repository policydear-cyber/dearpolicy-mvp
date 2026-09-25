/**
 * Evidence model-execution provenance: the persisted link between one
 * claim-evidence extraction and the exact model_executions record
 * (lib/ai/provenance.ts) that produced it, and the projection of that link
 * into the EvidenceProvenance shape lib/claims/evidence-authority.ts's
 * monetary gate checks.
 *
 * Nothing here ever invents provenance. A stored execution is only ever
 * created from the real ModelExecutionRecord structuredCompletion() hands
 * back through its onExecutionRecord callback (see ./extract.ts) -- never
 * from extraction_model, a requested model alias, or a "latest execution"
 * lookup. Every value read back from storage is re-validated field by
 * field; anything missing or malformed yields null, which the gate treats
 * as EVIDENCE_PROVENANCE_MISSING (fail closed).
 */
import { isKnownOperation, type KnownOperation, type ModelExecutionRecord } from "@/lib/ai/provenance";
import type { EvidenceProvenance } from "@/lib/claims/evidence-authority";

/** What claim_evidence_extractions.model_execution stores: the governed
 * identity of the one successful, schema-validated attempt whose output
 * became this extraction. */
export type StoredExtractionExecution = {
  modelExecutionId: string;
  operation: KnownOperation;
  verified: boolean;
  /** The provider's OWN reported model for this exact call, or null. */
  resolvedModel: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** Projects the real persisted record. `verified` and `resolvedModel` are
 * copied from the record exactly as lib/ai/provenance.ts computed and
 * persisted them -- never recomputed or defaulted here. */
export function storedExecutionFromRecord(record: ModelExecutionRecord): StoredExtractionExecution {
  return {
    modelExecutionId: record.id,
    operation: record.operation,
    verified: record.verified,
    resolvedModel: record.resolved?.resolvedModel ?? null,
    promptVersion: record.requested.promptVersion ?? null,
    schemaVersion: record.requested.schemaVersion ?? null,
  };
}

/** Strict re-validation of a stored execution read back from jsonb. */
export function parseStoredExecution(value: unknown): StoredExtractionExecution | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!nonEmpty(v.modelExecutionId)) return null;
  if (typeof v.operation !== "string" || !isKnownOperation(v.operation)) return null;
  if (typeof v.verified !== "boolean") return null;
  if (!nullableString(v.resolvedModel) || !nullableString(v.promptVersion) || !nullableString(v.schemaVersion)) return null;
  return {
    modelExecutionId: v.modelExecutionId,
    operation: v.operation,
    verified: v.verified,
    resolvedModel: v.resolvedModel,
    promptVersion: v.promptVersion,
    schemaVersion: v.schemaVersion,
  };
}

/** Binds a stored execution to the exact document and document version
 * its extraction was produced from. */
export function evidenceProvenanceFromExecution(
  execution: StoredExtractionExecution | null,
  source: { sourceDocumentId: string; sourceDocumentVersion: string | null; validatorVersion: string | null },
): EvidenceProvenance | null {
  if (!execution) return null;
  return {
    modelExecutionId: execution.modelExecutionId,
    operation: execution.operation,
    verified: execution.verified,
    resolvedModel: execution.resolvedModel,
    promptVersion: execution.promptVersion,
    schemaVersion: execution.schemaVersion,
    validatorVersion: source.validatorVersion,
    sourceDocumentId: source.sourceDocumentId,
    sourceDocumentVersion: source.sourceDocumentVersion,
  };
}

/** Strict re-validation of an EvidenceProvenance snapshot read back from a
 * match row's jsonb column. */
export function parseEvidenceProvenance(value: unknown): EvidenceProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const execution = parseStoredExecution(v);
  if (!execution) return null;
  if (!nonEmpty(v.sourceDocumentId)) return null;
  if (!nullableString(v.sourceDocumentVersion) || !nullableString(v.validatorVersion)) return null;
  if (v.supersededByExecutionId !== undefined && !nullableString(v.supersededByExecutionId)) return null;
  if (v.reprocessingRequired !== undefined && typeof v.reprocessingRequired !== "boolean") return null;
  const provenance: EvidenceProvenance = {
    ...evidenceProvenanceFromExecution(execution, {
      sourceDocumentId: v.sourceDocumentId,
      sourceDocumentVersion: v.sourceDocumentVersion,
      validatorVersion: v.validatorVersion,
    })!,
  };
  if (typeof v.supersededByExecutionId === "string") provenance.supersededByExecutionId = v.supersededByExecutionId;
  if (v.reprocessingRequired === true) provenance.reprocessingRequired = true;
  return provenance;
}

/** The CURRENT state of one evidence document, as read fresh from the
 * database at calculation time (see ./store.ts's
 * loadEvidenceProvenanceContext()). Absent from the map entirely when the
 * document is not in this account or is no longer active. */
export type EvidenceDocumentProvenanceContext = {
  documentId: string;
  familyMemberId: string;
  claimSessionId: string;
  fileHash: string;
  supersededAt: string | null;
  /** claim_evidence_extractions.model_execution of this document's latest
   * extraction for its CURRENT file hash, or null. */
  currentExecution: unknown;
};

/** Decides what provenance, if any, a stored match may carry into
 * ClaimFacts right now. The reviewed snapshot is only ever handed on when
 * it is still bound to the same, still-current document, in the same
 * member/claim scope the match itself was recorded for:
 *   - no/malformed snapshot, document missing/inactive, or any document/
 *     member/claim scope mismatch -> undefined (EVIDENCE_PROVENANCE_MISSING)
 *   - document since superseded, or its content hash differs from the one
 *     the snapshot was extracted from -> reprocessingRequired
 *   - document re-extracted after review (a different execution now backs
 *     it, or none) -> supersededByExecutionId / reprocessingRequired
 * Each of those still fails closed at evaluateEvidenceAuthority(). */
export function resolveMatchProvenance(
  snapshot: unknown,
  context: EvidenceDocumentProvenanceContext | undefined,
  expected: { documentId: string; familyMemberId: string; claimSessionId: string },
): EvidenceProvenance | undefined {
  const provenance = parseEvidenceProvenance(snapshot);
  if (!provenance || !context) return undefined;
  if (provenance.sourceDocumentId !== expected.documentId) return undefined;
  if (context.documentId !== expected.documentId) return undefined;
  if (context.familyMemberId !== expected.familyMemberId || context.claimSessionId !== expected.claimSessionId) return undefined;
  const resolved: EvidenceProvenance = { ...provenance };
  if (context.supersededAt != null || provenance.sourceDocumentVersion !== context.fileHash) {
    resolved.reprocessingRequired = true;
  }
  const current = parseStoredExecution(context.currentExecution);
  if (!current) {
    resolved.reprocessingRequired = true;
  } else if (current.modelExecutionId !== provenance.modelExecutionId) {
    resolved.supersededByExecutionId = current.modelExecutionId;
  }
  return resolved;
}

/** The provenance snapshot a reviewer's decision about one document rests
 * on: that document's stored extraction execution, bound to the document
 * id and the exact document version (content hash) the extraction read,
 * with the validator version the extraction was actually parsed under.
 * Null when the extraction has no persisted provenance. */
export function provenanceSnapshotForExtraction(
  extraction: { model_execution?: unknown; source_document_version: string; extraction_version: string },
  documentId: string,
): EvidenceProvenance | null {
  return evidenceProvenanceFromExecution(parseStoredExecution(extraction.model_execution), {
    sourceDocumentId: documentId,
    sourceDocumentVersion: extraction.source_document_version,
    validatorVersion: extraction.extraction_version,
  });
}
