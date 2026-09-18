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
  ruleEvidence?: ClaimEvidence;
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
  uncertainFacts: [],
  factSources: {},
};
