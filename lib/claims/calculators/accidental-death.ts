/**
 * Pure, deterministic accidental-death benefit calculator.
 *
 * Everything death-benefit.ts enforces for an ordinary death benefit applies
 * here too -- this module reuses its formula and cap arithmetic rather than
 * duplicating it. What is different, and stricter, is the cause of death:
 * a policy's accidental-death benefit pays only when the death matches that
 * POLICY'S OWN definition of an accident, and this module never decides that
 * match itself.
 *
 * A cause can satisfy one policy's definition and not another's, so there is
 * no single global "is this confirmed" flag. The caller supplies the one
 * applicable, policy-specific `CauseDefinitionMatch` record for this exact
 * family member, claim, contract and (when relevant) coverage -- or `null`
 * when none has been reviewed yet -- and this calculator independently
 * re-validates every field of that record before it can unlock an amount.
 * A caller's own filtering (e.g. picking the "right" match out of a list) is
 * never trusted alone: the family member, claim event, contract, coverage,
 * and the definition evidence the match was actually checked against are
 * all re-checked here against this specific calculation's own context. A
 * match confirmed for a different policy, a different claim, a different
 * family member, or an earlier/different wording version can never unlock
 * this one.
 *
 * Circumstances the policy itself carves out (suicide, self-inflicted
 * injury, intoxication, criminal activity, war, hazardous activity, and any
 * other named exclusion) are never assumed either way: each is passed in as
 * its own tri-state fact -- confirmed present, confirmed absent, or still
 * unresolved -- and an unresolved one blocks exactly like a missing formula
 * does. A death event with a merely plausible or reported accidental cause,
 * or a cause that has not yet been matched against THIS policy specifically,
 * stays out of this calculator's "calculated" branch entirely; the caller is
 * expected to keep such a benefit visible with a `needs_document`-style
 * status and no amount, and this calculator's block reason is what explains
 * why.
 */
import {
  calculateDeathBenefit, stableId,
  type DeathBenefitCap, type DeathBenefitEvidenceRef, type DeathBenefitFormula, type DeathBenefitOwnershipRef,
} from "./death-benefit";
import { validateCauseEvidence, validatePolicyEvidence, type CauseDefinitionMatch } from "./evidence";

export type { DeathBenefitEvidenceRef, DeathBenefitOwnershipRef, DeathBenefitFormula, DeathBenefitCap };
export type { CauseDefinitionMatch, CauseDefinitionMatchResult, ValidCauseEvidenceRef, ValidPolicyEvidenceRef } from "./evidence";

/** A circumstance the POLICY itself carves out of its accidental-death
 * definition. Only circumstances the wording actually names are meaningful
 * here -- this calculator never applies a condition the policy does not
 * itself define. */
export type AccidentalDeathExclusion = {
  /** A short machine-stable name, e.g. "suicide", "self_inflicted_injury",
   * "intoxication", "criminal_activity", "war", "hazardous_activity". */
  key: string;
  /** Where the policy defines this exclusion. Required whenever the
   * exclusion is included at all. */
  evidence: DeathBenefitEvidenceRef;
  /** true = confirmed to apply (blocks/rules out); false = confirmed ruled
   * out by the facts; null = still unresolved (blocks until resolved).
   * Never inferred by this module -- the caller supplies only what specific
   * facts have actually established. */
  applies: boolean | null;
};

