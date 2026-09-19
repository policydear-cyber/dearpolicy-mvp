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
export type ChatCitation = { chunkId:string; policyId:string; policyName:string; insurer?:string; pageStart:number; pageEnd:number; documentRole?:string|null; personalEvidence?:boolean; evidenceLabel?:string };
export type ClaimItem = {
  title:string;
  status:"likely_applicable"|"potentially_applicable"|"not_applicable"|"needs_document";
  amountText:string|null;
  /** Human-readable distinction between a calculated payout and a schedule
   * amount whose payout rule has not yet been verified. */
  amountLabel?:"Potential payout"|"Potential reimbursement"|"Confirmed cover amount — payout rule not yet verified"
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
  portfolioItems?:{id:string;ownerName:string;policyName:string;confirmed:boolean;currentness?:PolicyCurrentness;coverages:{category:string;amount:number|null;currency:string;productName:string|null}[]}[];
};
