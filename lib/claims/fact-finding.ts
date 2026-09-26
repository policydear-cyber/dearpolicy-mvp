/**
 * Deterministic fact-finding for a preliminary claim assessment (Phase 2).
 *
 * For each claim category DearPolicy supports -- accidental death, critical
 * illness, disability/TPD, medical reimbursement, hospital cash and travel --
 * this module declares the required and optional facts, the documents and
 * reviewer decisions the insurer-facing assessment needs, the order in which
 * facts are asked (one small, coherent group at a time), which answers go
 * stale when an earlier answer changes, and exactly when the evidence-gated
 * calculator may run or must stay blocked.
 *
 * It never produces an amount. A figure the family states ("the bill was
 * S$4,000", "I should get S$100,000") is recorded as reported and never used
 * as coverage or as a calculation input. The only path to an event-specific
 * figure remains the evidence-gated deterministic engine (lib/claims/*),
 * which runs only when this plan reports `readyForEvidenceGatedEstimate`.
 */
import type { SubjectFacts } from "@/lib/chat/types";

export type FactFindingCategory =
  | "accidental_death" | "critical_illness" | "disability_tpd" | "medical_reimbursement" | "hospital_cash" | "travel";

export type FactFindingStatus =
  | "information_needed" | "evidence_needed" | "reviewer_assessment_needed" | "policy_condition_unresolved" | "ready_for_evidence_gated_estimate";

type FactSpec = {
  key: string;
  /** Other keys the conversation model may have used for the same fact. */
  aliases: string[];
  question: string;
  type: "text" | "date" | "yes_no" | "choice";
  options?: string[];
  why: string;
  /** Facts asked together, in ascending group order. */
  group: number;
  required: boolean;
  /** When any of these facts changes after this one was answered, this
   * answer is stale and is asked again. */
  dependsOn?: string[];
  /** Only asked when this predicate holds on the current facts. */
  askWhen?: (facts: Readonly<Record<string, unknown>>) => boolean;
};
type DocumentSpec = { type: string; label: string; required: boolean; when?: (facts: Readonly<Record<string, unknown>>) => boolean };
type ReviewerSpec = { key: string; label: string };
export type CategorySpec = {
  category: FactFindingCategory;
  label: string;
  facts: FactSpec[];
  documents: DocumentSpec[];
  reviewers: ReviewerSpec[];
};