export type AccidentalDeathInput = {
  ownership: DeathBenefitOwnershipRef | null;
  familyMember: { id: string; confirmed: boolean } | null;
  /** The specific claim (assessment session) being assessed. A reviewed
   * match recorded for a different claim can never unlock this one. */
  claimEventId: string | null;
  deathConfirmed: boolean | null;
  dateOfDeath: string | null;
  policyEffectiveDate?: string | null;
  sumInsured: number | null;
  currency: string | null;
  formula: DeathBenefitFormula | null;
  cap?: DeathBenefitCap;
  /** Where the payout rule (rate/percentage/multiple/fixed amount) itself
   * was read and verified. Absent or malformed blocks. */
  ruleEvidence: DeathBenefitEvidenceRef | null;
  ownershipEvidence: DeathBenefitEvidenceRef | null;
  /** Where the policy defines what counts as an accidental death. This is
   * distinct from ruleEvidence: one clause can state the payout formula
   * while a different clause (or the same one) defines the trigger. Absent
   * or malformed blocks -- there is nothing to confirm the cause against. */
  accidentalDeathDefinitionEvidence: DeathBenefitEvidenceRef | null;
  /** The one applicable, already-reviewed, policy-specific match between
   * the official cause-of-death evidence and THIS policy's own
   * accidental-death definition -- or `null` when none has been reviewed
   * for this exact family member/claim/contract/coverage yet. Only a
   * record whose every field independently re-validates against this
   * calculation's own context, and whose `result` is exactly `"matches"`,
   * can unlock an amount. */
  causeDefinitionMatch: CauseDefinitionMatch | null;
  /** Circumstances the policy itself carves out. Any entry left `null`
   * (unresolved) blocks. Entries the policy does not define are simply
   * omitted by the caller -- there is nothing to resolve for those. */
  exclusions?: AccidentalDeathExclusion[];
  unresolvedConditions?: string[];
};

export type AccidentalDeathBlockReasonCode =
  | "MISSING_OWNERSHIP_MAPPING"
  | "MISSING_FAMILY_MEMBER"
  | "FAMILY_MEMBER_NOT_CONFIRMED"
  | "DEATH_NOT_CONFIRMED"
  | "MISSING_DATE_OF_DEATH"
  | "MISSING_SUM_INSURED"
  | "INVALID_SUM_INSURED"
  | "IMPLAUSIBLE_SUM_INSURED"
  | "MISSING_FORMULA"
  | "INVALID_FORMULA_FRACTION"
  | "IMPLAUSIBLE_FORMULA_FRACTION"
  | "INVALID_FIXED_AMOUNT"
  | "INVALID_CAP"
  | "INVALID_CURRENCY"
  | "MALFORMED_RULE_EVIDENCE"
  | "MALFORMED_OWNERSHIP_EVIDENCE"
  | "UNRESOLVED_CONDITION"
  | "MALFORMED_POLICY_DEFINITION_EVIDENCE"
  | "MALFORMED_CAUSE_EVIDENCE"
  | "CAUSE_MATCH_MISSING"
  | "CAUSE_MATCH_FAMILY_MEMBER_MISMATCH"
  | "CAUSE_MATCH_CLAIM_EVENT_MISMATCH"
  | "CAUSE_MATCH_CONTRACT_MISMATCH"
  | "CAUSE_MATCH_COVERAGE_MISMATCH"
  | "CAUSE_MATCH_DEFINITION_MISMATCH"
  | "CAUSE_MATCH_NOT_CONFIRMED"
  | "UNRESOLVED_EXCLUSION"
  | "INVALID_EXCLUSION_EVIDENCE";

export type AccidentalDeathBlocked = {
  status: "blocked";
  reasonCode: AccidentalDeathBlockReasonCode;
  message: string;
};

export type AccidentalDeathNotApplicable = {
  status: "not_applicable";
  potentialAmount: null;
  reason: string;
};

export type AccidentalDeathCalculated = {
  status: "calculated";
  potentialAmount: number;
  currency: string;
  formulaBasis: string;
  ruleEvidence: DeathBenefitEvidenceRef;
  ownershipEvidence: DeathBenefitEvidenceRef;
  ownership: DeathBenefitOwnershipRef;
  capApplied: boolean;
  calculationId: string;
};

export type AccidentalDeathResult = AccidentalDeathCalculated | AccidentalDeathNotApplicable | AccidentalDeathBlocked;

