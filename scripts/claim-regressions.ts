import assert from "node:assert/strict";
import { definitionWordingHash } from "@/lib/claims/evidence/decision-selection";
import { extractClaimFacts } from "@/lib/claims/facts";
import { resolveClaimDate } from "@/lib/claims/dates";
import { resolveClaimPerson, type ClaimPerson } from "@/lib/claims/person";
import { findDeathRule, type DeathRuleEvidence } from "@/lib/claims/death-evidence";
import { assessClaim, nextClaimQuestion, relevantOwnedProducts } from "@/lib/claims/rules";
import { EMPTY_CLAIM_FACTS, type ClaimQuestion } from "@/lib/claims/types";
import type { CauseDefinitionMatch } from "@/lib/claims/calculators/evidence";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { verifiedEvidenceProvenance } from "./fixtures/verified-evidence-provenance";

export async function runClaimRegressions() {
  let cases = 0;
  const test = (name: string, fn: () => void) => { try { fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); } };
  const context = { now: new Date("2026-09-14T12:00:00Z"), timeZone: "Asia/Singapore", allowAi: false };
  const family: ClaimPerson[] = [
    { id: "desmond", display_name: "Tan Yi Chuen, Desmond", preferred_name: "Desmond", relationship: "self" },
    { id: "charmaine", display_name: "Ong Pei Lin Charmaine", preferred_name: "Charmaine", relationship: "spouse" },
  ];
  const coverage = (overrides: Partial<OwnedCoverage>): OwnedCoverage => ({ id: "gtl", policyId: "certificate", familyMemberId: "charmaine", category: "Death", amount: 1_000_000, currency: "SGD", productName: "Group Term Life", sourcePage: 1, evidenceText: "personal certificate", insurer: "Singlife", policyName: "MINDEF & MHA", policyNumber: "personal", groupPolicyNumber: "G007500", documentRole: "certificate", effectiveDate: "2022-10-06", renewalOrExpiryDate: null, currencyVerified: true, ...overrides });
  const coverages = [coverage({}), coverage({ id: "gpa", category: "Personal Accident", productName: "Group Personal Accident", amount: 600_000 }), coverage({ id: "lc", category: "Critical Illness", productName: "Living Care", amount: 350_000 })];
  const citation = { chunkId: "page:wording:2", policyId: "wording", policyName: "Benefit summary", pageStart: 2, pageEnd: 2, personalEvidence: false };
  const deathRules: DeathRuleEvidence[] = [{ coverageId: "gtl", benefit: "gtl-death", quote: "Death 100% of Sum Insured", citation, formula: { kind: "sum_insured_fraction", fraction: 1 } }, { coverageId: "gpa", benefit: "gpa-accidental-death", quote: "Death due to Accident 100% of Sum Insured", citation, formula: { kind: "sum_insured_fraction", fraction: 1 } }];
  // The claim (assessment session) these tests act inside. Every reviewed
  // cause-vs-definition match below is scoped to this exact session, this
  // exact contract/coverage and this exact family member -- a policy-
  // specific match, never a global flag.
  const SESSION_ID = "session-claim-regressions";
  const confirmedGpaMatch = (): CauseDefinitionMatch => ({
    familyMemberId: "charmaine", claimEventId: SESSION_ID, contractId: "certificate", coverageId: "gpa",
    causeEvidence: { documentId: "police-report-1", documentType: "police_report", pageStart: 1, pageEnd: 1, familyMemberId: "charmaine", claimEventId: SESSION_ID },
    definitionEvidence: { policyId: citation.policyId, chunkId: citation.chunkId, pageStart: citation.pageStart, pageEnd: citation.pageEnd, wordingHash: definitionWordingHash(deathRules[1].quote) },
    result: "matches", reviewedAt: "2026-09-14",
    provenance: verifiedEvidenceProvenance("police-report-1"),
  });
  const death = await extractClaimFacts({ text: "charmaine died from an accident yesterday. what can i claim for?", ...context });
  test("Accidental death outranks accident and retains cause/date", () => {
    assert.equal(death.eventType, "death"); assert.equal(death.death, true); assert.equal(death.accidentalDeath, true); assert.equal(death.deathDate, "2026-09-13");
    assert.equal(death.factSources?.deathDate?.source, "system-derived"); assert.equal(death.factSources?.deathDate?.timeZone, "Asia/Singapore");
    assert.equal(nextClaimQuestion(death, coverages)?.id, "cause_of_death_document");
  });
  test("Named member overrides selected profile", () => {
    const result = resolveClaimPerson("charmaine died from an accident yesterday", family, "desmond"); assert.equal(result.status, "resolved"); if (result.status === "resolved") assert.equal(result.person.id, "charmaine");
  });
  test("Auxiliary verbs do not become part of a person's name", () => {
    assert.equal(resolveClaimPerson("Charmaine was diagnosed with cancer", family, "desmond").status, "resolved");
  });
  test("First-person and pronoun follow-ups keep the selected context", () => { const result = resolveClaimPerson("I was diagnosed with cancer yesterday", family, "desmond"); assert.equal(result.status, "resolved"); if(result.status === "resolved") assert.equal(result.person.id, "desmond"); });
  test("First-person statements resolve the unique account holder without a selector", () => { const result = resolveClaimPerson("I caught dengue", family, ""); assert.equal(result.status, "resolved"); if(result.status === "resolved") assert.equal(result.person.id, "desmond"); });
  test("A condition verb still resolves a named family member", () => { const result = resolveClaimPerson("Charmaine caught dengue", family, ""); assert.equal(result.status, "resolved"); if(result.status === "resolved") assert.equal(result.person.id, "charmaine"); });
  test("A relationship resolves without a profile selector", () => { const result = resolveClaimPerson("My wife caught dengue", family, ""); assert.equal(result.status, "resolved"); if(result.status === "resolved") assert.equal(result.person.id, "charmaine"); });
  test("Unknown subjects in motorbike and question phrases require identity", () => { assert.equal(resolveClaimPerson("Alice got into a motorbike accident yesterday", family, "desmond").status, "unknown"); assert.equal(resolveClaimPerson("What can Alice claim after an accident yesterday?", family, "desmond").status, "unknown"); });
  test("Unknown named person never uses selected person's policies", () => { assert.equal(resolveClaimPerson("Alice died yesterday", family, "desmond").status, "unknown"); });
  test("A named claimant's full name does not override the deceased subject", () => { const result = resolveClaimPerson("Charmaine died yesterday. Tan Yi Chuen Desmond wants to claim.", family, "desmond"); assert.equal(result.status, "resolved"); if(result.status === "resolved") assert.equal(result.person.id, "charmaine"); });
  test("Duplicate preferred names require clarification", () => { assert.equal(resolveClaimPerson("Charmaine died yesterday", [...family, { ...family[1], id: "other" }], "desmond").status, "ambiguous"); });
  test("Unique partial full name resolves", () => { const result = resolveClaimPerson("Pei Lin died yesterday", family, "desmond"); assert.equal(result.status, "resolved"); if (result.status === "resolved") assert.equal(result.person.id, "charmaine"); });
  test("Relationship resolution is conservative for multiple parents", () => { assert.equal(resolveClaimPerson("My mother died yesterday", [...family, { ...family[0], id: "mum", relationship: "parent" }, { ...family[0], id: "dad", relationship: "parent" }], "desmond").status, "ambiguous"); });
  test("Calendar date uses Singapore, including midnight and month changes", () => {
    assert.equal(resolveClaimDate("yesterday", { now: new Date("2026-09-14T16:15:00Z"), timeZone: "Asia/Singapore" })?.date, "2026-09-14");
    assert.equal(resolveClaimDate("yesterday", { now: new Date("2026-03-01T04:00:00Z"), timeZone: "Asia/Singapore" })?.date, "2026-02-28");
  });
  test("Weekday and explicit dates", () => {
    assert.equal(resolveClaimDate("last Tuesday", context)?.date, "2026-09-08"); assert.equal(resolveClaimDate("last Monday", context)?.date, "2026-09-07");
    assert.equal(resolveClaimDate("6 Oct 2022", context)?.date, "2022-10-06"); assert.equal(resolveClaimDate("06/10/2022", context)?.date, "2022-10-06");
    assert.equal(resolveClaimDate("2026-02-30", context), null); assert.equal(resolveClaimDate("last week", context), null);
  });
  const upgraded = await extractClaimFacts({ text: "She died from the accident yesterday", current: { ...EMPTY_CLAIM_FACTS, eventType: "accident", eventDate: "2026-09-08", accidentType: "motorcycle accident" }, pendingQuestion: { id: "injured", text: "What injuries?", type: "text", why: "test" }, ...context });
  test("Death updates an existing accident session and cancels its injury question", () => { assert.equal(upgraded.eventType, "death"); assert.equal(upgraded.injured, null); assert.equal(upgraded.deathDate, "2026-09-13"); assert.equal(nextClaimQuestion(upgraded, coverages)?.id, "cause_of_death_document"); });
  const dates = await extractClaimFacts({ text: "Charmaine had a crash last Tuesday and died yesterday", ...context });
  test("Accident and death dates remain separate; temporal sequence does not prove cause", () => { assert.equal(dates.accidentDate, "2026-09-08"); assert.equal(dates.deathDate, "2026-09-13"); assert.equal(dates.accidentalDeath, null); assert.equal(nextClaimQuestion(dates, coverages)?.id, "cause_of_death"); });
  const reverseDates = await extractClaimFacts({ text: "Charmaine died yesterday after an accident on 2026-09-08", ...context });
  test("An explicit date for an earlier accident cannot overwrite yesterday's death date", () => { assert.equal(reverseDates.deathDate, "2026-09-13"); assert.equal(reverseDates.accidentDate, "2026-09-08"); assert.equal(reverseDates.accidentalDeath, null); });
  test("A cause of death alone does not establish the accident date", () => { assert.equal(death.accidentDate, null); });
  const prefixedDeathDate = await extractClaimFacts({ text: "Yesterday, Charmaine died from an accident", ...context });
  test("A date before the death statement is already answered", () => { assert.equal(prefixedDeathDate.deathDate, "2026-09-13"); assert.equal(nextClaimQuestion(prefixedDeathDate, coverages)?.id, "cause_of_death_document"); });
  const natural = await extractClaimFacts({ text: "Charmaine died from cancer yesterday after a previous accident", ...context });
  test("Explicit illness death does not pay the accidental death benefit", () => { assert.equal(natural.accidentalDeath, false); assert.deepEqual(relevantOwnedProducts(natural, coverages), ["group term life"]); assert.equal(assessClaim(natural, coverages, deathRules, [], SESSION_ID).some(i => i.id === "gpa-accidental-death"), false); });
  const negated = await extractClaimFacts({ text: "Charmaine almost died in an accident yesterday but she is alive", ...context });
  test("Almost died is not a death claim", () => { assert.notEqual(negated.eventType, "death"); assert.notEqual(negated.death, true); });
  const killed = await extractClaimFacts({ text: "Charmaine was killed in a motorbike accident yesterday", ...context });
  test("Killed in an accident already states accidental cause", () => { assert.equal(killed.eventType, "death"); assert.equal(killed.accidentalDeath, true); assert.equal(killed.deathDate, "2026-09-13"); });
  const cancer = await extractClaimFacts({ text: "I have stage 3 colon cancer diagnosed yesterday", ...context });
  test("Cancer site, stage and diagnosis date are retained before question planning", () => { assert.equal(cancer.diagnosis, "stage 3 colon cancer"); assert.equal(cancer.diagnosisStage, "3"); assert.equal(cancer.diagnosisSite, "colon"); assert.equal(cancer.diagnosisDate, "2026-09-13"); assert.notEqual(nextClaimQuestion(cancer, coverages)?.id, "diagnosis"); assert.notEqual(nextClaimQuestion(cancer, coverages)?.id, "diagnosis_date"); });
  const causeQuestion: ClaimQuestion = { id: "cause_of_death", text: "Cause?", type: "choice", why: "test" };
  const uncertain = await extractClaimFacts({ text: "Not sure", current: { ...death, accidentalDeath: null }, pendingQuestion: causeQuestion, ...context });
  test("Unknown cause is deferred to evidence without asking again or assuming accident", () => { assert.equal(nextClaimQuestion(uncertain, coverages), null); assert.equal(assessClaim(uncertain, coverages, deathRules, [], SESSION_ID).find(i => i.id === "gpa-accidental-death")?.amountText, null); });
  const bill = await extractClaimFacts({ text: "I don't know", current: EMPTY_CLAIM_FACTS, pendingQuestion: { id: "ambulance_bill", text: "Bill?", type: "money", why: "test" }, ...context });
  test("Unknown bill never becomes zero", () => { assert.equal(bill.ambulanceBill, null); });
  const irrelevantBillNumber = await extractClaimFacts({ text: "Not sure, it happened 3 days ago", current: EMPTY_CLAIM_FACTS, pendingQuestion: { id: "ambulance_bill", text: "Bill?", type: "money", why: "test" }, ...context });
  test("A number in a date answer is not an expense", () => { assert.equal(irrelevantBillNumber.ambulanceBill, null); });
  const hospitalBillOnly = await extractClaimFacts({ text: "My hospital bill was S$4800", ...context });
  test("A hospital bill alone does not prove inpatient admission", () => { assert.equal(hospitalBillOnly.hospitalised, null); });
  const accidentalDisability = await extractClaimFacts({ text: "The motorcycle accident caused permanent disability yesterday", ...context });
  test("Permanent accident disability retains the established 150% rule", () => { assert.equal(accidentalDisability.eventType, "disability"); assert.equal(assessClaim(accidentalDisability, coverages).find(i => i.id === "gpa-tpd")?.amountText, "Up to S$900,000"); });
  const documentedDeath = { ...death, causeOfDeathDocumentAvailable: true, causeOfDeathEvidenceReviewed: true, causeDefinitionMatches: [confirmedGpaMatch()] };
  test("Death benefits are deterministic and limited to confirmed products", () => {
    const result = assessClaim(documentedDeath, coverages, deathRules, [], SESSION_ID); assert.equal(result.length, 2); assert.equal(result.find(i => i.id === "gtl-death")?.calculatedAmount, 1_000_000); assert.equal(result.find(i => i.id === "gpa-accidental-death")?.calculatedAmount, 600_000);
    assert.equal(result.reduce((sum, i) => sum + (i.calculatedAmount ?? 0), 0), 1_600_000);
    assert.equal(assessClaim(documentedDeath, [coverages[0]], deathRules, [], SESSION_ID).length, 1); assert.deepEqual(assessClaim(documentedDeath, [], deathRules, [], SESSION_ID), []);
  });
  test("A reported accident alone never authorises the accidental death amount", () => {
    const reported = assessClaim(death, coverages, deathRules, [], SESSION_ID).find(i => i.id === "gpa-accidental-death");
    assert.equal(reported?.status, "needs_document"); assert.equal(reported?.amountText, null); assert.equal(reported?.calculatedAmount, undefined);
    assert.match(reported?.reason ?? "", /official cause-of-death document/i);
    // The ordinary death benefit is unaffected by the accidental-death gap.
    assert.equal(assessClaim(death, coverages, deathRules, [], SESSION_ID).find(i => i.id === "gtl-death")?.calculatedAmount, 1_000_000);
  });
  test("Answering “Yes” to document availability alone never authorises the accidental-death amount", () => {
    const available = { ...death, causeOfDeathDocumentAvailable: true };
    const reported = assessClaim(available, coverages, deathRules, [], SESSION_ID).find(i => i.id === "gpa-accidental-death");
    assert.equal(reported?.status, "needs_document"); assert.equal(reported?.amountText, null); assert.equal(reported?.calculatedAmount, undefined);
    assert.equal(nextClaimQuestion(available, coverages)?.id, "cause_of_death_document_upload");
  });
  test("A reviewed document without a confirmed match to the policy's own definition never authorises an amount", () => {
    const reviewedOnly = { ...death, causeOfDeathDocumentAvailable: true, causeOfDeathEvidenceReviewed: true };
    const reviewedButUnmatched = assessClaim(reviewedOnly, coverages, deathRules, [], SESSION_ID).find(i => i.id === "gpa-accidental-death");
    assert.equal(reviewedButUnmatched?.status, "needs_document"); assert.equal(reviewedButUnmatched?.amountText, null);
    const matchNotConfirmed = { ...death, causeOfDeathDocumentAvailable: true, causeOfDeathEvidenceReviewed: true, causeDefinitionMatches: [{ ...confirmedGpaMatch(), result: "needs_review" as const }] };
    const notConfirmed = assessClaim(matchNotConfirmed, coverages, deathRules, [], SESSION_ID).find(i => i.id === "gpa-accidental-death");
    assert.equal(notConfirmed?.status, "needs_document"); assert.equal(notConfirmed?.amountText, null);
  });
  test("A match for a different claim session never authorises this claim's amount", () => {
    const wrongSession = { ...death, causeOfDeathDocumentAvailable: true, causeOfDeathEvidenceReviewed: true, causeDefinitionMatches: [confirmedGpaMatch()] };
    const result = assessClaim(wrongSession, coverages, deathRules, [], "a-different-session").find(i => i.id === "gpa-accidental-death");
    assert.equal(result?.status, "needs_document"); assert.equal(result?.amountText, null);
  });
  test("Wording missing, wrong policy group or missing personal amount cannot produce a payout", () => {
    assert.equal(assessClaim(death, coverages).some(i => i.amountText != null), false);
    assert.equal(assessClaim(death, coverages.map(c => ({ ...c, groupPolicyNumber: "OTHER" })), deathRules, [], SESSION_ID).some(i => i.amountText != null), false);
    assert.equal(assessClaim(death, coverages.map(c => ({ ...c, amount: null })), deathRules, [], SESSION_ID).some(i => i.amountText != null), false);
  });
  test("Death before cover began is not payable under that cover", () => { assert.equal(assessClaim({ ...death, deathDate: "2021-01-01" }, coverages, deathRules, [], SESSION_ID).every(i => i.status === "not_applicable"), true); });
  test("A verified racing exclusion changes the death pathway without routine injury questions", () => {
    const rules = deathRules.map(r => r.benefit === "gpa-accidental-death" ? { ...r, racingExclusion: { quote: "Participation in competitive racing on wheels", page: 2 } } : r);
    const facts = { ...death, accidentType: "motorcycle accident" };
    assert.equal(nextClaimQuestion(facts, coverages, rules)?.id, "competitive_racing");
    assert.equal(assessClaim({ ...facts, competitiveRacing: true }, coverages, rules, [], SESSION_ID).find(i => i.id === "gpa-accidental-death")?.status, "not_applicable");
  });
  test("Wording formula must belong to the correct product and benefit", () => {
    const pages = [{ page_number: 2, text: "Group Term Life\nDeath\n100% of Sum Insured\nGroup Personal Accident\nDeath due to Accident\n100% of Sum Insured\nTotal and Permanent Disablement\n150% of Sum Insured" }];
    assert.equal(findDeathRule(pages, "group term life")?.page, 2); assert.match(findDeathRule(pages, "group personal accident")?.quote ?? "", /Death due to Accident/);
    assert.equal(findDeathRule([{ page_number: 1, text: "Group Personal Accident\nDeath due to Accident\nTotal and Permanent Disablement\n100% of Sum Insured" }], "Group Personal Accident"), null);
    assert.equal(findDeathRule([{ page_number: 1, text: "Group Personal Accident\nDeath due to Accident\n100% of Sum Insured" }], "Group Term Life"), null);
  });
  console.log(`DearPolicy event/person/date/death regressions passed (${cases} scenarios).`);
}
