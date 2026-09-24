/**
 * Checkpoint (Wave 2, D4/D8/D9): synchronous monetary-evidence authority
 * gate.
 *
 * Checkpoint 10 (lib/ai/provenance.ts) built assertVerifiedForMonetaryUse()
 * and validateCompatibility(), but neither was wired into the calculators
 * or evidence-matching call sites that actually turn AI-derived evidence
 * into money -- validateCompatibility() in particular was dead code: no
 * production call site ever invoked it (see that module's own doc
 * comments). Checkpoint 11 (lib/ai/staleness.ts) built checkStaleness(),
 * but wired it only into a SCHEDULED audit
 * (lib/ai/staleness-alert.ts's runModelExecutionStalenessAudit()), which
 * tells an operator how much verified-but-stale evidence exists in the
 * last N hours. That is a worklist, not a gate: it cannot stop a
 * calculator, right now, from letting one specific stale record unlock a
 * monetary figure.
 *
 * This module is the missing synchronous gate. evaluateEvidenceAuthority()
 * is one pure, side-effect-free function that every match-consuming
 * calculator (lib/claims/calculators/accidental-death.ts,
 * critical-illness.ts, disability-benefit.ts, disability-income.ts) and
 * every rules module that reads VerifiedMedicalBillFacts directly
 * (lib/claims/medical-rules.ts, lib/claims/travel-rules.ts) calls
 * synchronously, at the exact point it is about to let a reviewed
 * CauseDefinitionMatch / CIDefinitionMatch / DisabilityDefinitionMatch /
 * VerifiedMedicalBillFacts unlock a calculatedAmount -- never after the
 * fact, never only on a schedule.
 *
 * A blocked result must never be silently dropped. The calculator/rules
 * module that calls this returns its OWN "blocked" status (using a reason
 * code from EvidenceAuthorityReasonCode, folded into its own reason-code
 * union), which lib/claims/rules.ts / ci-rules.ts / disability-rules.ts /
 * medical-rules.ts / travel-rules.ts already turn into a `needs_document`
 * ClaimAssessmentItem with amountText: null and no calculatedAmount --
 * visible to the family as pending, excluded from every total, never
 * simply removed. See lib/claims/monetary-gate.ts's own
 * evaluateMonetaryEligibility() for the final, universal, defense-in-depth
 * check every item's monetary output passes through regardless of which
 * calculator produced it.
 */
import {
  validateCompatibility,
  MONETARY_GATED_OPERATIONS,
  type CompatibilityCheck,
  type KnownOperation,
} from "@/lib/ai/provenance";
import { checkStaleness } from "@/lib/ai/staleness";

/**
 * Provenance a calculator must be given before AI-derived evidence may
 * unlock or shape a monetary figure. Deliberately a plain,
 * JSON-round-trippable shape -- like every other evidence record in
 * lib/claims/calculators/evidence.ts, it is expected to survive storage as
 * part of a CauseDefinitionMatch / CIDefinitionMatch /
 * DisabilityDefinitionMatch / VerifiedMedicalBillFacts record, and every
 * field is re-checked here at consumption time rather than trusted merely
 * because it is present -- never invented or defaulted by a calculator or
 * a caller. It is expected to be copied, field for field, from a real
 * lib/ai/provenance.ts ModelExecutionRecord (or a persisted projection of
 * one) by whichever code populates the evidence record it travels with.
 */
