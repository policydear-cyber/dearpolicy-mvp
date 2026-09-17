import type { ChatAnswer, ChatCitation, ChatQuestion, PolicyCurrentness, ReviewCoverage } from "@/types";

export type FactValue = string | number | boolean | string[] | null;
export type ConversationFact = {
  value: FactValue;
  state: "known" | "unknown" | "pending";
  quote: string;
  recordedAt: string;
  source: "user" | "system-derived";
};
export type SubjectFacts = Record<string, ConversationFact>;
export type ScenarioFamily =
  | "death" | "injury" | "illness" | "hospitalisation" | "disability"
  | "property" | "motor" | "travel" | "liability" | "savings" | "life_event" | "other";
export type ScenarioTrait =
  | "death" | "bodily_injury" | "illness" | "diagnosis" | "hospitalisation" | "disability"
  | "accident" | "sudden" | "external" | "violent" | "unintentional_to_insured" | "self_inflicted"
  | "vehicle_collision" | "property_damage" | "theft" | "loss" | "liability"
  | "travel_disruption" | "trip_cancellation" | "delay" | "medical_expense"
  | "maturity" | "surrender" | "premium_event" | "income_loss" | "care_need" | "other";
export type ScenarioClassification = {
  subjectId: string;
  label: string;
  family: ScenarioFamily;
  traits: ScenarioTrait[];
  quote: string;
  recordedAt: string;
  source: "model-candidate" | "system-derived";
};
export type ConversationState = {
  subjects: Record<string, SubjectFacts>;
  /** Event candidates are kept separate from user facts. They help retrieve and
   * test policy clauses but never prove that a policy definition is met. */
  scenarios?: Record<string, ScenarioClassification[]>;
  intent?: "claim" | "portfolio" | "policy_question";
  activeQuery?: string;
  activeClaimQuery?: string;
  pending?: ChatQuestion & { subjectId: string; factKey: string };
  /** The claim on record for this conversation's event, once one exists. */
  claimSessionId?: string;
  personContext?: { message: string; recordedAt: string };
};
export type Conversation = {
  id: string; account_id: string; family_member_id: string | null;
  title: string; revision: number; state: ConversationState;
};
export type HistoryToken = { global: number; profile: number; scopeKey: string };
export type PolicyReview = {
  id: string; ownerId: string; ownerName: string; policyName: string;
  status: "searched" | "missing_wording" | "not_ready" | "no_matching_section" | "needs_review";
  documentCount: number;
  /** Measured evidence completeness for this contract. */
  coverage?: ReviewCoverage;
  /** Payment/renewal recency. Never affects ownership. */
  currentness?: PolicyCurrentness;
};
export type SourceQuote = { sourceId: string; quote: string };
export type PolicySource = {
  id: string; policyId: string; text: string; pageStart: number; pageEnd: number;
  productScopes: string[]; citation: ChatCitation;
  lexicalMatch?: boolean; semanticDistance?: number | null;
};
export type PolicyFormula = {
  kind: "none" | "sum_insured" | "fixed" | "expense_cap" | "daily";
  value: number | null; currency: string | null; factKey: string | null;
  offsetDays: number | null; maximumDays: number | null; evidence: SourceQuote | null;
};
export type PolicyRequirement = {
  factKey: string;
  operator: "present" | "equals" | "at_least" | "days_after_effective" | "document";
  value: FactValue;
  question: string;
  why: string;
  evidence: SourceQuote;
  appliesWhen?: { factKey:string; value:FactValue }[];
};
export type PolicyBenefit = {
  title: string; coverageId: string | null;
  evidence: SourceQuote[];
  formula: PolicyFormula;
  requirements: PolicyRequirement[];
  conditions: { text: string; evidence: SourceQuote }[];
};
export type PolicyObservation = { text: string; evidence: SourceQuote[] };
export type PolicyAnalysis = {
  benefits: PolicyBenefit[];
  observations: PolicyObservation[];
  nextSteps: PolicyObservation[];
};
export type Progress = { stage: string; completed: number; total: number };
export type ChatResult = { answer: ChatAnswer; retrieved: unknown[] };
