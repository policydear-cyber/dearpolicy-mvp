import type { UnitTerms } from "@/lib/claims/unit-terms";

export type FamilyMember = { id:string; displayName:string; relationship:string; policyCount?:number };
export type Policy = { id:string; familyMemberId:string; insurer:string|null; productName:string|null; policyNumber:string|null; policyType:string|null; status:string; processingStatus:string; originalFilename:string; pageCount:number|null; createdAt:string };
export type RetrievedChunk = {
  id:string; policyId:string; insurer:string|null; productName:string|null; pageStart:number; pageEnd:number; heading:string|null; text:string;
  distance:number; documentRole:string|null; personalCoverageConfirmed:boolean; documentAuthority:number;
};
export type StructuredCoverageFact = {
  id:string; policyId:string; category:string; amount:number|null; currency:string|null; productName:string|null; sourcePage:number|null; evidenceText:string|null;
  insurer:string|null; policyName:string|null; policyNumber:string|null; documentRole:string|null;
};
export type ChatCitation = { chunkId:string; policyId:string; policyName:string; insurer?:string; pageStart:number|null; pageEnd:number|null; documentRole?:string|null; personalEvidence?:boolean; evidenceLabel?:string;
  /** Additive (V1.1): the short supporting passage, verbatim from the cited page. */
  excerpt?:string;
  /** Additive (V1.1): the document's printed date, and whether it is outdated. */
  documentDate?:string|null; notConfirmedCurrent?:boolean };
/** A benefit or maximum amount copied deterministically from the current
 * active policy's own wording, with its page cited and its currency written
 * in that wording. It is NOT an estimate of what the insurer will pay for an
 * event and never enters a claim estimate or total (lib/chat/monetary-boundary.ts). */
export type PolicyStatedLimit = {
  kind:"policy_stated_limit";
  label:"Policy-stated coverage limit";
  notice:string;
  benefitTitle:string;
  ownerName:string|null;
  amount:number;
  currency:string;
  amountText:string;
  /** Verbatim clause text the amount and currency were read from. */
  quote:string;
  citation:ChatCitation;
  /** Gate R17: the card's own binding (person, benefit, version, page range, passage). A card without one is dropped. */
  binding?:FigureBinding;
};
/** Where a claim-related benefit stands before any claim evidence has been
 * reviewed (a preliminary claim assessment never carries an event amount). */
