import type { CauseDefinitionMatch, CIDefinitionMatch, DisabilityDefinitionMatch, VerifiedMedicalBillFacts } from "./calculators/evidence";

export type ClaimEventType = "accident" | "diagnosis" | "hospitalisation" | "death" | "disability" | "other";

export type ClaimFacts = {
  eventType: ClaimEventType | null;
  eventDate: string | null;
  death: boolean | null;
  deathDate: string | null;
  causeOfDeath: string | null;
  accidentalDeath: boolean | null;
  accidentType: string | null;
  accidentDate: string | null;
  injured: boolean | null;
  injuries: string[];
  fractureBodyPart: string | null;
  diagnosis: string | null;
  diagnosisStage: string | null;
  diagnosisSite: string | null;
  diagnosisDate: string | null;
  hospitalised: boolean | null;
  hospitalNights: number | null;
  ambulanceUsed: boolean | null;
  ambulanceBill: number | null;
  hospitalBill: number | null;
  outOfPocket: number | null;
  surgery: boolean | null;
  permanentImpairment: boolean | null;
  competitiveRacing: boolean | null;
  racingAuthoritySanctioned: boolean | null;
  medicalReportAvailable: boolean | null;
  /** Whether the family SAYS they possess an official cause-of-death
   * document -- a death certificate, a police report, or a coroner's/medical
   * examiner's report. This is an availability signal ONLY: it may drive a
   * request to upload the document, but it can never by itself authorise an
   * accidental-death amount, no matter how the family answers. */
  causeOfDeathDocumentAvailable: boolean | null;
  /** Whether DearPolicy has actually processed an uploaded official
   * cause-of-death document -- extracted and read its stated cause. This is
   * never set from a chat answer: a family saying "yes" or "I uploaded it"
   * is not DearPolicy having reviewed the document. It is set only once a
   * document has genuinely been read. */
  causeOfDeathEvidenceReviewed: boolean | null;
  /** Policy-specific matches between a REVIEWED official cause-of-death
   * document and a particular policy's own accidental-death definition.
   * There is deliberately no single global "is this confirmed" boolean: a
   * cause can satisfy one policy's definition and not another's, so each
   * entry is scoped to one family member, one claim, one contract and
   * (when relevant) one coverage. `calculateAccidentalDeath()` independently
   * re-validates every field of the applicable entry -- this list is never
   * trusted at face value, and is never set from a chat answer or any other
   * free text, since no document-review pipeline exists in this slice yet
   * to populate it. Empty by default. */
  causeDefinitionMatches: CauseDefinitionMatch[];
  /** ISO date symptoms were first noticed, when the policy's own wording
   * makes it relevant (e.g. a waiting period measured from first symptom
   * rather than diagnosis). Chat-reported only -- like every other date
   * here, it is a REPORTED fact, not evidence; the CI calculator only ever
   * uses it where a formula input explicitly calls for it and never to
   * infer a diagnosis or its timing. */
  firstSymptomDate: string | null;
  /** ISO date of the first consultation with a doctor about the reported
   * condition, when relevant to a policy's own wording. Chat-reported. */
  firstConsultationDate: string | null;
  /** Whether the family SAYS they possess a medical document supporting the
   * reported diagnosis (a specialist memo, pathology/imaging/laboratory
   * report, discharge summary, surgical report, or other insurer-requested
   * medical evidence). Availability signal ONLY -- exactly like
   * `causeOfDeathDocumentAvailable` -- it may drive a request to upload the
   * document, but it can never by itself authorise a critical-illness
   * amount, however the family answers. */
  medicalEvidenceDocumentAvailable: boolean | null;
  /** Policy-specific matches between REVIEWED medical evidence and ONE
   * policy's own critical-illness benefit definition (for one illness,
   * stage and benefit). Never set from chat text or any model output --
   * see lib/claims/evidence/ci-matches.ts, the only writer, and
   * lib/claims/orchestrator.ts, which reloads this fresh from the
   * database every turn exactly like `causeDefinitionMatches`. A match for
   * one illness, stage, policy, coverage, member or document version can
   * never unlock another -- calculateCriticalIllness() independently
   * re-validates every field of whichever entry a caller supplies. */
  ciDefinitionMatches: CIDefinitionMatch[];
  /** Explicit, user-reported amount already paid under a policy's own
   * lifetime aggregate benefit maximum -- keyed by policyId. NEVER
   * inferred or defaulted: the composition engine (lib/claims/
   * composition/engine.ts) blocks a benefit closed rather than guess
   * remaining lifetime capacity when wording establishes a lifetime cap
   * and no entry exists here for that policy. */
  priorPaidAmounts?: Record<string, { amount: number; currency: string; recordedAt: string }>;
  /** Chat-REPORTED admission/discharge dates -- never treated as verified.
   * lib/claims/medical-rules.ts prefers the VERIFIED equivalents on
   * `verifiedMedicalBillFacts` when present, and only ever falls back to
   * these for a lower-confidence day-count estimate, never for a
   * reimbursement eligible-expense figure. */
  admissionDate: string | null;
  dischargeDate: string | null;
  hospitalName: string | null;
  wardType: string | null;
  /** Whether the family SAYS the treating hospital/doctor was on the
   * insurer's panel -- an availability/reported signal only, exactly like
   * `causeOfDeathDocumentAvailable`. It can shape a question or a
   * lower-confidence estimate, but the medical calculators only ever
   * apply a non-panel restriction factor once it is backed by the
   * evidenced policy wording (lib/claims/medical-evidence.ts's
   * findPlanProvisions()) applied to this reported/verified status. */
  panelStatusReported: "panel" | "non_panel" | "unknown" | null;
  referralObtained: boolean | null;
  preAuthorisationObtained: boolean | null;
  /** Whether the family SAYS they possess a hospital bill, itemised bill,
   * or related medical-claim document. Availability signal ONLY -- exactly
   * like `causeOfDeathDocumentAvailable`/`medicalEvidenceDocumentAvailable`
   * -- it can drive an upload request but can never by itself authorise a
   * medical-claim amount. */
  medicalBillDocumentAvailable: boolean | null;
  /** Whether DearPolicy has actually processed an uploaded medical-claim
   * document. Never set from a chat answer -- see
   * lib/claims/evidence/medical-bill-evidence.ts, the only writer of the
   * underlying review state. */
  medicalBillEvidenceReviewed: boolean | null;
  /** The aggregated, reviewer-CONFIRMED bill evidence for this claim --
   * reloaded fresh from lib/claims/evidence/medical-bill-evidence.ts's
   * loadVerifiedMedicalBillFacts() every turn, exactly like
   * `causeDefinitionMatches`/`ciDefinitionMatches` above. Never set from
   * chat text or any model output. The ONLY source a medical calculator
   * may treat as a verified eligible billed expense or a verified
   * admission/discharge/ward/panel/third-party-payment fact. */
  verifiedMedicalBillFacts: VerifiedMedicalBillFacts | null;
  /** Whether the family SAYS they possess a medical specialist's report or
   * assessment establishing whether a disability is permanent (for TPD) or
   * describing its exact nature (for a schedule-of-injuries claim).
   * Availability signal ONLY -- exactly like `causeOfDeathDocumentAvailable`/
   * `medicalEvidenceDocumentAvailable` -- it can drive an upload request
   * but can never by itself authorise a disability amount, however the
   * family answers. */
  disabilityAssessmentDocumentAvailable: boolean | null;
  /** Whether DearPolicy has actually processed an uploaded disability
   * assessment document. Never set from a chat answer -- see
   * lib/claims/evidence/disability-matches.ts, the only writer of the
   * underlying review state. */
  disabilityAssessmentEvidenceReviewed: boolean | null;
  /** Policy-specific matches between REVIEWED medical evidence and ONE
   * policy's own disability definition (TPD, one exact schedule-of-injuries
   * row, or disability income). Never set from chat text or any model
   * output -- see lib/claims/evidence/disability-matches.ts, the only
   * writer, and lib/claims/orchestrator.ts, which reloads this fresh from
   * the database every turn exactly like `ciDefinitionMatches`. A match for
   * one benefit/match-key/policy/coverage/member/document-version can never
   * unlock another -- calculateDisabilityBenefit()/calculateDisabilityIncome()
   * independently re-validate every field of whichever entry a caller
   * supplies. */
  disabilityDefinitionMatches: DisabilityDefinitionMatch[];
  /** ISO dates of this trip's departure and return, when relevant to a
   * "hospitalisation" or "death" claim event for a family member who also
   * owns Travel cover. Chat-REPORTED only -- like every other date here,
   * never evidence. lib/claims/travel-rules.ts's own safety boundary
   * (see that module's doc comment) never assumes a health or death event
   * occurred during a covered trip without BOTH of these confirmed. */
  tripDepartureDate: string | null;
  tripReturnDate: string | null;
  uncertainFacts: string[];
  factSources?: Record<string, { source: "user" | "system-derived"; text: string; recordedAt: string; timeZone?: string; anchorDate?: string }>;
};