export type EvidenceProvenance = {
  /** The model_executions row (lib/ai/provenance.ts) this evidence's
   * extraction came from. */
  modelExecutionId: string;
  /** Which governed operation produced it -- see lib/ai/provenance.ts's
   * KNOWN_OPERATIONS. Must also be a member of MONETARY_GATED_OPERATIONS
   * for money to ever depend on it; evaluateEvidenceAuthority() enforces
   * that independently of whatever the caller believes it already is. */
  operation: KnownOperation;
  /** Copied from ModelExecutionRecord.verified -- lib/ai/provenance.ts's
   * own computeVerified(): true only when the call succeeded AND the
   * provider's own response reported a non-empty resolved model. */
  verified: boolean;
  /** The provider's OWN reported model identity for this exact call.
   * Never the requested/alias identity -- see lib/ai/provenance.ts's
   * module doc comment on the two-level identity. */
  resolvedModel: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
  /** The version of the code that validated/parsed this operation's
   * output before it was trusted (e.g. claim-evidence extraction's own
   * schema validator version, or a downstream reader's expected input
   * version). Compared through lib/ai/provenance.ts's own
   * validateCompatibility() exactly like a schema/prompt pair. */
  validatorVersion: string | null;
  /** The evidence document this record was produced from. */
  sourceDocumentId: string;
  /** The exact version/hash of that document at extraction time (e.g. its
   * file_hash). Compared against a caller-supplied "current" version --
   * see EvidenceAuthorityOptions.expectedSourceDocumentVersion -- so a
   * corrected re-upload can never keep unlocking money through evidence
   * extracted from the version it replaced. */
  sourceDocumentVersion: string | null;
  /** Set once a newer model execution has superseded this one for the
   * same evidence (e.g. a corrected re-upload was re-extracted, or an
   * operator re-ran extraction after a prompt fix) -- the id of whichever
   * execution replaced it. Never cleared once set. */
  supersededByExecutionId?: string | null;
  /** Set by an operational process (e.g.
   * lib/jobs/model-execution-staleness-processor.ts, or a manual
   * operator action) that has explicitly flagged this exact record as
   * needing re-extraction before it may be relied on again -- distinct
   * from the CURRENT_SCHEMA_VERSION-driven staleness checkStaleness()
   * already computes, since a record can be flagged for mandatory
   * reprocessing even when its own schema version has not changed (e.g. a
   * discovered extraction-quality regression). */
  reprocessingRequired?: boolean;
};

export type EvidenceAuthorityReasonCode =
  | "EVIDENCE_PROVENANCE_MISSING"
  | "EVIDENCE_EXECUTION_UNVERIFIED"
  | "EVIDENCE_MODEL_IDENTITY_MISSING"
  | "EVIDENCE_NOT_MONETARY_GATED_OPERATION"
  | "EVIDENCE_PROMPT_SCHEMA_INCOMPATIBLE"
  | "EVIDENCE_EXECUTION_SUPERSEDED"
  | "EVIDENCE_REPROCESSING_REQUIRED"
  | "EVIDENCE_SOURCE_DOCUMENT_CHANGED"
  | "EVIDENCE_STALE";

export type EvidenceAuthorityResult =
  | { authorized: true }
  | { authorized: false; reasonCode: EvidenceAuthorityReasonCode; message: string };

export type EvidenceAuthorityOptions = {
  /** The source-document version this calculation's OWN context expects
   * right now (e.g. the evidence document's current file_hash / the head
   * of its supersession chain). When supplied, a provenance record
   * produced from a different document version is rejected -- this is
   * what stops a corrected re-upload's superseded document from
   * continuing to unlock money through an old, still-cached match.
   * Omitted (not supplied) skips this specific check: not every call site
   * has an independent "current version" to compare against yet (see this
   * PR's own notes on remaining gaps), and the document-level supersession
   * fix in lib/claims/evidence/store.ts's supersedeEvidenceDocument() and
   * lib/claims/evidence/medical-bill-evidence.ts's
   * loadVerifiedMedicalBillFacts() is the primary defense against a
   * superseded document's evidence resurfacing at all. */
  expectedSourceDocumentVersion?: string | null;
  /** Overrides provenance.validatorVersion as the "outputValidatorVersion"
   * side of the compatibility check, for a caller that knows the exact
   * validator version IT is built against (rather than trusting whatever
   * the provenance record itself claims). Omitted uses
   * provenance.validatorVersion for both sides of the comparison, which
   * only ever catches an internally-inconsistent record, not a record
   * that is stale relative to this caller's own code. */
  outputValidatorVersion?: string | null;
};

/**
 * The one synchronous "may this piece of AI-derived evidence unlock or
 * shape a monetary figure RIGHT NOW" decision. Pure, deterministic, and
 * side-effect free -- it never queries the database, never re-runs a
 * model, and never persists anything; it only judges the provenance
 * record it is handed, exactly the way lib/claims/calculators/evidence.ts's
 * validate*Evidence() functions judge structural evidence shapes.
 *
 * Order matters and is fail-closed throughout: the FIRST problem found is
 * returned, mirroring lib/claims/monetary-gate.ts's own
 * evaluateMonetaryEligibility() -- a caller only ever needs the first
 * reason to explain to the family (and to record in telemetry) why an
 * amount was withheld.
 */