const DATE_WHY = "It decides which policy version applies and whether waiting periods or cover dates are met.";
export const FACT_FINDING_SPECS: Record<FactFindingCategory, CategorySpec> = {
  accidental_death: {
    category: "accidental_death", label: "Accidental death",
    facts: [
      { key: "deathDate", aliases: ["dateOfDeath", "death_date"], question: "On what date did they pass away?", type: "date", why: DATE_WHY, group: 1, required: true },
      { key: "causeOfDeath", aliases: ["cause", "cause_of_death"], question: "What does the death certificate give as the cause of death?", type: "text", why: "An accidental death benefit depends on the cause matching the policy's own definition.", group: 2, required: true, dependsOn: ["deathDate"] },
      { key: "accidentCircumstances", aliases: ["howItHappened", "accidentDescription", "circumstances"], question: "Briefly, how did it happen?", type: "text", why: "Exclusions (for example hazardous activities) depend on the circumstances.", group: 2, required: true, dependsOn: ["causeOfDeath"] },
      { key: "eventLocation", aliases: ["location", "country"], question: "Where did it happen?", type: "text", why: "Some policies limit cover by country or activity.", group: 3, required: false },
    ],
    documents: [
      { type: "death_certificate", label: "Death certificate", required: true },
      { type: "police_or_coroner_report", label: "Police or coroner's report", required: true },
      { type: "policy_schedule", label: "Policy schedule or certificate showing the cover", required: false },
    ],
    reviewers: [{ key: "cause_definition_match", label: "A reviewer checks the cause of death against the policy's accidental-death definition" }],
  },
  critical_illness: {
    category: "critical_illness", label: "Critical illness",
    facts: [
      { key: "diagnosis", aliases: ["condition", "illness"], question: "What exactly was diagnosed (the name of the condition and, if known, its stage)?", type: "text", why: "Critical-illness benefits pay only for conditions that meet the policy's own definition and severity.", group: 1, required: true },
      { key: "diagnosisDate", aliases: ["dateOfDiagnosis", "diagnosis_date"], question: "On what date was it diagnosed?", type: "date", why: DATE_WHY, group: 1, required: true },
      { key: "diagnosedBySpecialist", aliases: ["specialistDiagnosis"], question: "Was the diagnosis made by a specialist (for example an oncologist or cardiologist)?", type: "yes_no", why: "Most definitions require a specialist's diagnosis.", group: 2, required: true, dependsOn: ["diagnosis"] },
      { key: "survivedSurvivalPeriod", aliases: ["alive", "stillAlive"], question: "Is the insured person still alive today?", type: "yes_no", why: "Many plans require the insured to survive a period after diagnosis.", group: 3, required: true, dependsOn: ["diagnosisDate"] },
    ],
    documents: [
      { type: "specialist_report", label: "Specialist's diagnosis report", required: true },
      { type: "histopathology_or_test_results", label: "Histopathology or test results confirming the diagnosis", required: true },
    ],
    reviewers: [{ key: "ci_definition_match", label: "A reviewer checks the diagnosis against the policy's critical-illness definition" }],
  },
  disability_tpd: {
    category: "disability_tpd", label: "Disability / total and permanent disability",
    facts: [
      { key: "disabilityCause", aliases: ["injury", "condition"], question: "What illness or injury caused the disability?", type: "text", why: "Disability benefits depend on the cause and on the policy's disability definition.", group: 1, required: true },
      { key: "disabilityDate", aliases: ["eventDate", "dateOfDisability"], question: "From what date has the person been unable to work?", type: "date", why: "Waiting and deferred periods run from this date.", group: 1, required: true },
      { key: "unableToWork", aliases: ["cannotWork"], question: "Is the person currently unable to do any work, or only their own occupation?", type: "choice", options: ["Any work", "Own occupation only", "Can still work"], why: "Policies define total disability as unable to do any work or their own work.", group: 2, required: true, dependsOn: ["disabilityDate"] },
      { key: "disabilityContinuousMonths", aliases: ["monthsDisabled"], question: "For how many months has this continued without a break?", type: "text", why: "TPD usually requires a continuous period (often six months) before a claim is admitted.", group: 2, required: true, dependsOn: ["disabilityDate"] },
    ],
    documents: [
      { type: "medical_assessment", label: "Doctor's or specialist's disability assessment", required: true },
      { type: "employer_letter", label: "Employer's letter on the last day of work", required: false },
    ],
    reviewers: [{ key: "disability_definition_match", label: "A reviewer checks the assessment against the policy's disability definition" }],
  },
  medical_reimbursement: {
    category: "medical_reimbursement", label: "Medical reimbursement",
    facts: [
      { key: "admissionDate", aliases: ["hospitalAdmissionDate"], question: "On what date were they admitted?", type: "date", why: DATE_WHY, group: 1, required: true },
      { key: "dischargeDate", aliases: ["hospitalDischargeDate"], question: "On what date were they discharged (or are they still in hospital)?", type: "date", why: "Reimbursement is assessed on the completed stay's itemised bill.", group: 1, required: true, dependsOn: ["admissionDate"] },
      { key: "hospitalName", aliases: ["hospital"], question: "Which hospital, and was it a panel/network hospital for this plan?", type: "text", why: "Non-panel treatment can be reimbursed at a lower rate.", group: 2, required: true },
      { key: "otherInsurancePaid", aliases: ["thirdPartyPaid", "employerPaid"], question: "Has any other insurer or the employer already paid part of the bill?", type: "yes_no", why: "Reimbursement is coordinated so the same bill is not paid twice.", group: 3, required: true },
    ],
    documents: [
      { type: "itemised_bill", label: "Itemised hospital bill", required: true },
      { type: "discharge_summary", label: "Discharge summary", required: true },
      { type: "payment_receipts", label: "Receipts, including any other insurer's settlement", required: false },
    ],
    reviewers: [{ key: "bill_review", label: "A reviewer checks the itemised bill against the benefit's eligible categories" }],
  },
  hospital_cash: {
    category: "hospital_cash", label: "Hospital cash",
    facts: [
      { key: "admissionDate", aliases: ["hospitalAdmissionDate"], question: "On what date and time were they admitted?", type: "date", why: DATE_WHY, group: 1, required: true },
      { key: "dischargeDate", aliases: ["hospitalDischargeDate"], question: "On what date and time were they discharged?", type: "date", why: "Hospital cash is counted per day of a completed stay, using the policy's own day-count rule.", group: 1, required: true, dependsOn: ["admissionDate"] },
      { key: "icuStay", aliases: ["icu"], question: "Was any part of the stay in intensive care?", type: "yes_no", why: "ICU days can be paid at a different rate.", group: 2, required: false },
    ],
    documents: [{ type: "discharge_summary", label: "Discharge summary showing admission and discharge times", required: true }],
    reviewers: [],
  },
  travel: {
    category: "travel", label: "Travel",
    facts: [
      { key: "tripStartDate", aliases: ["departureDate"], question: "On what dates did the trip start and end?", type: "date", why: "Travel cover applies only to events during the insured trip.", group: 1, required: true },
      { key: "tripEndDate", aliases: ["returnDate"], question: "On what date did (or will) the trip end?", type: "date", why: "Travel cover applies only to events during the insured trip.", group: 1, required: true },
      { key: "travelEventType", aliases: ["travelIncident"], question: "What happened on the trip?", type: "choice", options: ["Flight delay", "Medical treatment abroad", "Accident or death", "Lost or damaged baggage", "Other"], why: "Each travel benefit has its own conditions.", group: 2, required: true },
      { key: "eventDate", aliases: ["incidentDate"], question: "On what date did it happen?", type: "date", why: "It must fall within the trip dates.", group: 2, required: true, dependsOn: ["tripStartDate", "tripEndDate"] },
      { key: "delayHours", aliases: ["flightDelayHours"], question: "How many hours was the flight delayed, according to the airline?", type: "text", why: "Delay benefits start only after the policy's minimum delay.", group: 3, required: true, askWhen: (f) => /delay/i.test(String(f.travelEventType ?? "")) },
    ],
    documents: [
      { type: "travel_certificate", label: "Travel insurance certificate for the trip", required: true },
      { type: "incident_proof", label: "Airline delay letter, police report or medical report for the incident", required: true },
    ],
    reviewers: [{ key: "travel_match", label: "A reviewer checks the incident evidence against the travel policy's wording" }],
  },
};