export type PreliminaryClaimStatus = "information_needed"|"evidence_needed"|"reviewer_assessment_needed"|"policy_condition_unresolved"|"not_applicable";
export type ClaimItem = {
  title:string;
  /** Set only by lib/chat/policy-analysis.ts when every policy-stated-limit
   * condition holds; lib/chat/monetary-boundary.ts moves it to
   * ChatAnswer.policyStatedLimits and strips every other amount. */
  policyStatedLimit?:PolicyStatedLimit;
  preliminaryStatus?:PreliminaryClaimStatus;
  status:"likely_applicable"|"potentially_applicable"|"not_applicable"|"needs_document";
  amountText:string|null;
  /** Human-readable distinction between a calculated payout and a schedule
   * amount whose payout rule has not yet been verified. */
  amountLabel?:"Calculated benefit (internal)"|"Calculated reimbursement (internal)"|"Confirmed cover amount — payout rule not yet verified"
    |"Amount printed in the policy document — not yet confirmed against your own schedule"
    |"What this benefit pays";
  /** How far the figure can be trusted, and it is always stated next to it.
   *  confirmed  — the rule came from the document and the sum insured from the
   *               person's own schedule or certificate.
   *  estimated  — one of the two came from a document that names them but is
   *               not their schedule.
   *  indicative — the rule was read from a table heading rather than the row,
   *               or the figure is the one the document prints for everyone.
   * Withholding a figure protects nobody; publishing one without saying which
   * of these it is, does the harm. Only confirmed and estimated are summed into
   * a household total. */
  estimateBasis?:"confirmed"|"estimated"|"indicative";
  calculatedAmount?:number;
  currency?:string;
  calculationKind?:"sum_insured"|"limit_percentage"|"fixed"|"expense_cap"|"daily";
  aggregation?:"additive"|"reimbursement";
  calculationId?:string;
  /** Which cover this figure belongs to -- the policy number where there is
   * one. Two rows describing the same cover share it, which is what stops the
   * same sum assured being counted twice. */
  coverKey?:string;
  /** The cover's own name, as the person's certificate prints it, for saying
   * where a figure comes from without showing them a key. */
  coverLabel?:string;
  /** The single lump-sum event this figure is paid for, when there is one.
   * Two benefits in the same cover paying on the same event are alternatives,
   * not additions. */
  payingEvent?:string;
  /** The sum insured of the cover this figure is paid out of, where it is
   * known. A policy caps what all the injuries from one accident can come to
   * at this figure, and that cap cannot be applied without it. */
  coverAmount?:number;
  /** The schedule of injuries this row came from -- one table, on one page of
   * one document. A schedule pays for the injury that happened, so two rows
   * from the same table are not two payouts. */
  scaleGroup?:string;
  /** Set when another benefit in the same cover pays instead of this one. The
   * amount stays visible; it stops being added. */
  supersededBy?:string;
  /** The contract this figure was assessed against. A cover's exclusions and
   * waiting periods govern that contract's figures and no others, and without
   * this the only way to tell them apart was the cover's printed name -- which
   * two contracts in one household routinely share. */
  contractId?:string;
  reason:string;
  conditions:string[];
};
export type PotentialPayoutTotal = {
  currency:string;
  amount:number;
  amountText:string;
  itemCount:number;
};
export type ReviewCoverage = {
  /** Documents grouped into this contract, and how many finished processing. */
  documentsTotal:number; documentsReady:number;
  /** Pages/passages stored for the processed documents, retrieved by search,
   * and actually read by the policy reader for this answer. */
  pagesTotal:number; pagesRetrieved:number; pagesRead:number;
  passagesTotal:number; passagesRetrieved:number; passagesRead:number;
  windowsAnalyzed:number; windowsFailed:number;
  completeness:"not_processed"|"no_wording"|"partial_retrieval"|"full_text_reviewed";
};
export type AnswerReviewCoverage = {
  contractsTotal:number; contractsFullyReviewed:number;
  documentsTotal:number; documentsNotProcessed:number;
  pagesTotal:number; pagesRead:number;
  windowsFailed:number;
  /** True only when every processed page of every contract was read. A negative
   * coverage conclusion is permitted only then. */
  complete:boolean;
  statement:string;
};
export type PolicyCurrentness = {
  state:"verified_recent"|"not_recently_verified"|"expiry_date_passed"|"unknown";
  label:string;
  detail:string;
  lastEvidenceOn:string|null;
  renewalOrExpiryDate:string|null;
};
export type ChatQuestion = { id:string;text:string;type:"yes_no"|"text"|"money"|"date"|"choice";options?:string[];why:string };

/** UI-facing view of one calculated, composed benefit -- a serialisable
 * projection of lib/claims/composition/types.ts's `ComposedBenefit`. Every
 * amount here already reflects whatever caps/deductions/alternative
 * selection the deterministic composition engine applied; nothing in this
 * app re-derives or re-sums these figures on the client. */
export type CompositionBenefitView = {
  benefitCode:string;
  benefitCategory:string;
  calculationId:string;
  currency:string;
  rawAmount:number;
  payableAmount:number;
  /** Null unless status is "included": a benefit that is blocked, excluded,
   * not selected or still waiting on evidence is never rendered as "$0". */
  payableAmountText:string|null;
  compositionType:"independent_additive"|"alternative_highest"|"alternative_selected"|"accelerated_from_base"|"additional_to_base"|"shared_policy_cap"|"shared_event_cap"|"informational_only"|"unknown";
  compositionGroupId:string|null;
  status:"included"|"excluded"|"blocked"|"needs_document"|"needs_review";
  blockedReasonCodes:string[];
  /** Human-readable version of blockedReasonCodes, in the same order, for
   * direct display without a client-side lookup table. */
  blockedReasons:string[];
  capReferences:{scope:string;amount:number;amountText:string;currency:string;applied:boolean;amountDeducted:number;amountDeductedText:string;label:string}[];
  deductionReferences:{reason:string;amount:number;amountText:string}[];
  evidenceReferences:{policyId:string;chunkId:string;pageStart:number;pageEnd:number;label?:string}[];
};
export type CompositionPolicyView = {
  policyId:string;
  policyLabel:string;
  benefits:CompositionBenefitView[];
  subtotalsByCurrency:{currency:string;amountText:string}[];
};
/** UI-facing view of one composeClaim() result
 * (lib/claims/composition/engine.ts) -- the ONLY deterministic, code-
 * computed cross-policy total DearPolicy shows. Never recomputed or
 * re-summed in the client; every total here is copied verbatim from the
 * engine's own output. */
