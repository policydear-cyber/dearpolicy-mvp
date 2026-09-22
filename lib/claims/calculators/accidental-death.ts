/**
 * Pure, deterministic accidental-death benefit calculator.
 *
 * Everything death-benefit.ts enforces for an ordinary death benefit applies
 * here too -- this module reuses its formula and cap arithmetic rather than
 * duplicating it. What is different, and stricter, is the cause of death:
 * a policy's accidental-death benefit pays only when the death matches that
 * POLICY'S OWN definition of an accident, and this module never decides that
 * match itself. It accepts only a caller-supplied, already-resolved
 * confirmation of the match -- never a scenario guess, a keyword match on
 * free text, or an unconfirmed report -- and blocks (no amount, no
 * inference) whenever that confirmation is anything short of a genuine
 * match against documented evidence.
 *
 * Circumstances the policy itself carves out (suicide, self-inflicted
 * injury, intoxication, criminal activity, war, hazardous activity, and any
 * other named exclusion) are never assumed either way: each is passed in as
 * its own tri-state fact -- confirmed present, confirmed absent, or still
 * unresolved -- and an unresolved one blocks exactly like a missing formula
 * does. A death event with a merely plausible or reported accidental cause
 * stays out of this calculator's "calculated" branch entirely; the caller is
 * expected to keep such a benefit visible with a `needs_document`-style
 * status and no amount, and this calculator's block reason is what explains
 * why.
 */
import { calculateDeathBenefit, type DeathBenefitCap, type DeathBenefitEvidenceRef, type DeathBenefitFormula, type DeathBenefitOwnershipRef } from "./death-benefit";

export type { DeathBenefitEvidenceRef, DeathBenefitOwnershipRef, DeathBenefitFormula, DeathBenefitCap };

/**
 * How sure DearPolicy can be that the reported death matches the policy's
 * own definition of an accidental death.
 *   confirmed_matches_definition -- an official document (death certificate
 *     cause-of-death entry, police report, coroner's/medical examiner's
 *     report) has been reviewed and its stated cause matches the exact
 *     wording of the policy's accidental-death definition.
 *   reported_unconfirmed -- the family has described circumstances
 *     consistent with an accident (e.g. "he died in a car crash"), but no
 *     official document has yet been checked against the policy's
 *     definition. This is exactly the case that must never authorise an
 *     amount by itself.
 *   ruled_out -- the reported or documented cause affirmatively does not
 *     meet the policy's accident definition (e.g. a confirmed illness-only
 *     death, or a cause the policy defines as excluded rather than
 *     accidental).
 *   unknown -- the cause of death has not been reported at all yet.
 */
export type AccidentalDeathCauseConfirmation =
  | "confirmed_matches_definition"
  | "reported_unconfirmed"
  | "ruled_out"
  | "unknown";

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
  deathConfirmed: boolean | null;
  dateOfDeath: string | null;
  policyEffectiveDate?: string | null;
  sumInsured: number | null;
  currency: string | null;
  formula: DeathBenefitFormula | null;
  cap?: DeathBenefitCap;
  /** Where the payout rule (rate/percentage/multiple/fixed amount) itself
   * was read and verified. Absent blocks. */
  ruleEvidence: DeathBenefitEvidenceRef | null;
  ownershipEvidence: DeathBenefitEvidenceRef | null;
  /** Where the policy defines what counts as an accidental death. This is
   * distinct from ruleEvidence: one clause can state the payout formula
   * while a different clause (or the same one) defines the trigger. Absent
   * blocks -- there is nothing to confirm the cause against. */
  accidentalDeathDefinitionEvidence: DeathBenefitEvidenceRef | null;
  /** How sure DearPolicy can be that the reported cause matches that
   * definition. Only "confirmed_matches_definition" can produce an amount. */
  causeConfirmation: AccidentalDeathCauseConfirmation | null;
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
  | "MISSING_RULE_EVIDENCE"
  | "MISSING_OWNERSHIP_EVIDENCE"
  | "UNRESOLVED_CONDITION"
  | "MISSING_ACCIDENT_DEFINITION_EVIDENCE"
  | "CAUSE_NOT_CONFIRMED"
  | "CAUSE_UNKNOWN"
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
  if (!input.accidentalDeathDefinitionEvidence) {
    return {
      status: "blocked",
      reasonCode: "MISSING_ACCIDENT_DEFINITION_EVIDENCE",
      message: "The policy's own definition of an accidental death has not been located and quoted.",
    };
  }
  if (input.causeConfirmation === "ruled_out") {
    return { status: "not_applicable", potentialAmount: null, reason: "The reported or documented cause of death does not meet this policy's accidental-death definition." };
  }
  if (input.causeConfirmation == null || input.causeConfirmation === "unknown") {
    return {
      status: "blocked",
      reasonCode: "CAUSE_UNKNOWN",
      message: "The cause of death has not been reported yet, so it cannot be checked against the policy's accidental-death definition.",
    };
  }
  if (input.causeConfirmation === "reported_unconfirmed") {
    return {
      status: "blocked",
      reasonCode: "CAUSE_NOT_CONFIRMED",
      message: "The reported circumstances may be consistent with an accident, but an official cause-of-death document, police report or coroner's report has not yet been checked against the policy's own definition. A reported circumstance alone does not authorise this amount.",
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
  return {
    status: "calculated",
    potentialAmount: base.potentialAmount,
    currency: base.currency,
    formulaBasis: base.formulaBasis + " (accidental-death cause confirmed against the policy's own definition)",
    ruleEvidence: base.ruleEvidence,
    ownershipEvidence: base.ownershipEvidence,
    ownership: base.ownership,
    capApplied: base.capApplied,
    calculationId: "ad:" + base.calculationId,
  };
}
