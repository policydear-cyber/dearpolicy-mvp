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

function hasReimbursementMedicalCover(coverages: OwnedCoverage[]) {
  return coverages.some((c) => ["Hospitalisation", "Outpatient"].includes(c.category));
}

function fracturePct(body: string | null) {
  const v = (body ?? "").toLowerCase();
  if (/neck|skull|spine/.test(v)) return 1;
  if (/hip/.test(v)) return 0.75;
  if (/jaw|pelvis|leg|ankle|knee/.test(v)) return 0.5;
  if (/cheek|shoulder|hairline/.test(v)) return 0.3;
  if (/arm|elbow|wrist|rib/.test(v)) return 0.25;
  return null;
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

export function relevantOwnedProducts(facts: ClaimFacts, coverages: OwnedCoverage[]) {
  const result = new Set<string>();
  const event = facts.eventType;
  for (const c of coverages) {
    const p = canonicalProduct(c.productName) || productFromCategory(c.category);
    if (!p) continue;
    if (event === "accident" && ["group personal accident","group term life","hospitalisation","outpatient"].includes(p)) result.add(p);
    else if (event === "diagnosis" && ["living care","living care plus","group term life","hospitalisation","outpatient","disability income"].includes(p)) result.add(p);
    else if (event === "hospitalisation" && ["group term life","hospitalisation","outpatient","group personal accident"].includes(p)) result.add(p);
    else if (event === "death" && (p === "group term life" || (p === "group personal accident" && facts.accidentalDeath !== false))) result.add(p);
    else if (event === "disability" && ["group term life","group personal accident","disability income"].includes(p)) result.add(p);
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
    if (hasProduct(coverages,"group personal accident") && facts.ambulanceUsed == null && !facts.uncertainFacts.includes("ambulance_used")) return { id:"ambulance_used", text:"Did you use an ambulance because of the accident? If yes, include the ambulance charge if you know it.", type:"yes_no", options:["Yes","No"], why:"Your Personal Accident policy includes an ambulance reimbursement benefit." };
    if (hasProduct(coverages,"group personal accident") && facts.ambulanceUsed === true && facts.ambulanceBill == null && !facts.uncertainFacts.includes("ambulance_bill")) return { id:"ambulance_bill", text:"How much was the ambulance bill?", type:"money", why:"The ambulance benefit is reimbursement-based, so the bill amount affects the potential payout." };
    if ((hasProduct(coverages,"group term life") || hasProduct(coverages,"group personal accident") || hasReimbursementMedicalCover(coverages)) && facts.hospitalised == null && !facts.uncertainFacts.includes("hospitalised")) return { id:"hospitalised", text:"Were you admitted to hospital? If yes, tell me how many nights you stayed.", type:"yes_no", options:["Yes","No"], why:"Hospital-related benefits depend on whether you were admitted and, for some benefits, the length of stay." };
    if (facts.hospitalised === true && facts.hospitalNights == null && !facts.uncertainFacts.includes("hospital_nights")) return { id:"hospital_nights", text:"How many nights were you admitted?", type:"text", why:"Your hospital cash benefit only starts after a specified length of stay." };
    if (hasReimbursementMedicalCover(coverages) && facts.hospitalised === true && facts.hospitalBill == null && !facts.uncertainFacts.includes("hospital_bill")) return { id:"hospital_bill", text:"What was the total hospital or medical bill? You can upload the bill later if that is easier.", type:"money", why:"Reimbursement-type medical cover depends on the actual eligible expense." };
    if (hasReimbursementMedicalCover(coverages) && facts.hospitalBill != null && facts.outOfPocket == null && !facts.uncertainFacts.includes("out_of_pocket")) return { id:"out_of_pocket", text:"How much did you personally have to pay after subsidies, MediSave, employer benefits, or other insurance?", type:"money", why:"This helps avoid treating a policy limit as money you actually spent or can be reimbursed twice." };
    if (hasProduct(coverages,"group personal accident") && facts.injured !== false && facts.permanentImpairment == null && !facts.uncertainFacts.includes("permanent_impairment")) return { id:"permanent_impairment", text:"Has a doctor said any injury may cause permanent loss of function, amputation, or permanent disability?", type:"yes_no", options:["Yes","No","Not sure"], why:"A permanent injury may trigger much larger Personal Accident or TPD benefits." };
    if (/motorcycle|motorbike/i.test(facts.accidentType ?? "") && hasProduct(coverages,"group personal accident") && facts.competitiveRacing == null && !facts.uncertainFacts.includes("competitive_racing")) return { id:"competitive_racing", text:"Was the accident during competitive racing or a timed competition?", type:"yes_no", options:["Yes","No"], why:"Your Personal Accident wording contains a racing exclusion, so this fact can change eligibility." };
  }

  if (facts.eventType === "diagnosis") {
    if (!facts.diagnosis && !facts.uncertainFacts.includes("diagnosis")) return { id:"diagnosis", text:"What was the exact diagnosis? Include the cancer type/stage or medical condition if you know it.", type:"text", why:"Critical illness benefits depend on the specific diagnosis and policy definition." };
    const ciQuestion = nextCIQuestion(facts, ciRules);
    if (ciQuestion) return ciQuestion;
    if ((hasProduct(coverages,"group term life") || hasReimbursementMedicalCover(coverages)) && facts.hospitalised == null && !facts.uncertainFacts.includes("hospitalised")) return { id:"hospitalised", text:"Were you admitted to hospital because of this diagnosis? If yes, how many nights?", type:"yes_no", options:["Yes","No"], why:"Your other owned policies may contain hospital cash or medical reimbursement benefits in addition to a diagnosis benefit." };
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
  // never a bare number and never one relabelled as SGD. The hard-coded
  // G007500 schedule benefits below pass "SGD" explicitly because their
  // amounts are quoted in S$ by the same embedded scheme wording (S$5,000
  // simple-fracture limit, S$500 ambulance, S$30/day hospital cash); that
  // restates the rule's own wording rather than defaulting extracted data.
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

function g007500(coverages: OwnedCoverage[]) {
  return coverages.some((c) => c.groupPolicyNumber === "G007500");
}

export function assessClaim(facts: ClaimFacts, coverages: OwnedCoverage[], deathRules: DeathRuleEvidence[] = [], deathGaps: DeathEvidenceGap[] = [], sessionId: string | null = null, ciRules: CIRuleEvidence[] = [], ciGaps: CIEvidenceGap[] = [], medicalRules?: MedicalRuleEvidence, disabilityRules?: DisabilityRuleSet, travelRules?: TravelRuleSet): ClaimAssessmentItem[] {
  const items: ClaimAssessmentItem[] = [];
  const isG007500 = g007500(coverages);
  // Additive: new evidence-gated disability items from
  // lib/claims/disability-rules.ts alongside the legacy hardcoded
  // "gpa-tpd" item below -- when disability-rules.ts has produced a real,
  // wording-evidenced TPD assessment for the SAME Group Personal Accident
  // coverage, the legacy hardcoded item is suppressed so the family is
  // never shown two competing TPD estimates for one coverage. See
  // lib/claims/medical-rules.ts's identical suppression pattern for
  // "gtl-hospital-cash".
  const disabilityTPDCoverageIds = new Set((disabilityRules?.rules ?? []).filter((r) => r.benefitCode === "tpd-lump-sum").map((r) => r.coverageId));

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
      if (coverage.groupPolicyNumber?.replace(/\s+/g,"").toUpperCase() !== "G007500" || !rule) {
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
    const gpa = bestCoverage(coverages,"group personal accident","Personal Accident");
    if (gpa && dateBefore(facts.eventDate,gpa.effectiveDate) === true) {
      items.push({id:"gpa-before-cover",title:"Group Personal Accident",status:"not_applicable",amountText:null,reason:"The reported accident date is before the effective date shown in the uploaded personal policy evidence.",conditions:[],evidenceTerms:[],productName:"Group Personal Accident"});
    } else if (gpa && isG007500 && facts.competitiveRacing === true) {
      items.push({id:"gpa-racing",title:"Group Personal Accident",status:"not_applicable",amountText:null,reason:"The accident was reported as competitive racing, which is excluded by the uploaded Personal Accident wording.",conditions:[],evidenceTerms:["Participation in competitive racing on wheels"],productName:"Group Personal Accident"});
    } else if (gpa && isG007500) {
      const pct = fracturePct(facts.fractureBodyPart);
      if (pct != null) {
        const amount = 5000 * pct;
        items.push({id:"gpa-fracture",title:`${facts.fractureBodyPart?.replace(/^./,c=>c.toUpperCase())} fracture benefit`,status:"likely_applicable",amountText:amountText(amount,"SGD"),reason:`The policy's simple-fracture limit is S$5,000 and the schedule pays ${Math.round(pct*100)}% for this body part.`,conditions:["The fracture must meet the policy's simple-fracture definition and be caused by the accident."],evidenceTerms:["Simple Fracture Benefit Limit","Schedule Compensation"],productName:"Group Personal Accident"});
      }
      if (facts.ambulanceUsed === true && facts.ambulanceBill != null) {
        const amount = Math.min(facts.ambulanceBill,500);
        items.push({id:"gpa-ambulance",title:"Ambulance reimbursement",status:"likely_applicable",amountText:amountText(amount,"SGD"),reason:`Your reported ambulance bill is ${amountText(facts.ambulanceBill,"SGD")} and the policy limit is S$500 per incident.`,conditions:["Keep the ambulance invoice/receipt and accident medical records."],evidenceTerms:["Ambulance Cost","Up to S$500 per incident"],productName:"Group Personal Accident"});
      }
      if (facts.hospitalised === true) {
        items.push({id:"gpa-hospital-recovery",title:"Accidental hospital recuperation",status:"likely_applicable",amountText:"S$250",reason:"The uploaded Personal Accident summary lists a S$250 accidental hospital recuperation benefit.",conditions:["The hospital admission must satisfy the policy's accident-related admission conditions."],evidenceTerms:["Accidental Hospital Recuperation Benefit","S$250"],productName:"Group Personal Accident"});
      }
      if ((facts.permanentImpairment === true || facts.uncertainFacts.includes("permanent_impairment")) && gpa.amount != null && !disabilityTPDCoverageIds.has(gpa.id)) {
        const amount = gpa.amount * 1.5;
        items.push({id:"gpa-tpd",title:"Accidental Total & Permanent Disability",status:"needs_document",amountText:gpa.currency?`Up to ${amountText(amount,gpa.currency)}`:null,reason:facts.permanentImpairment===true?"Your Personal Accident cover is confirmed and the wording pays 150% of Sum Insured for qualifying accidental TPD.":"Permanent impairment is still uncertain, but this high-value benefit should be checked if doctors suspect lasting loss of function.",conditions:["A medical assessment must satisfy the policy's Total & Permanent Disability definition.","The disability must result from the accident."],evidenceTerms:["Total and Permanent Disablement","150% of Sum Insured"],productName:"Group Personal Accident"});
      }
    }

    const gtl = bestCoverage(coverages,"group term life","Death") ?? bestCoverage(coverages,"group term life");
    if (gtl && isG007500 && facts.hospitalised === true && facts.hospitalNights != null && dateBefore(facts.eventDate,gtl.effectiveDate) !== true) {
      const payableDays = Math.max(0, Math.min(30, facts.hospitalNights - 10));
      if (payableDays > 0) items.push({id:"gtl-hospital-cash",title:"Daily Hospital Cash",status:"likely_applicable",amountText:amountText(payableDays*30,"SGD"),reason:`Your ${facts.hospitalNights}-night stay gives ${payableDays} payable day${payableDays===1?"":"s"} after the first 10 days, at S$30 per day.`,conditions:["The hospitalisation must not fall under an exclusion for this benefit."],evidenceTerms:["Daily Hospital Cash Benefit","$30 per day"],productName:"Group Term Life"});
      else items.push({id:"gtl-hospital-cash",title:"Daily Hospital Cash",status:"not_applicable",amountText:null,reason:`This benefit starts only after the 10th day of a continuous hospital stay. The reported stay was ${facts.hospitalNights} night${facts.hospitalNights===1?"":"s"}.`,conditions:[],evidenceTerms:["Daily Hospital Cash Benefit","after the 10th day"],productName:"Group Term Life"});
    }
  }

  if (facts.eventType === "diagnosis") {
    const diagnosis = (facts.diagnosis ?? "").toLowerCase();
    const livingCare = bestCoverage(coverages,"living care","Critical Illness");
    if (livingCare && /cancer|malignan|carcinoma|heart attack|stroke|kidney|critical illness/i.test(diagnosis)) {
      const beforeCover=dateBefore(facts.diagnosisDate,livingCare.effectiveDate);
      const waiting = dateIsWithinDays(facts.diagnosisDate,livingCare.effectiveDate,90);
      if (beforeCover === true) items.push({id:"living-care",title:"Living Care critical illness",status:"not_applicable",amountText:null,reason:"The reported diagnosis date is before the effective date shown for this Living Care cover.",conditions:[],evidenceTerms:[],productName:"Living Care"});
      else if (waiting === true) items.push({id:"living-care",title:"Living Care critical illness",status:"not_applicable",amountText:null,reason:"The diagnosis date appears to fall within the 90-day waiting period from the effective date shown in the uploaded personal evidence.",conditions:[],evidenceTerms:["Waiting Period","90 days"],productName:"Living Care"});
      else items.push({id:"living-care",title:"Living Care critical illness",status:"potentially_applicable",amountText:(livingCare.currencyVerified===true?amountText(livingCare.amount,livingCare.currency):null),reason:`Your personal certificate confirms ${coverAmountText(livingCare) ?? "Critical Illness"} of Living Care cover, and the uploaded wording includes Major Cancer and other severe critical illnesses.`,conditions:["The diagnosis must satisfy the policy's defined critical illness.","A 30-day survival period applies.",waiting===null?"DearPolicy could not automatically verify the waiting period from the available dates.":"The diagnosis date appears to be outside the 90-day waiting period."],evidenceTerms:["Major Cancer","Survival Period","Waiting Period"],productName:"Living Care"});
    }

    const livingCarePlus = bestCoverage(coverages,"living care plus","Early Critical Illness");
    if (livingCarePlus && /early|stage\s*0|stage\s*1|stage\s*i\b/i.test(diagnosis)) {
      const waiting = dateIsWithinDays(facts.diagnosisDate,livingCarePlus.effectiveDate,60);
      if (waiting === true) items.push({id:"living-care-plus",title:"Living Care Plus early critical illness",status:"not_applicable",amountText:null,reason:"The diagnosis appears to fall within the 60-day waiting period for Living Care Plus.",conditions:[],evidenceTerms:["Living Care Plus benefit is not payable","sixty (60) days"],productName:"Living Care Plus"});
      else items.push({id:"living-care-plus",title:"Living Care Plus early critical illness",status:"potentially_applicable",amountText:(livingCarePlus.currencyVerified===true?amountText(livingCarePlus.amount,livingCarePlus.currency):null),reason:"Your personal certificate confirms Living Care Plus cover and the uploaded wording covers specified early critical illnesses.",conditions:["The diagnosis must meet one of the policy's defined early critical illnesses.","A 30-day survival period applies."],evidenceTerms:["Living Care Plus","survive for 30 days"],productName:"Living Care Plus"});
    }

    const gtl = bestCoverage(coverages,"group term life","Death") ?? bestCoverage(coverages,"group term life");
    if (gtl && isG007500 && facts.hospitalised === true && facts.hospitalNights != null) {
      const payableDays = Math.max(0, Math.min(30, facts.hospitalNights - 10));
      if (payableDays > 0) items.push({id:"gtl-hospital-cash",title:"Daily Hospital Cash",status:"likely_applicable",amountText:amountText(payableDays*30,"SGD"),reason:`The reported hospital stay produces ${payableDays} payable day${payableDays===1?"":"s"} at S$30 per day after day 10.`,conditions:["The admission must satisfy the policy conditions and exclusions."],evidenceTerms:["Daily Hospital Cash Benefit","$30 per day"],productName:"Group Term Life"});
    }
  }

  // Additive: new evidence-gated ci-* items alongside the legacy
  // "living-care"/"living-care-plus" informational items above. See
  // lib/claims/ci-rules.ts's own module doc comment for why these are
  // additive rather than a replacement.
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
    const gtl = bestCoverage(coverages,"group term life","Death") ?? bestCoverage(coverages,"group term life");
    // Additive: new evidence-gated med-* items from lib/claims/medical-rules.ts
    // alongside the legacy hardcoded "gtl-hospital-cash"/"medical-reimbursement-review"
    // items in this function. When medical-rules.ts has produced a real
    // assessment for the SAME coverage (an evidenced cash or reimbursement rule
    // matched to it), the corresponding legacy hardcoded item is suppressed so
    // the family is never shown two competing estimates for one coverage.
    const medicalAssessments = assessMedicalClaim(facts, coverages, medicalRules);
    const medicalAssessedCoverageIds = new Set(medicalAssessments.map((i) => i.coverageId));
    if (gtl && isG007500 && facts.hospitalNights != null && !medicalAssessedCoverageIds.has(gtl.id)) {
      const payableDays = Math.max(0, Math.min(30, facts.hospitalNights - 10));
      if (payableDays > 0) items.push({id:"gtl-hospital-cash",title:"Daily Hospital Cash",status:"likely_applicable",amountText:amountText(payableDays*30,"SGD"),reason:`The policy pays S$30 per day from day 11, for up to 30 payable days.`,conditions:["The reason for admission must not be excluded."],evidenceTerms:["Daily Hospital Cash Benefit","$30 per day"],productName:"Group Term Life"});
      else items.push({id:"gtl-hospital-cash",title:"Daily Hospital Cash",status:"not_applicable",amountText:null,reason:`The reported ${facts.hospitalNights}-night stay does not pass the 10-day waiting period for this hospital cash benefit.`,conditions:[],evidenceTerms:["after the 10th day"],productName:"Group Term Life"});
    }
    items.push(...medicalAssessments);
    // Additive: a Travel cover's own Overseas Medical Expenses benefit
    // alongside the medical-rules.ts items above -- never a parallel claim
    // system. See lib/claims/travel-rules.ts for the trip-date safety
    // boundary this benefit is gated behind. Filtered to the medical item
    // only -- the travel-accidental-death item is additive in the "death"
    // branch instead.
    if (travelRules) items.push(...assessTravelClaim(facts, coverages, travelRules, sessionId).filter((i) => i.id === "travel-medical-expenses"));
  }

  // Safe fallback for owned reimbursement-style medical cover that DearPolicy has
  // not yet converted into an insurer-specific deterministic rule catalogue.
  if (facts.eventType !== "death" && hasReimbursementMedicalCover(coverages) && facts.hospitalBill != null) {
    const med = coverages.find((c)=>["Hospitalisation","Outpatient"].includes(c.category));
    if (med && !items.some((i)=>i.productName===med.productName)) items.push({id:"medical-reimbursement-review",title:med.productName ?? med.category,status:"needs_document",amountText:null,reason:`You reported a medical bill of ${amountText(facts.hospitalBill,"SGD")}. DearPolicy has confirmed you own this medical cover, but this plan's reimbursement rules have not yet been converted into a deterministic calculator.`,conditions:["DearPolicy should check the plan's deductible, co-insurance, panel/network and eligible-expense wording before estimating reimbursement."],evidenceTerms:[],productName:med.productName});
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
