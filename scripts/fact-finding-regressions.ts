/**
 * Deterministic fact-finding (lib/claims/fact-finding.ts, lib/chat/fact-finding-chat.ts).
 * Every blocked state has a positive control; every scenario is run repeatedly.
 */
import assert from "node:assert/strict";
import { categoriesFor, conditionDrivenQuestions, FACT_FINDING_SPECS, planFactFinding, recordDirectFactAnswer, type FactFindingCategory } from "@/lib/claims/fact-finding";
import { applyFactFinding } from "@/lib/chat/fact-finding-chat";
import type { ConversationFact, ConversationState, SubjectFacts } from "@/lib/chat/types";
import type { ChatAnswer } from "@/types";

let cases = 0;
function test(name: string, fn: () => void) { try { for (let i = 0; i < 3; i++) fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } }
const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 9, minute)).toISOString();
const fact = (value: ConversationFact["value"], minute = 0, state: ConversationFact["state"] = "known"): ConversationFact => ({ value, state, quote: String(value), recordedAt: at(minute), source: "user" });
const MONEY = /(?:S\$|US\$|SGD|USD|\$)\s?\d/;
const plan = (category: FactFindingCategory, facts: SubjectFacts, extra: Partial<Parameters<typeof planFactFinding>[0]> = {}) => planFactFinding({ subjectId: "p1", category, facts, ...extra });
const allFacts = (category: FactFindingCategory, minute = 0): SubjectFacts => Object.fromEntries(FACT_FINDING_SPECS[category].facts.map((f) => [f.key, fact(f.type === "yes_no" ? true : f.key === "travelEventType" ? "Flight delay" : f.key === "eventType" ? "accident" : f.type === "date" ? "2026-08-01" : "x", minute)]));
const allDocs = (category: FactFindingCategory) => FACT_FINDING_SPECS[category].documents.map((d) => ({ type: d.type, reviewed: true }));
const allMatches = (category: FactFindingCategory) => Object.fromEntries(FACT_FINDING_SPECS[category].reviewers.map((r) => [r.key, "matches" as const]));