export type ClaimCompositionView = {
  engineVersion:string;
  calculationId:string;
  calculatedAt:string;
  policies:CompositionPolicyView[];
  alternativeGroups:{compositionGroupId:string;benefits:CompositionBenefitView[];selectedBenefitCalculationId:string|null}[];
  totalsByCurrency:{currency:string;amountText:string}[];
  excludedBenefits:CompositionBenefitView[];
  outstandingQuestions:string[];
  disclaimer:string;
};

export type FactFindingPlanView = {
  subjectId:string;subjectName?:string;
  category:"accidental_death"|"critical_illness"|"disability_tpd"|"medical_reimbursement"|"hospital_cash"|"travel"|"accidental_injury";
  label:string;
  status:"information_needed"|"evidence_needed"|"reviewer_assessment_needed"|"policy_condition_unresolved"|"ready_for_evidence_gated_estimate";
  nextQuestions:{id:string;factKey:string;text:string;type:"text"|"date"|"yes_no"|"choice";options?:string[];why:string}[];
  missingFacts:string[];staleFacts:string[];conflictingFacts:string[];uncertainFacts:string[];
  missingDocuments:string[];reviewerRequirements:string[];reportedAmountsIgnored:string[];
  readyForEvidenceGatedEstimate:boolean;blockedReasons:string[];
};


/** Gate R17 (lib/chat/answer-verification.ts): where ONE figure of an answer comes from -- the policy, the
 * person the sentence is about, the benefit (row / label), the document version (file hash), the page range
 * and the verbatim passage, and the table column where a table prints one column per person or tier. A figure
 * is grounded only by its own binding, checked against that passage of that version. */
export type FigureBinding = {
  policyId:string;
  /** The family member the sentence (or card) is about. */
  subjectId:string;
  /** The benefit's row / label, as the document prints it ("Death benefit", "Annual premium"). */
  benefit:string;
  /** The cited version's file hash (policies.file_hash). */
  documentHash:string|null;
  pageStart:number; pageEnd:number;
  /** Verbatim from the cited page(s). */
  passage:string;
  /** The column header of the person's / tier's column, where the row prints one column per person or tier. */
  column?:string|null;
  /** The wording presents a superseded version as superseded. */
  presentedAsSuperseded?:boolean;
};
/** A figure stated in one sentence of the answer, bound to its source. `sentence` is the exact sentence. */
export type BoundFigure = FigureBinding & { sentence:string; value:number; currency:string };
export type FigurePeriod = "day"|"week"|"month"|"quarter"|"half_year"|"year"|"event"|"lifetime";
/** One operand of a computation: a figure grounded by its own binding, an explicitly attributed figure from the
 * household's own message (never a policy figure), or (explicitly) another computation record. */
export type ComputationOperand = {
  value:number; currency:string; period:FigurePeriod|null;
  /** What the figure is: a premium, a benefit / sum insured / limit, or the household's own figure. */
  role:"premium"|"benefit"|"user";
  binding?:FigureBinding;
  user?:boolean;
  computation?:ComputationRecord;
};
/** An explicit record of how a computed figure (total, monthly restatement, multiple, difference) was worked out.
 * The gate recomputes it; words like "total" or "about" prove nothing. */
export type ComputationRecord = {
  /** The exact sentence that states the result (empty for a nested operand record). */
  sentence:string;
  result:{ value:number; currency:string };
  operation:"sum"|"product"|"difference"|"divide"|"per_period";
  operands:ComputationOperand[];
  /** product: the count; divide: the divisor; per_period: the conversion factor (12 for year <-> month). */
  factor?:number;
  fromPeriod?:FigurePeriod; toPeriod?:FigurePeriod;
  /** The period every operand is stated per (they must all share it). */
  period:FigurePeriod|null;
  currency:string;
  rounding:{ mode:"half_up"|"half_even"|"down"|"up"|"none"; precision:number };
  /** "household": operands for different people, stated as a household total. */
  scope?:"person"|"household";
};