export function evaluateEvidenceAuthority(
  provenance: EvidenceProvenance | null | undefined,
  options: EvidenceAuthorityOptions = {},
): EvidenceAuthorityResult {
  if (!provenance) {
    return {
      authorized: false,
      reasonCode: "EVIDENCE_PROVENANCE_MISSING",
      message: "This evidence has no recorded model-execution provenance, so DearPolicy cannot confirm it was produced by a verified AI operation.",
    };
  }
  if (!provenance.verified) {
    return {
      authorized: false,
      reasonCode: "EVIDENCE_EXECUTION_UNVERIFIED",
      message: "The model execution behind this evidence is not verified -- there is no confirmed resolved model identity from the provider for this exact call.",
    };
  }
  if (!provenance.resolvedModel || provenance.resolvedModel.trim() === "") {
    return {
      authorized: false,
      reasonCode: "EVIDENCE_MODEL_IDENTITY_MISSING",
      message: "The exact provider model that produced this evidence is unknown, so DearPolicy cannot confirm it was produced by a governed, current extraction.",
    };
  }
  if (!MONETARY_GATED_OPERATIONS.has(provenance.operation)) {
    return {
      authorized: false,
      reasonCode: "EVIDENCE_NOT_MONETARY_GATED_OPERATION",
      message: `"${provenance.operation}" is not an operation this codebase allows to unlock a monetary result.`,
    };
  }
  const compatibility: CompatibilityCheck = {
    operation: provenance.operation,
    promptVersion: provenance.promptVersion,
    schemaVersion: provenance.schemaVersion,
    outputValidatorVersion: options.outputValidatorVersion ?? provenance.validatorVersion,
    downstreamCalculatorVersion: provenance.validatorVersion,
  };
  const compat = validateCompatibility(compatibility);
  if (!compat.compatible) {
    return {
      authorized: false,
      reasonCode: "EVIDENCE_PROMPT_SCHEMA_INCOMPATIBLE",
      message: compat.reason ?? "The prompt/schema/validator combination behind this evidence is not one DearPolicy currently trusts for a monetary result.",
    };
  }
  if (provenance.supersededByExecutionId) {
    return {
      authorized: false,
      reasonCode: "EVIDENCE_EXECUTION_SUPERSEDED",
      message: "A newer model execution has superseded the one this evidence was produced from -- the superseded record can never unlock a monetary result.",
    };
  }
  if (provenance.reprocessingRequired) {
    return {
      authorized: false,
      reasonCode: "EVIDENCE_REPROCESSING_REQUIRED",
      message: "This evidence has been flagged for mandatory re-processing and cannot unlock a monetary result until that completes.",
    };
  }
  if (
    options.expectedSourceDocumentVersion != null &&
    provenance.sourceDocumentVersion !== options.expectedSourceDocumentVersion
  ) {
    return {
      authorized: false,
      reasonCode: "EVIDENCE_SOURCE_DOCUMENT_CHANGED",
      message: "The source document has changed since this evidence was extracted -- a corrected or replaced upload must be re-reviewed before it can unlock a monetary result.",
    };
  }
  const staleness = checkStaleness({
    operation: provenance.operation,
    schemaVersion: provenance.schemaVersion,
    verified: provenance.verified,
  });
  if (staleness.stale) {
    return {
      authorized: false,
      reasonCode: "EVIDENCE_STALE",
      message: `This evidence is stale and needs reprocessing before it can unlock a monetary result: ${staleness.reason}`,
    };
  }
  return { authorized: true };
}

/** Convenience for an AGGREGATE evidence source backed by more than one
 * document -- VerifiedMedicalBillFacts, which rolls up every matched bill
 * document for a claim into one set of verified figures. ANY one
 * unauthorized entry blocks the whole aggregate: a calculator built from
 * it (lib/claims/calculators/hospital-cash.ts,
 * medical-reimbursement.ts, reached through lib/claims/medical-rules.ts
 * and lib/claims/travel-rules.ts) cannot selectively discard just the
 * minor units one bad document contributed without re-deriving the whole
 * aggregate from scratch -- that finer-grained exclusion is a known,
 * documented gap (see this PR's own notes), not something this function
 * silently pretends to do. An empty/absent list is itself
 * EVIDENCE_PROVENANCE_MISSING -- see evaluateEvidenceAuthority()'s own
 * null-provenance branch. */
export function evaluateAggregateEvidenceAuthority(
  provenances: EvidenceProvenance[] | null | undefined,
  options: EvidenceAuthorityOptions = {},
): EvidenceAuthorityResult {
  if (!provenances || provenances.length === 0) {
    return evaluateEvidenceAuthority(null, options);
  }
  for (const provenance of provenances) {
    const result = evaluateEvidenceAuthority(provenance, options);
    if (!result.authorized) return result;
  }
  return { authorized: true };
}
