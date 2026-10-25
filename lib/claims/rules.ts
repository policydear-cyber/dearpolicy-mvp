import { formatMoney } from "@/lib/format/currency";
import { checkNonTravelCurrency } from "./currency-evidence";
import { canonicalProduct, coverageByProduct, productFromCategory, type OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimAssessmentItem, ClaimEvidence, ClaimFacts, ClaimQuestion } from "./types";
import type { DeathEvidenceGap, DeathRuleEvidence } from "./death-evidence";
import { calculateDeathBenefit, type DeathBenefitEvidenceRef, type DeathBenefitFormula } from "./calculators/death-benefit";
import { calculateAccidentalDeath } from "./calculators/accidental-death";
import type { CauseDefinitionMatch } from "./calculators/evidence";
import { currentDefinition, selectApplicableDecision } from "./evidence/decision-selection";
import type { CIEvidenceGap, CIRuleEvidence } from "./ci-evidence";
import { assessCriticalIllness, nextCIQuestion } from "./ci-rules";
import { assessMedicalClaim, nextMedicalQuestion, type MedicalRuleEvidence } from "./medical-rules";
import { assessDisabilityClaim, nextDisabilityQuestion, type DisabilityRuleSet } from "./disability-rules";
import { assessTravelClaim, nextTravelQuestion, type TravelRuleSet } from "./travel-rules";
import { withTableBenefits, NO_TABLE, type ClaimTable } from "./table-benefits";

function toEvidenceRef(c: ClaimEvidence): DeathBenefitEvidenceRef {
  return { chunkId: c.chunkId, policyId: c.policyId, pageStart: c.pageStart, pageEnd: c.pageEnd, label: c.evidenceLabel };
}
/** The one applicable, already-reviewed match between the official
 * cause-of-death evidence and THIS SPECIFIC policy's own accidental-death
 * definition, or `null` when none has been reviewed for this exact family
 * member/claim/contract/coverage yet. A cause can satisfy one policy's
 * definition and not another's, so this is a per-policy lookup rather than
 * a single global flag -- and `calculateAccidentalDeath()` independently
 * re-validates every field of whatever this returns, so a bug here can
 * never by itself unlock an amount for the wrong policy or person. None of
 * the following, alone or together, can ever produce a match: the family
 * saying they possess a document (`causeOfDeathDocumentAvailable`), a chat
 * answer of "yes"/"uploaded"/any other free text, or DearPolicy having
 * merely reviewed a document without an explicitly confirmed match --
 * `causeDefinitionMatches` is never populated from chat text or AI output
 * in this slice, since no document-review pipeline exists yet to do so. */
function applicableCauseDefinitionMatch(facts: ClaimFacts, coverage: OwnedCoverage, sessionId: string | null, currentDefinition: unknown): CauseDefinitionMatch | null {
  if (sessionId == null) return null;
  // Every active decision for this exact scope, one per evidence document,
  // reduced to a single one deterministically and fail-closed -- see
  // lib/claims/evidence/decision-selection.ts.
  return selectApplicableDecision(facts.causeDefinitionMatches.filter(m =>
    m.contractId === coverage.policyId &&
    m.familyMemberId === coverage.familyMemberId &&
    m.claimEventId === sessionId &&
    (m.coverageId == null || m.coverageId === coverage.id),
  ), currentDefinition);
}

function hasProduct(coverages: OwnedCoverage[], product: string) {
  return coverageByProduct(coverages, product).length > 0;
}

function bestCoverage(coverages: OwnedCoverage[], product: string, category?: string) {
  const rows = coverageByProduct(coverages, product);
  return (category ? rows.find((r) => r.category === category) : rows[0]) ?? rows[0] ?? null;
}

function hasAccidentCover(coverages: OwnedCoverage[]) {
  return coverages.some((c) => c.category === "Personal Accident") || hasProduct(coverages, "group personal accident");
}

function hasReimbursementMedicalCover(coverages: OwnedCoverage[]) {
  return coverages.some((c) => ["Hospitalisation", "Outpatient"].includes(c.category));
}

function dateBefore(eventDate: string | null, effectiveDate: string | null) {
  if (!eventDate || !effectiveDate) return null;
  const a = Date.parse(eventDate), b = Date.parse(effectiveDate);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a < b;
}

function dateIsWithinDays(eventDate: string | null, effectiveDate: string | null, days: number) {
  if (!eventDate || !effectiveDate) return null;
  const a = Date.parse(eventDate), b = Date.parse(effectiveDate);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a - b < days * 86_400_000;
}