/** Agent K (calculation contract): a benefit calculation the save-time gate re-runs step by step
 * (lib/chat/answer-verification.ts). Produced only by the conversation calculation tool through the deterministic claim calculators. */
export type CalcResultKind = "printed_limit"|"conditional_illustration"|"indicative_estimate"|"unresolved";
/** One input of a calculation. Document figures carry their own binding (row + column + person + version); the
 * household's own figures carry their words, verbatim, and are never presented as document facts. */
export type CalcOperand =
  | { id:string; source:"document"; role:"rate"|"limit"|"cap"|"day_cap"|"deductible"|"co_insurance"|"co_insurance_cap"|"sum_insured"|"percent";
      label:string; unit:"money"|"percent"|"count"; value:number; currency:string|null; period:string|null;
      row:string; column:string|null; binding:FigureBinding }
  | { id:string; source:"household"; role:"bill"|"admission"|"discharge"|"days"|"amount"|"count"|"other";
      label:string; unit:"money"|"count"|"datetime"|"date"; value:number|string; currency:string|null;
      /** The household's own words, quoted verbatim from their messages. */
      attribution:string }
  | { id:string; source:"assumption"; role:"admission"|"discharge"|"days"|"bill"|"amount"|"count"|"other";
      label:string; unit:"money"|"count"|"datetime"|"date"; value:number|string; currency:string|null;
      /** A what-if the household asked about, in their words ("if he stays 5 nights"). */
      attribution:string };
/** One eligibility condition of the benefit, with what settles it. */
export type CalcCondition = {
  id:string; kind:"day_count_rule"|"waiting_period"|"minimum_stay"|"day_cap"|"exclusion"|"definition"|"eligibility"|"deduction_order"|"currency";
  text:string; status:"established"|"unresolved"|"not_applicable";
  /** How it is settled: "document" (a passage of the version used), "household" (their words), "derived" (worked out
   * from the operands, e.g. a stay's length), "absent" (the stored document prints no such condition). */
  basis:"document"|"household"|"derived"|"absent"|"assumption"|"none";
  passage?:{ policyId:string; pageStart:number; pageEnd:number; text:string }|null;
  householdWords?:string|null;
  /** What would settle it, in the household's terms ("Jun Hao's admission and discharge dates and times"). */
  needs?:string|null;
};
/** One recomputable step. Inputs name operand ids or earlier step ids; values are integer minor units for money,
 * whole numbers for counts, ppm for percentages. */
export type CalcStep =
  | { id:string; op:"day_count"; rule:"first_full_day"|"completed_24h"|"completed_24h_remainder"|"per_night"|"calendar_day_inclusive"; inputs:[string,string]; out:number;
      /** completed_24h_remainder: the remaining hours that count as one more day, as the wording states them. */
      remainderHours?:number;
      /** Exceptions the wording states for the admission / discharge day ("counts as a full day if before 12:00 noon"). */
      /** Round 8e: "before" / "after" exclude the stated time; "on_or_before" / "on_or_after" include it. */
      edges?:{ edge:"admission"|"discharge"; when:"before"|"on_or_before"|"after"|"on_or_after"; minutes:number }[] }
  | { id:string; op:"days_after_waiting"; inputs:[string]; waitingDays:number; out:number }
  | { id:string; op:"min_count"; inputs:string[]; out:number }
  | { id:string; op:"multiply"; inputs:[string,string]; out:number }
  | { id:string; op:"min"; inputs:string[]; out:number }
  | { id:string; op:"deductible"; inputs:[string,string]; out:number }
  | { id:string; op:"co_insurance"; inputs:[string,string]|[string,string,string]; out:number }
  | { id:string; op:"percent_of"; inputs:[string,string]; out:number };