export type ClaimQuestion = {
  id: string;
  text: string;
  type: "yes_no" | "text" | "money" | "date" | "choice";
  options?: string[];
  why: string;
};

export type ClaimEvidence = {
  chunkId: string;
  policyId: string;
  policyName: string;
  insurer?: string;
  pageStart: number;
  pageEnd: number;
  documentRole?: string | null;
  personalEvidence?: boolean;
  evidenceLabel?: string;
};

export type ClaimAssessmentItem = {
  id: string;
  title: string;
  status: "likely_applicable" | "potentially_applicable" | "not_applicable" | "needs_document";
  amountText: string | null;
  reason: string;
  conditions: string[];
  evidenceTerms: string[];
  productName: string | null;
  coverageId?: string;
  calculatedAmount?: number;
  currency?: string;
  /** A reimbursement is the actual eligible bill, so it is listed on its own
   * rather than folded into the lump-sum total. */
  aggregation?: "additive" | "reimbursement";
  /** Another benefit under the same cover pays instead of this one. */
  supersededBy?: string;
  /** The cover this figure is paid out of, as the certificate names it. */
  coverLabel?: string;
  ruleEvidence?: ClaimEvidence;
  /** The calculator's own stable SHA-256 calculation identity (see
   * lib/claims/calculators/death-benefit.ts's stableId()), copied through
   * unchanged so the claim-composition engine (lib/claims/composition/
   * engine.ts) can build on the calculator's own identity rather than
   * recomputing a weaker one from this already-flattened item. Absent for
   * any assessment item that isn't backed by one of those calculators. */
  calculationId?: string;
  /** Result of the server-side fail-closed monetary eligibility gate. */
  monetaryDecision?:
    | { status: "allowed" }
    | { status: "blocked"; reasonCode: string; message: string };
};