function eventDateQuestion(facts: ClaimFacts): ClaimQuestion | null {
  const diagnosis = facts.eventType === "diagnosis";
  if (diagnosis && !facts.diagnosisDate && !facts.uncertainFacts.includes("diagnosis_date")) return { id:"diagnosis_date", text:"When was the diagnosis confirmed? Give the date, or say “not sure” if you need to check the report.", type:"date", why:"The diagnosis date can affect waiting periods and claim timing." };
  if (facts.eventType === "death" && !facts.deathDate && !facts.eventDate && !facts.uncertainFacts.includes("death_date") && !facts.uncertainFacts.includes("event_date")) return { id:"death_date", text:"On what date did the death occur?", type:"date", why:"The date of death is used to check the death benefit; a preceding accident may have a different date." };
  if (!diagnosis && facts.eventType !== "death" && !facts.eventDate && !facts.uncertainFacts.includes("event_date")) return { id:"event_date", text:"When did this happen?", type:"date", why:"The event date is needed to check policy effective dates and claim timing." };
  return null;
}

/** Which categories of cover can respond to each kind of event, for any household. A life cover is kept for accidents,
 * stays and diagnoses because many life covers carry hospital cash or disability benefits; the benefit table and the
 * wording decide what actually pays. */
const EVENT_CATEGORIES: Record<string, string[]> = {
  accident: ["Personal Accident", "Death", "Total Permanent Disability", "Hospitalisation", "Outpatient", "Hospital Cash"],
  diagnosis: ["Critical Illness", "Early Critical Illness", "Death", "Hospitalisation", "Outpatient", "Disability Income", "Hospital Cash"],
  hospitalisation: ["Hospitalisation", "Outpatient", "Hospital Cash", "Personal Accident", "Death"],
  death: ["Death", "Personal Accident"],
  disability: ["Total Permanent Disability", "Death", "Personal Accident", "Disability Income"],
};
/** The key a cover is listed under: its product, or its category when it prints no product name. */
export const coverKeyOf = (c: OwnedCoverage) => canonicalProduct(c.productName) || c.category;

export function relevantOwnedProducts(facts: ClaimFacts, coverages: OwnedCoverage[]) {
  const result = new Set<string>();
  const wanted = EVENT_CATEGORIES[facts.eventType ?? ""] ?? [];
  for (const c of coverages) {
    if (!wanted.includes(c.category)) continue;
    if (facts.eventType === "death" && c.category === "Personal Accident" && facts.accidentalDeath === false) continue;
    result.add(coverKeyOf(c));
  }
  return [...result];
}