export type CalculationRecord = {
  /** The exact sentence that states the result. */
  sentence:string;
  id:string;
  calculator:"hospital_cash"|"bill_reimbursement"|"lump_sum";
  kind:"conditional_illustration"|"indicative_estimate";
  subjectId:string; policyId:string; benefit:string; documentHash:string|null;
  operands:CalcOperand[]; steps:CalcStep[];
  result:{ value:number; currency:string };
  currency:string;
  rounding:{ mode:"half_up"|"half_even"|"down"|"up"; precision:number; source:"policy"|"default" };
  conditions:CalcCondition[];
  /** Evidence the existing claim workflow will still need (reviewed bill, discharge summary...): kept, never waived. */
  evidenceRequirements:string[];
  /** conditional_illustration: the what-if, in the household's words. indicative_estimate (integration r6): the stated
   * assumption that earlier use of a capped allowance leaves what this stay needs available -- the sentence must say it. */
  assumption?:string|null;
  /** Shown instead of the sentence if the record fails verification: the specific unresolved requirement (no figures). */
  unresolvedText:string;
  /** A1 (r6): the rate's unit terms (unit, duration rule, caps with reset periods and how earlier use is settled), each
   * with its source span; re-checked by the save-time gate (lib/claims/unit-terms.ts checkUnitTerms). Absent on
   * records made before r6. */
  unitTerms?:UnitTerms;
};

export type ChatAnswer = {
  mode:"answer"|"fact_finding"|"claim_assessment";
  summary:string;
  details:string[];
  claimItems:ClaimItem[];
  nextSteps:string[];
  confidence:"strong_match"|"partial_match"|"insufficient_evidence"|null;
  citations:ChatCitation[];
  disclaimer:string;
  claimSessionId:string|null;
  questions:ChatQuestion[];
  knownFacts:string[];
  missingFacts:string[];
  potentialPayoutTotals?:PotentialPayoutTotal[];
  /** Policy-stated coverage limits: typed, cited, currency-verified, and
   * structurally separate from any claim estimate (never totalled). */
  policyStatedLimits?:PolicyStatedLimit[];
  /** Additive (V1.1): set only by lib/chat/policy-answer.ts. The answer is
   * made solely of policy facts verified against their cited passages, and
   * verifiedPolicyFigures lists every money figure its text may show. The
   * live monetary boundary honours it only for a non-claim turn with no
   * claim items; any other figure is still withheld. */
  verifiedPolicyFactsOnly?:boolean;
  verifiedPolicyFigures?:string[];
  /** Deterministic fact-finding plan per family member and claim category
   * (lib/claims/fact-finding.ts). Never carries an amount. */
  factFinding?:FactFindingPlanView[];
  /** Set when a saved answer is re-served after a policy it relied on was
   * deleted (lib/chat/stale-answers.ts): it no longer describes cover. */
  invalidated?:{reason:"policy_deleted"};
  /** "preliminary": no reviewed claim evidence, so no event amount at all.
   * "indicative": an amount produced by the evidence-gated deterministic
   * composition path. Absent for ordinary policy questions. */
  assessmentKind?:"preliminary"|"indicative";
  scenarioClassifications?:{subjectName:string;label:string;family:string;traits:string[]}[];
  resolvedFamilyMemberId?:string;
  personContextMessage?:string;
  personContextRecordedAt?:string;
  personCandidates?:{id:string;label:string}[];
  conversationId?:string;
  conversationRevision?:number;
  /** Specific, evidence-derived reasons the final settled figure could differ
   * from the calculated potential amount. Never a generic caveat. */
  payoutQualifiers?:string[];
  reviewCoverage?:AnswerReviewCoverage;
  policyReview?:{id:string;ownerId:string;ownerName:string;policyName:string;status:string;documentCount:number;coverage?:ReviewCoverage;currentness?:PolicyCurrentness}[];
  portfolioItems?:{id:string;ownerName:string;policyName:string;confirmed:boolean;currentness?:PolicyCurrentness;coverages:{category:string;amount:number|null;currency:string|null;productName:string|null}[]}[];

  /** Deterministic, code-computed claim-composition result for this turn
   * (never present unless lib/claims/composition/engine.ts actually ran).
   * See ClaimCompositionView's own doc comment. */
  composition?:ClaimCompositionView|null;
  /** Gate R17: per-sentence binding of every figure the answer's text states (lib/chat/answer-verification.ts). */
  figureBindings?:BoundFigure[];
  /** Gate R17: explicit records of every computed figure the answer's text states. */
  computations?:ComputationRecord[];
  /** Agent K: verified benefit calculations (illustrations / indicative estimates), one per stated result. */
  calculations?:CalculationRecord[];
};