test("a vague enquiry opens no category and no plan", () => {
  assert.deepEqual(categoriesFor(new Set(), {}), []);
});
test("\"How much can I claim?\" after a hospital stay: information needed, one coherent group of questions, no amount", () => {
  const cats = categoriesFor(new Set(["hospitalisation"]), {});
  assert.deepEqual(cats, ["medical_reimbursement", "hospital_cash"]);
  const p = plan("hospital_cash", {});
  assert.equal(p.status, "information_needed");
  assert.deepEqual(p.nextQuestions.map((q) => q.factKey), ["admissionDate", "dischargeDate"], "group 1 only");
  assert.equal(p.readyForEvidenceGatedEstimate, false);
  assert.doesNotMatch(JSON.stringify(p), MONEY);
});
test("known, current facts are never asked again; the next group follows", () => {
  const p = plan("critical_illness", { diagnosis: fact("breast cancer stage 2"), diagnosisDate: fact("2026-07-02") });
  assert.ok(!p.nextQuestions.some((q) => ["diagnosis", "diagnosisDate"].includes(q.factKey)));
  assert.deepEqual(p.nextQuestions.map((q) => q.factKey), ["diagnosedBySpecialist"]);
});
test("conflicting answers are asked again, naming the conflict; one consistent answer clears it (control)", () => {
  const p = plan("accidental_death", { deathDate: fact("2026-08-01", 1), dateOfDeath: fact("2026-08-03", 2) });
  assert.ok(p.conflictingFacts.includes("deathDate"));
  assert.match(p.nextQuestions[0].text, /two different answers/);
  const ok = plan("accidental_death", { deathDate: fact("2026-08-01", 1), dateOfDeath: fact("2026-08-01", 2) });
  assert.ok(!ok.conflictingFacts.length);
});
test("a changed event date makes dependent answers stale; answering after the change is current (control)", () => {
  const stale = plan("critical_illness", { diagnosis: fact("cancer", 0), diagnosisDate: fact("2026-07-02", 5), diagnosedBySpecialist: fact(true, 1), survivedSurvivalPeriod: fact(true, 2) });
  assert.ok(stale.staleFacts.includes("survivedSurvivalPeriod"));
  assert.ok(stale.missingFacts.includes("survivedSurvivalPeriod"));
  const fresh = plan("critical_illness", { diagnosis: fact("cancer", 0), diagnosisDate: fact("2026-07-02", 1), diagnosedBySpecialist: fact(true, 2), survivedSurvivalPeriod: fact(true, 3) });
  assert.deepEqual(fresh.staleFacts, []);
  assert.equal(fresh.status, "evidence_needed");
});
test("an uncertain cause or diagnosis is not accepted as known", () => {
  const p = plan("accidental_death", { deathDate: fact("2026-08-01"), causeOfDeath: fact("not sure", 1, "unknown") });
  assert.ok(p.uncertainFacts.includes("causeOfDeath"));
  assert.ok(p.missingFacts.includes("causeOfDeath"));
  assert.equal(p.status, "information_needed");
});
test("every category: missing documents -> evidence needed -> reviewer -> ready only when all pass (positive control)", () => {
  for (const category of Object.keys(FACT_FINDING_SPECS) as FactFindingCategory[]) {
    const facts = allFacts(category);
    assert.equal(plan(category, facts).status, "evidence_needed", category);
    const reviewed = plan(category, facts, { documents: allDocs(category) });
    assert.equal(reviewed.status, FACT_FINDING_SPECS[category].reviewers.length ? "reviewer_assessment_needed" : "ready_for_evidence_gated_estimate", category);
    const ready = plan(category, facts, { documents: allDocs(category), reviewerDecisions: allMatches(category) });
    assert.equal(ready.status, "ready_for_evidence_gated_estimate", category);
    assert.equal(ready.readyForEvidenceGatedEstimate, true);
    const unreviewed = plan(category, facts, { documents: allDocs(category).map((d) => ({ ...d, reviewed: false })), reviewerDecisions: allMatches(category) });
    assert.equal(unreviewed.status, "evidence_needed", `${category}: an unreviewed document does not count`);
    const conditions = plan(category, facts, { documents: allDocs(category), reviewerDecisions: allMatches(category), unresolvedPolicyConditions: ["waiting period"] });
    assert.equal(conditions.status, "policy_condition_unresolved", category);
  }
});
test("a negative reviewer decision keeps the claim blocked", () => {
  const p = plan("critical_illness", allFacts("critical_illness"), { documents: allDocs("critical_illness"), reviewerDecisions: { ci_definition_match: "does_not_match" } });
  assert.equal(p.readyForEvidenceGatedEstimate, false);
  assert.ok(p.blockedReasons.some((r) => /does not meet/.test(r)));
});
test("a family member trying to force an amount: recorded as reported, never used, never changes readiness", () => {
  const facts = { ...allFacts("medical_reimbursement"), expectedPayout: fact(100000), hospitalBill: fact("USD 4000"), outOfPocket: fact("SGD 500") };
  const p = plan("medical_reimbursement", facts);
  assert.deepEqual(p.reportedAmountsIgnored.sort(), ["expectedPayout", "hospitalBill", "outOfPocket"].sort());
  assert.equal(p.status, "evidence_needed");
  assert.doesNotMatch(JSON.stringify({ q: p.nextQuestions, b: p.blockedReasons, d: p.missingDocuments }), MONEY, "no figure, no conversion, no total");
});
test("travel: the delay question is asked only for a delay, and the event date goes stale when the trip dates change", () => {
  const base = { tripStartDate: fact("2026-08-01", 0), tripEndDate: fact("2026-08-09", 0), travelEventType: fact("Medical treatment abroad", 1), eventDate: fact("2026-08-03", 1) };
  assert.ok(!plan("travel", base).nextQuestions.some((q) => q.factKey === "delayHours"));
  const delay = plan("travel", { ...base, travelEventType: fact("Flight delay", 1) });
  assert.ok(delay.nextQuestions.some((q) => q.factKey === "delayHours"));
  const moved = plan("travel", { ...base, tripStartDate: fact("2026-08-02", 5) });
  assert.ok(moved.staleFacts.includes("eventDate"));
});
test("condition-driven questions come only from the household's own stored exclusions", () => {
  const conditions = [
    { kind: "exclusion", cause: "alcohol_or_drugs", appliesToEvents: ["death"] },
    { kind: "exclusion", cause: "racing", appliesToEvents: [] },
    { kind: "exclusion", cause: "pregnancy", appliesToEvents: ["death"] }, // no question mapped
    { kind: "exclusion", cause: "suicide", appliesToEvents: ["death"] }, // sensitive: never asked, the coroner's report answers it
    { kind: "waiting_period", cause: "alcohol_or_drugs", appliesToEvents: ["death"] }, // not an exclusion
    { kind: "exclusion", cause: "hazardous_sport", appliesToEvents: ["travel"] }, // different event scope
  ];
  const qs = conditionDrivenQuestions({ category: "accidental_death", conditions, facts: {} });
  assert.deepEqual(qs.map((q) => q.factKey).sort(), ["alcoholOrDrugsInvolved", "hazardousActivity"]);
  assert.ok(qs.every((q) => q.type === "yes_no"));
  assert.ok(!JSON.stringify(qs).includes("suicide"), "sensitive causes are never turned into questions");
  assert.doesNotMatch(JSON.stringify(qs), MONEY);
});
test("a condition question already answered is not asked again; no exclusions means no questions", () => {
  const conditions = [{ kind: "exclusion", cause: "alcohol_or_drugs", appliesToEvents: ["death"] }];
  const answered = conditionDrivenQuestions({ category: "accidental_death", conditions, facts: { alcoholOrDrugsInvolved: fact(false) } });
  assert.deepEqual(answered, []);
  assert.deepEqual(conditionDrivenQuestions({ category: "accidental_death", conditions: [], facts: {} }), []);
});
test("accidental death now requires where it happened, alongside cause and circumstances", () => {
  const p = plan("accidental_death", { deathDate: fact("2026-08-01") });
  assert.deepEqual(p.nextQuestions.map((q) => q.factKey).sort(), ["accidentCircumstances", "causeOfDeath", "eventLocation"]);
  assert.ok(p.nextQuestions.find((q) => q.factKey === "eventLocation")!.text.includes("Singapore"));
});