export function nextClaimQuestion(facts: ClaimFacts, coverages: OwnedCoverage[], deathRules: DeathRuleEvidence[] = [], ciRules: CIRuleEvidence[] = [], medicalRules?: MedicalRuleEvidence, disabilityRules?: DisabilityRuleSet, travelRules?: TravelRuleSet): ClaimQuestion | null {
  if (!facts.eventType) return { id:"event_type", text:"Tell me what happened. Was this an accident, a diagnosis, a hospital admission, a disability, or a death claim?", type:"choice", options:["Accident","Diagnosis","Hospital admission","Disability","Death"], why:"DearPolicy needs the event type before it can choose the relevant owned policies." };

  const dateQuestion = eventDateQuestion(facts);
  if (dateQuestion) return dateQuestion;

  if (facts.eventType === "accident") {
    if (facts.injured == null && !facts.injuries.length && !facts.fractureBodyPart && !facts.uncertainFacts.includes("injured")) return { id:"injured", text:"What injuries were diagnosed from the accident? If there were no injuries, say “none”. Mention any fracture, surgery, or permanent loss of function.", type:"text", why:"Different accident benefits respond to different injuries." };
    if ((facts.injuries.some((x)=>/fractur/i.test(x)) || facts.fractureBodyPart) && !facts.fractureBodyPart && !facts.uncertainFacts.includes("fracture_body_part")) return { id:"fracture_body_part", text:"Which bone or body part was fractured?", type:"text", why:"The Personal Accident fracture benefit pays different percentages depending on the body part." };
    if (hasAccidentCover(coverages) && facts.ambulanceUsed == null && !facts.uncertainFacts.includes("ambulance_used")) return { id:"ambulance_used", text:"Did you use an ambulance because of the accident? If yes, include the ambulance charge if you know it.", type:"yes_no", options:["Yes","No"], why:"Some accident covers repay an ambulance bill." };
    if (hasAccidentCover(coverages) && facts.ambulanceUsed === true && facts.ambulanceBill == null && !facts.uncertainFacts.includes("ambulance_bill")) return { id:"ambulance_bill", text:"How much was the ambulance bill?", type:"money", why:"An ambulance benefit usually repays the bill, so the bill amount matters." };
    if (coverages.length > 0 && facts.hospitalised == null && !facts.uncertainFacts.includes("hospitalised")) return { id:"hospitalised", text:"Were you admitted to hospital? If yes, tell me how many nights you stayed.", type:"yes_no", options:["Yes","No"], why:"Hospital-related benefits depend on whether you were admitted and, for some benefits, the length of stay." };
    if (facts.hospitalised === true && facts.hospitalNights == null && !facts.uncertainFacts.includes("hospital_nights")) return { id:"hospital_nights", text:"How many nights were you admitted?", type:"text", why:"Hospital cash and other stay benefits depend on how many nights you were admitted." };
    if (hasReimbursementMedicalCover(coverages) && facts.hospitalised === true && facts.hospitalBill == null && !facts.uncertainFacts.includes("hospital_bill")) return { id:"hospital_bill", text:"What was the total hospital or medical bill? You can upload the bill later if that is easier.", type:"money", why:"Reimbursement-type medical cover depends on the actual eligible expense." };
    if (hasReimbursementMedicalCover(coverages) && facts.hospitalBill != null && facts.outOfPocket == null && !facts.uncertainFacts.includes("out_of_pocket")) return { id:"out_of_pocket", text:"How much did you personally have to pay after subsidies, MediSave, employer benefits, or other insurance?", type:"money", why:"This helps avoid treating a policy limit as money you actually spent or can be reimbursed twice." };
    if (hasAccidentCover(coverages) && facts.injured !== false && facts.permanentImpairment == null && !facts.uncertainFacts.includes("permanent_impairment")) return { id:"permanent_impairment", text:"Has a doctor said any injury may cause permanent loss of function, amputation, or permanent disability?", type:"yes_no", options:["Yes","No","Not sure"], why:"A permanent injury may trigger much larger Personal Accident or TPD benefits." };
    if (/motorcycle|motorbike/i.test(facts.accidentType ?? "") && hasAccidentCover(coverages) && facts.competitiveRacing == null && !facts.uncertainFacts.includes("competitive_racing")) return { id:"competitive_racing", text:"Was the accident during competitive racing or a timed competition?", type:"yes_no", options:["Yes","No"], why:"Many accident wordings exclude competitive racing, so this can change what pays." };
  }

  if (facts.eventType === "diagnosis") {
    if (!facts.diagnosis && !facts.uncertainFacts.includes("diagnosis")) return { id:"diagnosis", text:"What was the exact diagnosis? Include the cancer type/stage or medical condition if you know it.", type:"text", why:"Critical illness benefits depend on the specific diagnosis and policy definition." };
    const ciQuestion = nextCIQuestion(facts, ciRules);
    if (ciQuestion) return ciQuestion;
    if (coverages.length > 0 && facts.hospitalised == null && !facts.uncertainFacts.includes("hospitalised")) return { id:"hospitalised", text:"Were you admitted to hospital because of this diagnosis? If yes, how many nights?", type:"yes_no", options:["Yes","No"], why:"Your other owned policies may contain hospital cash or medical reimbursement benefits in addition to a diagnosis benefit." };
    if (facts.hospitalised === true && facts.hospitalNights == null && !facts.uncertainFacts.includes("hospital_nights")) return { id:"hospital_nights", text:"How many nights were you admitted?", type:"text", why:"Hospital cash depends on the length of stay." };
    if (hasReimbursementMedicalCover(coverages) && facts.hospitalised === true && facts.hospitalBill == null && !facts.uncertainFacts.includes("hospital_bill")) return { id:"hospital_bill", text:"What was the total hospital or treatment bill?", type:"money", why:"Medical reimbursement benefits depend on actual eligible expenses." };
    if (hasReimbursementMedicalCover(coverages) && facts.hospitalBill != null && facts.outOfPocket == null && !facts.uncertainFacts.includes("out_of_pocket")) return { id:"out_of_pocket", text:"How much did you personally pay after subsidies, MediSave and any other insurance?", type:"money", why:"This helps DearPolicy assess reimbursement-type benefits accurately." };
  }

  if (facts.eventType === "hospitalisation") {
    if (!facts.diagnosis && !facts.injuries.length && !facts.uncertainFacts.includes("diagnosis")) return { id:"diagnosis", text:"What were you admitted for? Tell me the diagnosis or injury.", type:"text", why:"The reason for admission determines which owned benefits may respond." };
    const medicalQuestion = nextMedicalQuestion(facts, medicalRules);
    if (medicalQuestion) return medicalQuestion;
    // Additive: the travel trip-date safety gate (lib/claims/travel-rules.ts's
    // own doc comment) -- only asked when this family member's Travel cover
    // actually has an evidenced Overseas Medical Expenses/Accidental Death
    // clause to check it against.
    const travelQuestionForMedical = nextTravelQuestion(facts, travelRules);
    if (travelQuestionForMedical) return travelQuestionForMedical;
    if (facts.hospitalNights == null && !facts.uncertainFacts.includes("hospital_nights")) return { id:"hospital_nights", text:"How many nights were you admitted?", type:"text", why:"Hospital cash and some inpatient benefits depend on the length of stay." };
    if (hasReimbursementMedicalCover(coverages) && facts.hospitalBill == null && !facts.uncertainFacts.includes("hospital_bill")) return { id:"hospital_bill", text:"What was the total hospital bill?", type:"money", why:"Reimbursement benefits depend on the actual eligible expense." };
    if (hasReimbursementMedicalCover(coverages) && facts.hospitalBill != null && facts.outOfPocket == null && !facts.uncertainFacts.includes("out_of_pocket")) return { id:"out_of_pocket", text:"How much did you personally pay after subsidies, MediSave and other insurance?", type:"money", why:"DearPolicy uses the actual financial exposure when assessing reimbursement benefits." };
  }

  if (facts.eventType === "death") {
    if (hasProduct(coverages, "group personal accident") && facts.accidentalDeath == null && !facts.uncertainFacts.includes("cause_of_death")) return { id:"cause_of_death", text:"Was the death directly caused by an accident, or was it due to illness or another cause? You can say “not sure”.", type:"choice", options:["Accident", "Illness or natural causes", "Not sure"], why:"The Personal Accident death benefit requires death caused by an accident. An earlier accident alone does not establish that cause." };
    const racingRule = deathRules.find(r => r.benefit === "gpa-accidental-death" && r.coverageId === bestCoverage(coverages,"group personal accident","Personal Accident")?.id);
    if (facts.accidentalDeath === true && /motorcycle|motorbike/i.test(facts.accidentType ?? "") && racingRule?.racingExclusion && facts.competitiveRacing == null && !facts.uncertainFacts.includes("competitive_racing")) return { id:"competitive_racing", text:"Was the accident during competitive racing on wheels?", type:"yes_no", options:["Yes", "No", "Not sure"], why:racingRule.racingExclusion.authorityException ? "The Personal Accident wording excludes competitive racing on wheels, with an exception for racing sanctioned by MINDEF/MHA. This can change its death benefit." : "The matching Personal Accident wording excludes competitive racing on wheels, so this can change its death benefit." };
    if (facts.accidentalDeath === true && facts.competitiveRacing === true && racingRule?.racingExclusion?.authorityException && facts.racingAuthoritySanctioned == null && !facts.uncertainFacts.includes("racing_authority_sanctioned")) return { id:"racing_authority_sanctioned", text:"Was the racing sanctioned by MINDEF/MHA?", type:"yes_no", options:["Yes", "No", "Not sure"], why:"Your uploaded wording has an exception for racing sanctioned by the Authority. The insurer will need evidence of that sanction." };
    if (hasProduct(coverages, "group personal accident") && facts.accidentalDeath === true && facts.causeOfDeathDocumentAvailable == null && !facts.uncertainFacts.includes("cause_of_death_document")) return { id:"cause_of_death_document", text:"Do you have an official cause-of-death document -- a death certificate, police report, or coroner's report -- confirming the accident? You can say \u201cnot sure\u201d if you have not checked yet.", type:"yes_no", options:["Yes", "No", "Not sure"], why:"The accidental death benefit needs the reported cause checked against the policy's own accident definition before DearPolicy can show an amount. A reported circumstance alone is not enough." };
    // Saying the document exists is only ever availability -- it never
    // authorises an amount by itself. Once available, DearPolicy asks for
    // the document itself; only DearPolicy actually reviewing it and
    // matching its cause against the policy's own definition (never a chat
    // answer) can move this benefit past needs_document.
    if (hasProduct(coverages, "group personal accident") && facts.accidentalDeath === true && facts.causeOfDeathDocumentAvailable === true && facts.causeOfDeathEvidenceReviewed !== true && !facts.uncertainFacts.includes("cause_of_death_document_upload")) return { id:"cause_of_death_document_upload", text:"Please upload the death certificate, police report or coroner's report. DearPolicy will check its stated cause against the policy's own accidental-death definition before showing an amount.", type:"text", why:"Saying the document exists is not the same as DearPolicy having read it. Only the reviewed document, checked against the policy's own definition, can confirm this benefit." };
    // Additive: the travel trip-date safety gate -- see the identical
    // comment in the "hospitalisation" branch above.
    const travelQuestionForDeath = nextTravelQuestion(facts, travelRules);
    if (travelQuestionForDeath) return travelQuestionForDeath;
  }

  if (facts.eventType === "disability") {
    if (facts.permanentImpairment == null && !facts.uncertainFacts.includes("permanent_impairment")) return { id:"permanent_impairment", text:"Has the disability been medically assessed as permanent, or is that still uncertain?", type:"yes_no", options:["Permanent","Not permanent","Not sure"], why:"TPD and accident disability benefits depend on permanence and the policy definition." };
    if (!facts.diagnosis && !facts.injuries.length && !facts.uncertainFacts.includes("diagnosis")) return { id:"diagnosis", text:"What caused the disability—an illness or an injury?", type:"text", why:"Different owned policies respond depending on the cause." };
    const disabilityQuestion = nextDisabilityQuestion(facts, disabilityRules);
    if (disabilityQuestion) return disabilityQuestion;
  }

  return null;
}