export function calculateAccidentalDeath(input: AccidentalDeathInput): AccidentalDeathResult {
  // The cause gate runs first and independently of the base calculator: an
  // accidental-death benefit must never reach a computed amount on the
  // strength of the base death checks alone.
  const definitionCheck = validatePolicyEvidence(input.accidentalDeathDefinitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!definitionCheck.valid) {
    // validatePolicyEvidence was called with the "MALFORMED_POLICY_DEFINITION_EVIDENCE"
    // override above, so every failure branch inside it returns exactly that
    // literal -- this narrows the function's general EvidenceBlockReasonCode
    // return type back to the one reason code this calculator's own
    // AccidentalDeathBlockReasonCode actually declares (see the same pattern
    // in lib/claims/calculators/death-benefit.ts).
    return { status: "blocked", reasonCode: definitionCheck.reasonCode as "MALFORMED_POLICY_DEFINITION_EVIDENCE", message: definitionCheck.message };
  }
  const definitionEvidence = definitionCheck.evidence;

  const match = input.causeDefinitionMatch;
  if (!match) {
    return {
      status: "blocked",
      reasonCode: "CAUSE_MATCH_MISSING",
      message: "No reviewed cause-of-death evidence has been matched against this policy's own accidental-death definition yet.",
    };
  }

  const expectedFamilyMemberId = input.familyMember?.id ?? null;
  const expectedContractId = input.ownership?.contractId ?? null;
  const expectedCoverageId = input.ownership?.coverageId ?? null;

  // The match record is re-validated against THIS calculation's own
  // context field by field, never trusted just because a caller supplied
  // it as "the applicable one" -- a match for a different person, claim,
  // contract or coverage must never unlock this benefit.
  if (!match.familyMemberId || match.familyMemberId !== expectedFamilyMemberId) {
    return { status: "blocked", reasonCode: "CAUSE_MATCH_FAMILY_MEMBER_MISMATCH", message: "The reviewed cause-of-death match belongs to a different family member than the one insured under this cover." };
  }
  if (!match.claimEventId || match.claimEventId !== input.claimEventId) {
    return { status: "blocked", reasonCode: "CAUSE_MATCH_CLAIM_EVENT_MISMATCH", message: "The reviewed cause-of-death match belongs to a different claim than the one being assessed." };
  }
  if (!match.contractId || match.contractId !== expectedContractId) {
    return { status: "blocked", reasonCode: "CAUSE_MATCH_CONTRACT_MISMATCH", message: "A match confirmed for a different policy can never unlock this policy's accidental-death benefit." };
  }
  if (match.coverageId != null && match.coverageId !== expectedCoverageId) {
    return { status: "blocked", reasonCode: "CAUSE_MATCH_COVERAGE_MISMATCH", message: "The reviewed cause-of-death match belongs to a different cover under this policy." };
  }

  const matchDefinitionCheck = validatePolicyEvidence(match.definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!matchDefinitionCheck.valid) {
    // Same narrowing as definitionCheck above -- this call site is also
    // fixed to the "MALFORMED_POLICY_DEFINITION_EVIDENCE" override.
    return { status: "blocked", reasonCode: matchDefinitionCheck.reasonCode as "MALFORMED_POLICY_DEFINITION_EVIDENCE", message: matchDefinitionCheck.message };
  }
  const matchDefinitionEvidence = matchDefinitionCheck.evidence;
  // The match must have been checked against the EXACT same clause this
  // calculation is using -- not merely the same policy. A match recorded
  // against an earlier or otherwise different wording version therefore
  // fails here (different chunkId/policyId/pages), and can never unlock a
  // later or different version without the caller re-reviewing against it.
  const sameDefinition = matchDefinitionEvidence.policyId === definitionEvidence.policyId
    && matchDefinitionEvidence.chunkId === definitionEvidence.chunkId
    && matchDefinitionEvidence.pageStart === definitionEvidence.pageStart
    && matchDefinitionEvidence.pageEnd === definitionEvidence.pageEnd;
  if (!sameDefinition) {
    return {
      status: "blocked",
      reasonCode: "CAUSE_MATCH_DEFINITION_MISMATCH",
      message: "The reviewed match was checked against different policy wording than the definition this calculation is using -- for example an earlier or different policy version. It can never unlock this calculation.",
    };
  }

  const causeEvidenceCheck = validateCauseEvidence(match.causeEvidence);
  if (!causeEvidenceCheck.valid) {
    // validateCauseEvidence() always returns "MALFORMED_CAUSE_EVIDENCE" on
    // failure -- see lib/claims/calculators/evidence.ts.
    return { status: "blocked", reasonCode: causeEvidenceCheck.reasonCode as "MALFORMED_CAUSE_EVIDENCE", message: causeEvidenceCheck.message };
  }
  const causeEvidence = causeEvidenceCheck.evidence;
  if (causeEvidence.familyMemberId !== expectedFamilyMemberId) {
    return { status: "blocked", reasonCode: "CAUSE_MATCH_FAMILY_MEMBER_MISMATCH", message: "The reviewed cause-of-death document was reviewed for a different family member." };
  }
  if (causeEvidence.claimEventId !== input.claimEventId) {
    return { status: "blocked", reasonCode: "CAUSE_MATCH_CLAIM_EVENT_MISMATCH", message: "The reviewed cause-of-death document was reviewed for a different claim." };
  }

  if (match.result === "does_not_match") {
    return { status: "not_applicable", potentialAmount: null, reason: "The reviewed official cause-of-death document does not meet this policy's own accidental-death definition." };
  }
  if (match.result !== "matches") {
    return {
      status: "blocked",
      reasonCode: "CAUSE_MATCH_NOT_CONFIRMED",
      message: "The reviewed cause-of-death evidence has not been explicitly confirmed to match this policy's own accidental-death definition.",
    };
  }

  for (const exclusion of input.exclusions ?? []) {
    if (!exclusion.evidence) {
      return { status: "blocked", reasonCode: "INVALID_EXCLUSION_EVIDENCE", message: "A policy exclusion was supplied without evidence for its wording." };
    }
    if (exclusion.applies == null) {
      return {
        status: "blocked",
        reasonCode: "UNRESOLVED_EXCLUSION",
        message: "The policy excludes accidental death caused by " + exclusion.key.replace(/_/g, " ") + ", and whether that applies here is still unresolved.",
      };
    }
    if (exclusion.applies === true) {
      return { status: "not_applicable", potentialAmount: null, reason: "The policy excludes accidental death caused by " + exclusion.key.replace(/_/g, " ") + ", and the facts confirm that applies here." };
    }
  }

  const base = calculateDeathBenefit({
    ownership: input.ownership,
    familyMember: input.familyMember,
    claimEventId: input.claimEventId,
    deathConfirmed: input.deathConfirmed,
    dateOfDeath: input.dateOfDeath,
    policyEffectiveDate: input.policyEffectiveDate,
    sumInsured: input.sumInsured,
    currency: input.currency,
    formula: input.formula,
    cap: input.cap,
    ruleEvidence: input.ruleEvidence,
    ownershipEvidence: input.ownershipEvidence,
    unresolvedConditions: input.unresolvedConditions,
  });

  if (base.status !== "calculated") {
    return base as AccidentalDeathNotApplicable | AccidentalDeathBlocked;
  }
  // The accidental-death identity extends the base calculation's own
  // identity (which already covers family member, claim, contract,
  // coverage, rule/ownership evidence, formula, cap, date of death and
  // currency) with the cause and accident-definition evidence identifiers
  // that are specific to this calculator -- so changing either evidence
  // reference produces a different calculation ID, and repeated identical
  // inputs always reproduce the same one.
  const calculationId = "ad:" + stableId([
    base.calculationId,
    definitionEvidence.policyId, definitionEvidence.chunkId, definitionEvidence.pageStart, definitionEvidence.pageEnd,
    causeEvidence.documentId, causeEvidence.documentType, causeEvidence.pageStart ?? null, causeEvidence.pageEnd ?? null,
    causeEvidence.sourceLocation ?? null, causeEvidence.familyMemberId, causeEvidence.claimEventId,
  ]);
  return {
    status: "calculated",
    potentialAmount: base.potentialAmount,
    currency: base.currency,
    formulaBasis: base.formulaBasis + " (accidental-death cause confirmed against the policy's own definition)",
    ruleEvidence: base.ruleEvidence,
    ownershipEvidence: base.ownershipEvidence,
    ownership: base.ownership,
    capApplied: base.capApplied,
    calculationId,
  };
}