/** Keys a family member may use to state what they expect to be paid. They
 * are recorded as reported and never used by any calculation. */
const REPORTED_AMOUNT_KEY = /(?:payout|settlement|compensation)|(?:claim|expected|desired|benefit)Amount$|^amountExpected$|(?:Bill|Cost|Expense|Paid|Amount)$/i;
const UNCERTAIN_VALUE = /^(?:unknown|not sure|unsure|don'?t know|do not know|maybe|possibly|perhaps|tbc|to be confirmed)\b|\?\s*$/i;

export type FactFindingQuestion = { id: string; factKey: string; text: string; type: "text" | "date" | "yes_no" | "choice"; options?: string[]; why: string };
export type FactFindingPlan = {
  subjectId: string;
  category: FactFindingCategory;
  label: string;
  status: FactFindingStatus;
  /** One small, coherent group of questions -- never facts already known and current. */
  nextQuestions: FactFindingQuestion[];
  missingFacts: string[];
  staleFacts: string[];
  conflictingFacts: string[];
  uncertainFacts: string[];
  missingDocuments: string[];
  reviewerRequirements: string[];
  /** Figures the family stated; recorded, never used as coverage or input. */
  reportedAmountsIgnored: string[];
  readyForEvidenceGatedEstimate: boolean;
  blockedReasons: string[];
};

export type FactFindingInput = {
  subjectId: string;
  category: FactFindingCategory;
  facts: SubjectFacts;
  /** Evidence documents on file for this claim, by document type, and
   * whether each has been reviewed (clean scan, verified reading). */
  documents?: { type: string; reviewed: boolean }[];
  /** Reviewer decisions on file: key -> result. Only "matches" satisfies. */
  reviewerDecisions?: Record<string, "matches" | "does_not_match" | "needs_more_information" | undefined>;
  /** Policy conditions (waiting periods, exclusions) the engine could not resolve. */
  unresolvedPolicyConditions?: string[];
};

function resolve(facts: SubjectFacts, spec: FactSpec) {
  const entries = [spec.key, ...spec.aliases].map((k) => ({ key: k, fact: facts[k] })).filter((e) => e.fact);
  const known = entries.filter((e) => e.fact!.state === "known" && e.fact!.value !== null && e.fact!.value !== "");
  const distinct = [...new Set(known.map((e) => JSON.stringify(e.fact!.value)))];
  const latest = known.sort((a, b) => (a.fact!.recordedAt < b.fact!.recordedAt ? 1 : -1))[0];
  return {
    known: known.length > 0,
    value: latest?.fact!.value ?? null,
    recordedAt: latest?.fact!.recordedAt ?? null,
    conflict: distinct.length > 1,
    uncertain: entries.some((e) => e.fact!.state === "unknown" || e.fact!.state === "pending" || (typeof e.fact!.value === "string" && UNCERTAIN_VALUE.test(e.fact!.value.trim()))),
  };
}

export function planFactFinding(input: FactFindingInput): FactFindingPlan {
  const spec = FACT_FINDING_SPECS[input.category];
  const resolved = new Map(spec.facts.map((f) => [f.key, resolve(input.facts, f)]));
  const values: Record<string, unknown> = Object.fromEntries([...resolved].map(([k, r]) => [k, r.value]));
  const staleFacts: string[] = [], conflictingFacts: string[] = [], uncertainFacts: string[] = [], missing: FactSpec[] = [];
  for (const f of spec.facts) {
    if (f.askWhen && !f.askWhen(values)) continue;
    const r = resolved.get(f.key)!;
    const stale = r.known && (f.dependsOn ?? []).some((dep) => {
      const d = resolved.get(dep);
      return !!d?.recordedAt && !!r.recordedAt && d.recordedAt > r.recordedAt;
    });
    if (r.conflict) conflictingFacts.push(f.key);
    if (stale) staleFacts.push(f.key);
    if (r.uncertain && !r.known) uncertainFacts.push(f.key);
    if (!r.known || r.conflict || stale) missing.push(f);
  }
  const requiredMissing = missing.filter((f) => f.required);
  // One coherent group at a time: the lowest group that still has something to ask.
  const nextGroup = requiredMissing.length ? Math.min(...requiredMissing.map((f) => f.group)) : missing.length ? Math.min(...missing.map((f) => f.group)) : null;
  const nextQuestions: FactFindingQuestion[] = nextGroup == null ? [] : missing.filter((f) => f.group === nextGroup).slice(0, 3).map((f) => ({
    id: `ff-${input.category}-${f.key}`, factKey: f.key, type: f.type, ...(f.options ? { options: f.options } : {}), why: f.why,
    text: conflictingFacts.includes(f.key) ? `You gave two different answers earlier. ${f.question}`
      : staleFacts.includes(f.key) ? `An earlier answer changed, so please confirm again: ${f.question}` : f.question,
  }));

  const docs = input.documents ?? [];
  const missingDocuments = spec.documents.filter((d) => d.required && (!d.when || d.when(values)) && !docs.some((x) => x.type === d.type && x.reviewed)).map((d) => d.label);
  const decisions = input.reviewerDecisions ?? {};
  const reviewerRequirements = spec.reviewers.filter((r) => decisions[r.key] !== "matches").map((r) => r.label);
  const specKeys = new Set(spec.facts.flatMap((f) => [f.key, ...f.aliases]));
  const reportedAmountsIgnored = Object.entries(input.facts).filter(([k, f]) => !specKeys.has(k) && REPORTED_AMOUNT_KEY.test(k) && f.state === "known" && f.value != null)
    .map(([k]) => k);
  const unresolved = input.unresolvedPolicyConditions ?? [];

  const blockedReasons: string[] = [];
  if (requiredMissing.length) blockedReasons.push("Required facts are missing, uncertain, conflicting or out of date.");
  if (missingDocuments.length) blockedReasons.push("Required claim documents have not been uploaded and reviewed.");
  if (reviewerRequirements.length) blockedReasons.push("A reviewer decision against the policy wording is still needed.");
  if (unresolved.length) blockedReasons.push("Policy conditions are still unresolved.");
  if (Object.values(decisions).some((d) => d === "does_not_match")) blockedReasons.push("A reviewer found the evidence does not meet the policy definition.");

  const status: FactFindingStatus = requiredMissing.length ? "information_needed"
    : missingDocuments.length ? "evidence_needed"
    : reviewerRequirements.length ? "reviewer_assessment_needed"
    : unresolved.length ? "policy_condition_unresolved"
    : blockedReasons.length ? "reviewer_assessment_needed"
    : "ready_for_evidence_gated_estimate";

  return {
    subjectId: input.subjectId, category: input.category, label: spec.label, status, nextQuestions,
    missingFacts: requiredMissing.map((f) => f.key), staleFacts, conflictingFacts, uncertainFacts,
    missingDocuments, reviewerRequirements, reportedAmountsIgnored,
    readyForEvidenceGatedEstimate: status === "ready_for_evidence_gated_estimate", blockedReasons,
  };
}

/** Which categories a reported situation opens, from the conversation's own
 * scenario traits and facts. Deterministic; nothing is inferred from a
 * model's opinion of eligibility. */
export function categoriesFor(traits: ReadonlySet<string>, facts: SubjectFacts): FactFindingCategory[] {
  const out: FactFindingCategory[] = [];
  const has = (k: string) => facts[k]?.state === "known" && facts[k].value !== null && facts[k].value !== false;
  if (traits.has("death") && (traits.has("accident") || traits.has("external") || traits.has("violent"))) out.push("accidental_death");
  else if (traits.has("death") || has("death")) out.push("accidental_death");
  if (traits.has("diagnosis") || (traits.has("illness") && has("diagnosis"))) out.push("critical_illness");
  if (traits.has("disability")) out.push("disability_tpd");
  if (traits.has("hospitalisation") || has("hospitalised") || has("admissionDate")) out.push("medical_reimbursement", "hospital_cash");
  if (traits.has("travel") || has("tripStartDate") || has("flightDelayHours") || has("delayHours")) out.push("travel");
  return [...new Set(out)];
}