function amountText(amount: number | null, currency?: string | null) {
  // Missing stays missing: without a stated currency no figure is shown --
  // never a bare number and never one relabelled as a default currency.
  return amount == null || !currency ? null : formatMoney(amount, currency);
}
/** A cover amount named in explanatory text. It is printed only when its
 * currency is verified from the cover's own policy evidence. Without a
 * verified currency no figure is shown at all -- never a bare number and never
 * relabelled as SGD -- only that an amount exists whose currency is unstated. */
export const UNSTATED_CURRENCY_AMOUNT_TEXT = "an amount in a currency the policy doesn't state, so it isn't shown";
function coverAmountText(coverage: { amount: number | null; currency: string | null; currencyVerified?: boolean }) {
  if (coverage.amount == null) return null;
  return coverage.currencyVerified === true && coverage.currency ? formatMoney(coverage.amount, coverage.currency) : UNSTATED_CURRENCY_AMOUNT_TEXT;
}

export function assessClaim(facts: ClaimFacts, coverages: OwnedCoverage[], deathRules: DeathRuleEvidence[] = [], deathGaps: DeathEvidenceGap[] = [], sessionId: string | null = null, ciRules: CIRuleEvidence[] = [], ciGaps: CIEvidenceGap[] = [], medicalRules?: MedicalRuleEvidence, disabilityRules?: DisabilityRuleSet, travelRules?: TravelRuleSet, table: ClaimTable = NO_TABLE): ClaimAssessmentItem[] {
  const items: ClaimAssessmentItem[] = [];
  if (facts.eventType === "death") {
    const deathDate = facts.deathDate ?? facts.eventDate;
    for (const [product, category, benefit, title] of [
      ["group term life", "Death", "gtl-death", "Group Term Life death benefit"],
      ["group personal accident", "Personal Accident", "gpa-accidental-death", "Group Personal Accident accidental death benefit"],
    ] as const) {
      const coverage = bestCoverage(coverages, product, category);
      if (!coverage || (product === "group personal accident" && facts.accidentalDeath === false)) continue;
      const base = { id: benefit, title, productName: coverage.productName, coverageId: coverage.id, evidenceTerms: [] as string[] };
      if (dateBefore(deathDate, coverage.effectiveDate) === true) {
        items.push({ ...base, status: "not_applicable", amountText: null, reason: "The reported date of death precedes this cover's effective date shown in the personal certificate.", conditions: [] });
        continue;
      }
      const rule = deathRules.find(r => r.coverageId === coverage.id && r.benefit === benefit);
      if (!rule) {
        const gap = deathGaps.find(g => g.coverageId === coverage.id);
        const confirmed = coverage.amount != null ? `The personal certificate confirms ${coverAmountText(coverage)} of this cover. ` : "Personal ownership is confirmed. ";
        items.push({ ...base, status: "needs_document", amountText: null, reason: confirmed + (gap?.reason ?? "I could not verify the matching death-benefit wording."), conditions: [gap?.nextStep ?? "Check that the matching policy wording or benefit summary is available."] });
        continue;
      }
      if (product === "group personal accident" && facts.competitiveRacing === true && rule.racingExclusion) {
        const page = rule.racingExclusion.page;
        const exclusionCitation = { ...rule.citation, chunkId: `page:${rule.citation.policyId}:${page}`, pageStart: page, pageEnd: page };
        if (!rule.racingExclusion.authorityException || facts.racingAuthoritySanctioned === false) {
          items.push({ ...base, ruleEvidence: exclusionCitation, status: "not_applicable", amountText: null, reason: `Competitive racing was reported${rule.racingExclusion.authorityException ? " without MINDEF/MHA sanction" : ""}. The matching wording excludes: ${rule.racingExclusion.quote}.`, conditions: [] });
          continue;
        }
        if (facts.racingAuthoritySanctioned !== true) {
          items.push({ ...base, ruleEvidence: exclusionCitation, status: "needs_document", amountText: null, reason: "Competitive racing was reported, but the wording has an exception for racing sanctioned by MINDEF/MHA. That sanction is still unknown.", conditions: ["Check the event's sanction/approval record with MINDEF/MHA and the insurer."] });
          continue;
        }
      }
      if (coverage.amount == null || !Number.isFinite(coverage.amount)) {
        items.push({ ...base, ruleEvidence: rule.citation, status: "needs_document", amountText: null, reason: "The wording confirms 100% of Sum Insured, but this person's sum insured is missing from verified personal evidence.", conditions: ["Upload the certificate or schedule showing the person's insured amount."] });
        continue;
      }
      const conditions = ["The cover must have been in force on the date of death, and the policy's conditions and exclusions must be met."];
      if (!deathDate || !coverage.effectiveDate) conditions.push("The date of death and this cover's effective date still need documentary confirmation.");
      if (product === "group personal accident") conditions.push("The death certificate and accident/medical report must establish death directly caused by the accident; accident exclusions and any time limits still need checking.");
      if (product === "group personal accident" && facts.competitiveRacing === true && rule.racingExclusion?.authorityException) conditions.push("Provide proof that the racing was sanctioned by MINDEF/MHA; the insurer must accept the exception.");

      // Cross-product currency gate (lib/claims/currency-evidence.ts): the
      // cover's currency must be written in its own policy evidence and every
      // amount the wording quotes must state the same currency. Never assumed,
      // relabelled or converted.
      const currencyCheck = checkNonTravelCurrency({ coverage, requireCoverageCurrency: true,
        quoted: [rule.formula.kind === "fixed" ? rule.formula.currency : undefined, rule.cap ? rule.cap.currency : undefined] });
      if (!currencyCheck.ok) {
        items.push({ ...base, ruleEvidence: rule.citation, status: "needs_document", amountText: null, reason: currencyCheck.reason, conditions: [currencyCheck.condition] });
        continue;
      }
      const evidenceRef = toEvidenceRef(rule.citation);
      const formula: DeathBenefitFormula = rule.formula.kind === "sum_insured_fraction"
        ? { kind: "sum_insured_fraction", fraction: rule.formula.fraction, evidence: evidenceRef }
        : { kind: "fixed", amount: rule.formula.amount, evidence: evidenceRef };
      const ownershipEvidence: DeathBenefitEvidenceRef & { coverageId?: string; familyMemberId?: string } = { chunkId: `coverage:${coverage.id}`, policyId: coverage.policyId, coverageId: coverage.id, familyMemberId: coverage.familyMemberId, label: coverage.productName ?? undefined };
      const sharedInput = {
        ownership: { contractId: coverage.policyId, coverageId: coverage.id, label: coverage.productName ?? undefined },
        familyMember: { id: coverage.familyMemberId, confirmed: true },
        claimEventId: sessionId,
        deathConfirmed: facts.death === true,
        dateOfDeath: deathDate,
        policyEffectiveDate: coverage.effectiveDate,
        sumInsured: coverage.amount,
        currency: coverage.currency,
        formula,
        ...(rule.cap ? { cap: { amount: rule.cap.amount, evidence: evidenceRef } } : {}),
        ruleEvidence: evidenceRef,
        ownershipEvidence,
      };
      const calc = product === "group personal accident"
        ? calculateAccidentalDeath({ ...sharedInput, accidentalDeathDefinitionEvidence: evidenceRef, causeDefinitionMatch: applicableCauseDefinitionMatch(facts, coverage, sessionId, currentDefinition(rule.citation, rule.quote)) })
        : calculateDeathBenefit(sharedInput);

      if (calc.status === "blocked") {
        const isCauseGap = product === "group personal accident" && (
          calc.reasonCode === "MALFORMED_POLICY_DEFINITION_EVIDENCE" ||
          calc.reasonCode === "MALFORMED_CAUSE_EVIDENCE" ||
          (typeof calc.reasonCode === "string" && calc.reasonCode.startsWith("CAUSE_MATCH_"))
        );
        // The reason distinguishes the three unresolved states DearPolicy can
        // actually be in, so the family knows what still needs to happen --
        // never just "unconfirmed" once a document has genuinely been read.
        const causeGapReason = facts.causeOfDeathEvidenceReviewed === true
          ? "An accidental death benefit may apply. DearPolicy has reviewed the cause-of-death document, but it does not yet match this policy's own accidental-death definition, so no amount is included."
          : facts.causeOfDeathDocumentAvailable === true
            ? "An accidental death benefit may apply, but DearPolicy has not included an amount because the cause-of-death document has not yet been reviewed against this policy's own accidental-death definition."
            : "An accidental death benefit may apply, but DearPolicy has not included an amount because the policy's accident definition still needs to be checked against an official cause-of-death document, police report or coroner's report.";
        items.push({ ...base, ruleEvidence: rule.citation, status: "needs_document", amountText: null,
          reason: isCauseGap ? causeGapReason : `The personal certificate confirms ownership of this cover. DearPolicy has not included an amount: ${calc.message}`,
          conditions: isCauseGap ? ["Check the death certificate, police report or coroner's report against the policy's accidental-death definition."] : [calc.message] });
        continue;
      }
      if (calc.status === "not_applicable") {
        items.push({ ...base, ruleEvidence: rule.citation, status: "not_applicable", amountText: null, reason: calc.reason, conditions: [] });
        continue;
      }
      items.push({ ...base, ruleEvidence: rule.citation, status: "potentially_applicable", amountText: amountText(calc.potentialAmount, calc.currency),
        calculatedAmount: calc.potentialAmount, currency: calc.currency, calculationId: calc.calculationId,
        reason: `The personal certificate confirms ${coverAmountText(coverage)} of cover. The matching death-benefit clause pays ${calc.formulaBasis}.`, conditions });
    }
    // Additive: a Travel cover's own Accidental Death benefit alongside
    // gtl-death/gpa-accidental-death above -- never a parallel claim
    // system. See lib/claims/travel-rules.ts for the trip-date safety
    // boundary this benefit is gated behind. Filtered to the death item
    // only -- this branch never surfaces a travel-medical-expenses item,
    // which is additive in the "hospitalisation" branch instead.
    if (travelRules) items.push(...assessTravelClaim(facts, coverages, travelRules, sessionId).filter((i) => i.id === "travel-accidental-death"));
  }

  if (facts.eventType === "accident" || (facts.eventType === "disability" && facts.accidentType != null)) {
    const gpa = bestCoverage(coverages,"group personal accident","Personal Accident") ?? coverages.find((c) => c.category === "Personal Accident") ?? null;
    if (gpa && dateBefore(facts.eventDate,gpa.effectiveDate) === true) {
      items.push({id:"gpa-before-cover",title:gpa.productName ?? "Personal Accident",status:"not_applicable",amountText:null,reason:"The reported accident date is before the effective date shown in the uploaded personal policy evidence.",conditions:[],evidenceTerms:[],productName:gpa.productName ?? "Personal Accident"});
    }
    // Fracture, ambulance, recuperation and hospital cash amounts come from the person's own benefit table
    // (assessTableBenefits, below), never from figures written here.
  }

  // Critical-illness items come only from the evidence-gated ci-* rules (lib/claims/ci-rules.ts): waiting and survival
  // periods are the wording's, never figures written here.
  if (facts.eventType === "diagnosis") {
    items.push(...assessCriticalIllness(facts, coverages, ciRules, ciGaps, sessionId));
  }

  // Additive: the same deterministic pipeline, reused for a "disability"
  // event's TPD/permanent-partial-disability/schedule-of-injuries/
  // disability-income benefits -- never a parallel claim system. See
  // lib/claims/disability-rules.ts for why this never touches the
  // death/CI/medical path.
  if (facts.eventType === "disability") {
    items.push(...assessDisabilityClaim(facts, coverages, disabilityRules, sessionId));
  }

  if (facts.eventType === "hospitalisation") {
    // Evidence-gated med-* items from lib/claims/medical-rules.ts. A hospital cash the benefit table prints is added
    // below only where these did not already assess one.
    const medicalAssessments = assessMedicalClaim(facts, coverages, medicalRules);
    items.push(...medicalAssessments);
    // Additive: a Travel cover's own Overseas Medical Expenses benefit
    // alongside the medical-rules.ts items above -- never a parallel claim
    // system. See lib/claims/travel-rules.ts for the trip-date safety
    // boundary this benefit is gated behind. Filtered to the medical item
    // only -- the travel-accidental-death item is additive in the "death"
    // branch instead.
    if (travelRules) items.push(...assessTravelClaim(facts, coverages, travelRules, sessionId).filter((i) => i.id === "travel-medical-expenses"));
  }

  // The person's own benefit-table rows for the event (fracture, ambulance, recuperation, hospital cash, death,
  // critical illness).
  const withTable = withTableBenefits(facts, coverages, table, items);
  items.splice(0, items.length, ...withTable);

  // Safe fallback for owned reimbursement-style medical cover that DearPolicy has
  // not yet converted into an insurer-specific deterministic rule catalogue.
  if (facts.eventType !== "death" && hasReimbursementMedicalCover(coverages) && facts.hospitalBill != null) {
    const med = coverages.find((c)=>["Hospitalisation","Outpatient"].includes(c.category));
    if (med && !items.some((i)=>i.productName===med.productName)) items.push({id:"medical-reimbursement-review",title:med.productName ?? med.category,status:"needs_document",amountText:null,reason:`You reported a medical bill of ${amountText(facts.hospitalBill,med.currencyVerified===true?med.currency:null) ?? `${facts.hospitalBill.toLocaleString("en-US")} (currency not stated)`}. DearPolicy has confirmed you own this medical cover, but this plan's reimbursement rules have not yet been converted into a deterministic calculator.`,conditions:["DearPolicy should check the plan's deductible, co-insurance, panel/network and eligible-expense wording before estimating reimbursement."],evidenceTerms:[],productName:med.productName});
  }

  return items;
}

