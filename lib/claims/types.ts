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
  /** Whether a deterministic, evidence-backed comparison has matched the
   * REVIEWED official cause-of-death evidence against the exact wording of
   * this policy's own accidental-death definition. This is the only field
   * that can authorise an accidental-death amount, and only together with
   * `causeOfDeathEvidenceReviewed` and `causeOfDeathEvidence` both present.
   * Never set from a chat answer, and never implied by
   * `causeOfDeathDocumentAvailable` alone. */
  causeMatchesAccidentDefinition: boolean | null;
  /** Where the REVIEWED official cause-of-death document itself was read --
   * the death certificate's cause-of-death entry, the police report, or the
   * coroner's/medical examiner's report DearPolicy actually processed.
   * Required whenever `causeMatchesAccidentDefinition` is set; the policy's
   * own accident-definition wording is tracked separately, as the matching
   * death rule's own evidence (see death-evidence.ts / DeathRuleEvidence). */
  causeOfDeathEvidence: { documentId?: string; pageStart?: number; pageEnd?: number; label?: string } | null;
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
  causeMatchesAccidentDefinition: null,
  causeOfDeathEvidence: null,
  uncertainFacts: [],
  factSources: {},
};