export type ClaimDecisionPacket = {
  sessionId: string;
  eventSummary: string;
  facts: ClaimFacts;
  knownFacts: string[];
  missingFacts: string[];
  relevantOwnedProducts: string[];
  assessments: ClaimAssessmentItem[];
  nextSteps: string[];
  ready: boolean;
  /** The deterministic claim-composition engine's result for this turn
   * (lib/claims/composition/engine.ts's composeClaim()) -- present only
   * when the event type has a wired composition path (death, currently).
   * This, never a model, is what selected/capped/totalled `assessments`
   * into a safe cross-policy total; see engine.ts's own doc comment. */
  compositionResult?: ClaimCompositionResultLike | null;
};

/** Structural alias for lib/claims/composition/types.ts's
 * `ClaimCompositionResult`, declared locally to avoid this file importing
 * from ./composition (which itself imports from this file) -- see that
 * module for the authoritative type and validateComposedBenefit(), the
 * fail-closed runtime validator every persisted/round-tripped value here
 * must be re-checked against before being trusted for anything but
 * display. */
export type ClaimCompositionResultLike = {
  claimEventId: string;
  familyMemberId: string;
  engineVersion: string;
  calculationId: string;
  calculatedAt: string;
  policies: unknown[];
  alternativeGroups: unknown[];
  totalsByCurrency: { currency: string; includedAmount: number }[];
  excludedBenefits: unknown[];
  outstandingQuestions: string[];
  disclaimer: string;
};

export const EMPTY_CLAIM_FACTS: ClaimFacts = {
  eventType: null,
  eventDate: null,
  death: null,
  deathDate: null,
  causeOfDeath: null,
  accidentalDeath: null,
  accidentType: null,
  accidentDate: null,
  injured: null,
  injuries: [],
  fractureBodyPart: null,
  diagnosis: null,
  diagnosisStage: null,
  diagnosisSite: null,
  diagnosisDate: null,
  hospitalised: null,
  hospitalNights: null,
  ambulanceUsed: null,
  ambulanceBill: null,
  hospitalBill: null,
  outOfPocket: null,
  surgery: null,
  permanentImpairment: null,
  competitiveRacing: null,
  racingAuthoritySanctioned: null,
  medicalReportAvailable: null,
  causeOfDeathDocumentAvailable: null,
  causeOfDeathEvidenceReviewed: null,
  causeDefinitionMatches: [],
  firstSymptomDate: null,
  firstConsultationDate: null,
  medicalEvidenceDocumentAvailable: null,
  ciDefinitionMatches: [],
  priorPaidAmounts: {},
  admissionDate: null,
  dischargeDate: null,
  hospitalName: null,
  wardType: null,
  panelStatusReported: null,
  referralObtained: null,
  preAuthorisationObtained: null,
  medicalBillDocumentAvailable: null,
  medicalBillEvidenceReviewed: null,
  verifiedMedicalBillFacts: null,
  disabilityAssessmentDocumentAvailable: null,
  disabilityAssessmentEvidenceReviewed: null,
  disabilityDefinitionMatches: [],
  tripDepartureDate: null,
  tripReturnDate: null,
  uncertainFacts: [],
  factSources: {},
};