export function claimNextSteps(facts: ClaimFacts, items: ClaimAssessmentItem[]) {
  const steps: string[] = [];
  if (facts.eventType === "death") {
    steps.push("Prepare the death certificate and the insurer's death-claim form.");
    if (facts.accidentalDeath === true || items.some(i => i.id === "gpa-accidental-death")) steps.push("Prepare the accident/police report and relevant medical or coroner's report to support the cause of death.");
    steps.push("Check the insurer's submission requirements for the claimant's identity and authority to claim, using the policy's claims instructions.");
    if (items.some(i => i.status === "needs_document")) steps.push("Upload the missing certificate, matching benefit wording or cause-of-death evidence described above.");
    if (!facts.deathDate && !facts.eventDate) steps.push("Check the date of death on the death certificate before assessing policy timing.");
    return steps;
  }
  if (facts.eventType === "accident") {
    steps.push("Keep the accident medical report, discharge summary, X-rays/scans and itemised bills.");
    if (facts.ambulanceUsed) steps.push("Keep the ambulance invoice or receipt.");
    if (facts.fractureBodyPart) steps.push("Keep the radiology report confirming the fracture site.");
  }
  if (facts.eventType === "diagnosis") steps.push("Keep the specialist/oncologist report, pathology report and diagnosis date documents.");
  if (facts.hospitalised) steps.push("Keep the admission/discharge record and itemised hospital bill.");
  if (items.some((i)=>i.status==="needs_document")) steps.push("Upload the relevant medical document so DearPolicy can check the policy definition against the evidence.");
  if (items.some((i)=>i.status==="likely_applicable"||i.status==="potentially_applicable")) steps.push("Prepare the insurer's claim form and submit the supporting records within the policy's claim-notification timeline.");
  return [...new Set(steps)];
}