test("a card answer in Question: answer form is recorded deterministically against its fact", () => {
  const subjects: Record<string, ReturnType<typeof allFacts>> = { a: {} };
  const scenarios = { a: [{ family: "death", traits: ["death", "accident"] }] };
  const ok = recordDirectFactAnswer({ message: "What does the death certificate give as the cause of death: natural death",
    subjects, subjectIds: ["a"], scenarios, now: new Date(Date.UTC(2026, 8, 1)) });
  assert.equal(ok, true);
  assert.equal(subjects.a.causeOfDeath?.value, "natural death");
  assert.equal(subjects.a.causeOfDeath?.state, "known");
  const p = plan("accidental_death", subjects.a);
  assert.ok(!p.nextQuestions.some((q) => q.factKey === "causeOfDeath"), "an answered question is never asked again");
});
test("yes/no/not-sure card answers map to boolean or a tracked uncertainty; unknown text records nothing", () => {
  const subjects: Record<string, ReturnType<typeof allFacts>> = { a: {} };
  const scenarios = { a: [{ family: "death", traits: ["death"] }] };
  const now = new Date(Date.UTC(2026, 8, 1));
  assert.equal(recordDirectFactAnswer({ message: "Did it happen during motor racing or speed trials: No", subjects, subjectIds: ["a"], scenarios, now }), true);
  assert.equal(subjects.a.hazardousActivity?.value, false);
  assert.equal(recordDirectFactAnswer({ message: "Was alcohol or drug use involved in the incident: Not sure", subjects, subjectIds: ["a"], scenarios, now }), true);
  assert.equal(subjects.a.alcoholOrDrugsInvolved?.value, "not sure");
  assert.equal(recordDirectFactAnswer({ message: "An earlier answer changed, so please confirm again: On what date did they pass away: 2026-08-15", subjects, subjectIds: ["a"], scenarios, now }), true);
  assert.equal(subjects.a.deathDate?.value, "2026-08-15");
  assert.equal(recordDirectFactAnswer({ message: "my neighbour said something: hello", subjects, subjectIds: ["a"], scenarios, now }), false);
  assert.equal(recordDirectFactAnswer({ message: "what can we claim?", subjects, subjectIds: ["a"], scenarios, now }), false);
});

async function atest(name: string, fn: () => Promise<void>) { try { for (let i = 0; i < 3; i++) await fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } }
async function chatCases() {
  await atest("chat: several family members each get their own plans; an ordinary policy question gets none", async () => {
    const state: ConversationState = { intent: "claim", subjects: { a: { deathDate: fact("2026-08-01") }, b: { admissionDate: fact("2026-08-02") } },
      scenarios: { a: [{ label: "death", family: "death", traits: ["death", "accident"] }], b: [{ label: "stay", family: "hospitalisation", traits: ["hospitalisation"] }] } } as unknown as ConversationState;
    const answer = { mode: "claim_assessment", summary: "", details: [], claimItems: [], nextSteps: [], questions: [], missingFacts: [] } as unknown as ChatAnswer;
    await applyFactFinding(answer, state, [{ id: "a", display_name: "A" }, { id: "b", display_name: "B" }]);
    const plans = answer.factFinding ?? [];
    assert.deepEqual(plans.map((p) => `${p.subjectName}:${p.category}`), ["A:accidental_death", "B:medical_reimbursement", "B:hospital_cash"]);
    assert.ok(!plans[0].nextQuestions.some((q) => q.factKey === "deathDate"), "A's date of death is known");
    const policyQuestion = { ...answer, mode: "answer" } as ChatAnswer;
    await applyFactFinding(policyQuestion, { ...state, intent: "policy_question" }, [{ id: "a", display_name: "A" }], { question: "What is the waiting period for critical illness?" });
    assert.equal(policyQuestion.factFinding, undefined);
  });
  await atest("chat: a message that DESCRIBES an event gets the questions even when the intent classifier missed it", async () => {
    const state: ConversationState = { intent: "policy_question", subjects: { a: {} },
      scenarios: { a: [{ label: "death", family: "death", traits: ["death", "accident"] }] } } as unknown as ConversationState;
    const answer = { mode: "answer", summary: "", details: [], claimItems: [], nextSteps: [], questions: [], missingFacts: [] } as unknown as ChatAnswer;
    await applyFactFinding(answer, state, [{ id: "a", display_name: "A" }], { question: "Desmond died in a car accident, what can be claimed?" });
    const plans = answer.factFinding ?? [];
    assert.equal(plans[0]?.category, "accidental_death");
    assert.ok(plans[0].nextQuestions.length > 0, "the deciding questions are asked");
  });
}

chatCases().then(() => {
  console.log(`fact-finding regressions passed: ${cases} cases (each run 3 times).`);
}).catch((error) => { console.error(error); process.exitCode = 1; });
