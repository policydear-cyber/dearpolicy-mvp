/**
 * Unit regressions for the V1 chat fix stream (no database, no model):
 *  D1  a follow-up question after a portfolio listing is its own question;
 *  D2  "what does X cover" is a policy question, a genuine what-if stays one;
 *  D3  a reply to ANY open question is recorded (ledger keys included), and
 *      "Not sure" defers that question instead of re-asking it forever;
 *  D3b a new question while a claim question is open is answered as a
 *      policy question; asking what the claim pays stays on the claim;
 *  D4  a generic "Fracture benefit" ledger row matches any fracture;
 *  D5  missing information is described as missing, naming what was asked;
 *  leak: the household failure text names no provider, model or setting;
 *  the approval-language guard in the narration check is a real \b regex.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyExplicitDeferrals, mergeInterpretation, onlyAsksQuestions, type Interpretation } from "@/lib/chat/facts";
import { recordDirectFactAnswer } from "@/lib/claims/fact-finding";
import { describesAScenario } from "@/lib/policies/benefit-catalog";
import { fractureRowMatches } from "@/lib/ledger/events";
import { householdModelFailure, TruncatedModelOutput } from "@/lib/ai/llm";
import { catalogueCoverageAnswer, notInDocuments, readableObservation } from "@/lib/chat/workflow";
import type { CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { injuryFactFindingText } from "@/lib/chat/fact-finding-chat";
import type { ConversationState } from "@/lib/chat/types";
import type { PolicyContract } from "@/lib/policies/inventory";

let cases = 0;
function test(name: string, fn: () => void) { try { fn(); cases++; } catch (e) { console.error("FAIL " + name); throw e; } }
const C = "c1", now = new Date("2026-09-20T10:00:00+08:00");
const quiet = (intent: Interpretation["intent"], extra: Partial<Interpretation> = {}): Interpretation => ({ intent, newTopic: false, searchTerms: [], facts: [], scenarioCandidates: [], ...extra });
const merge = (state: ConversationState, message: string, interpretation: Interpretation) =>
  mergeInterpretation({ state, interpretation, message, subjectIds: [C], subjectNames: { [C]: ["Charmaine"] }, now });
const pendingOf = (factKey: string, type: string, text: string, options?: string[]) =>
  ({ id: "q-" + factKey, text, type, why: "", options, subjectId: C, factKey }) as NonNullable<ConversationState["pending"]>;

test("D1: after a portfolio listing, a new full follow-up question replaces the active query", () => {
  const s0: ConversationState = { subjects: {}, scenarios: {}, intent: "portfolio", activeQuery: "What policies does Charmaine have?" };
  const s1 = merge(s0, "What is her hospital coverage?", quiet("follow_up"));
  assert.equal(s1.intent, "policy_question");
  assert.equal(s1.activeQuery, "What is her hospital coverage?");
  // An elliptical follow-up still inherits.
  const s2 = merge(s0, "And Marcus?", quiet("follow_up"));
  assert.equal(s2.intent, "portfolio");
  // A follow-up to a policy question that is itself a full question is answered as asked.
  const s3 = merge(s1, "Does she have a fracture benefit?", quiet("follow_up"));
  assert.equal(s3.activeQuery, "Does she have a fracture benefit?");
});

test("D2: coverage questions are not what-ifs; real what-ifs still are", () => {
  for (const q of ["What is her hospital coverage?", "What does Marcus's travel policy cover overseas?", "What is the overseas medical cover in Marcus's Voyager plan?", "What is her dental coverage?"])
    assert.equal(describesAScenario(q), false, q);
  for (const q of ["What if she's hospitalised?", "How much would I get if I was hospitalised for 3 nights?", "If Desmond dies in an accident, how much would the payout be?",
    "Could this cover a broken arm?", "Does my policy pay if Charmaine breaks her arm?", "How much can I claim if I fell down and have a bill of $500"])
    assert.equal(describesAScenario(q), true, q);
});

test("D3: bare and question-card replies to ledger questions are recorded; 'Not sure' defers without a value", () => {
  const cases: [string, string, string[] | undefined, string, unknown, string][] = [
    ["surgery", "yes_no", undefined, "Yes", true, "known"],
    ["surgery", "yes_no", undefined, "No.", false, "known"],
    ["surgery", "yes_no", ["Yes", "No", "Not sure"], "Was surgery performed: Yes", true, "known"],
    ["surgery", "yes_no", undefined, "Was surgery performed: Not sure", null, "pending"],
    ["outOfPocket", "text", ["Not sure"], "How much did the treatment cost: S$1,200", 1200, "known"],
    ["outOfPocket", "text", ["Not sure"], "Not sure", null, "pending"],
    ["icuNights", "text", undefined, "3 nights", 3, "known"],
  ];
  for (const [key, type, options, message, value, state] of cases) {
    const subjects: ConversationState["subjects"] = { [C]: {} };
    const recorded = recordDirectFactAnswer({ message, subjects, subjectIds: [C], now, pending: { factKey: key, subjectId: C, type, options } });
    assert.equal(recorded, true, message);
    assert.equal(subjects[C][key]?.value, value, message);
    assert.equal(subjects[C][key]?.state, state, message);
  }
  // Anything else is left to the interpreter, not guessed.
  const subjects: ConversationState["subjects"] = { [C]: {} };
  assert.equal(recordDirectFactAnswer({ message: "She also hurt her leg", subjects, subjectIds: [C], now, pending: { factKey: "surgery", subjectId: C, type: "yes_no" } }), false);
  assert.equal(subjects[C].surgery, undefined);
});

test("D3: 'Not sure' to the open cost question defers THAT key (not hospitalBill)", () => {
  const s: ConversationState = { subjects: { [C]: {} }, scenarios: {}, intent: "claim", pending: pendingOf("outOfPocket", "text", "How much did the treatment cost?") };
  const next = applyExplicitDeferrals(s, "How much did the treatment cost: Not sure", [C], now);
  assert.equal(next.subjects[C].outOfPocket?.state, "pending");
  assert.equal(next.subjects[C].hospitalBill, undefined);
  // A longer free-text deferral about a different quantity keeps its own key.
  const s2: ConversationState = { ...s, pending: pendingOf("eventDate", "date", "When did it happen?") };
  const n2 = applyExplicitDeferrals(s2, "I don't know how many nights yet", [C], now);
  assert.equal(n2.subjects[C].hospitalNights?.state, "pending");
});

test("D3b: a new question mid-claim is a policy question; asking what the claim pays stays on the claim", () => {
  const s: ConversationState = { subjects: { [C]: { injured: { value: true, state: "known", quote: "x", source: "user", recordedAt: now.toISOString() } } }, scenarios: {},
    intent: "claim", activeQuery: "Charmaine broke her arm.", activeClaimQuery: "Charmaine broke her arm.", pending: pendingOf("eventLocation", "choice", "Where did the accident happen?", ["Singapore", "Overseas"]) };
  const aside = merge(s, "What is her dental coverage?", quiet("follow_up"));
  assert.equal(aside.intent, "policy_question");
  assert.equal(aside.activeQuery, "What is her dental coverage?");
  assert.equal(aside.subjects[C].injured?.value, true, "claim facts are kept");
  const money = merge(s, "How much can she claim?", quiet("follow_up"));
  assert.equal(money.intent, "claim");
  assert.equal(money.activeQuery, "Charmaine broke her arm.");
  // A question the interpreter mislabels as a claim reports nothing.
  const labelled = merge({ subjects: {}, scenarios: {} }, "What does Marcus's travel policy cover overseas?",
    quiet("claim", { facts: [{ subjectId: C, key: "eventType", value: "travel_disruption", state: "known", quote: "What does Marcus's travel policy cover overseas?" }] }));
  assert.equal(labelled.intent, "policy_question");
  assert.equal(labelled.subjects[C]?.eventType, undefined);
  // A report followed by a question is still a report.
  assert.equal(onlyAsksQuestions("My wife's flight was delayed. Could any policy help?"), false);
  assert.equal(onlyAsksQuestions("When did it happen: 2026-09-18"), false);
});

test("D4: a generic fracture row applies to any fracture; a body-part row still filters", () => {
  assert.equal(fractureRowMatches("Fracture benefit", "arm"), true);
  assert.equal(fractureRowMatches("Fractures", "left wrist"), true);
  assert.equal(fractureRowMatches("Fracture of leg", "arm"), false);
  assert.equal(fractureRowMatches("Fracture of arm, leg or hip", "arm"), true);
  assert.equal(fractureRowMatches("Fracture of femur", "arm"), false);
});

const contract = (name: string, category: string) => ({ id: name, name, ownerId: C, ownerName: "Ong Pei Lin Charmaine", coverages: [{ category, productName: name }] }) as unknown as PolicyContract;
const charmaine = { id: C, display_name: "Ong Pei Lin Charmaine", preferred_name: "Charmaine", relationship: "spouse" };
test("D5: 'not stated' only after a complete read with nothing stored; a partial read never asserts absence; no pronouns handed back", () => {
  const partial = notInDocuments({ question: "What is her dental coverage?", people: [charmaine], contracts: [contract("SafeCare Hospital Plan", "Hospital Cash")], complete: false, pagesRead: 6, pagesTotal: 9 });
  // V1.1: page counts are DearPolicy's own reading progress, not household text (eval internal_text).
  assert.match(partial, /^DearPolicy didn’t find dental cover in the parts of Charmaine’s policy read so far\./);
  assert.doesNotMatch(partial, /\d+ of \d+/);
  assert.doesNotMatch(partial, /isn’t stated|not stated|her dental/);
  const complete = notInDocuments({ question: "What is her dental coverage?", people: [charmaine], contracts: [contract("SafeCare Hospital Plan", "Hospital Cash")], complete: true });
  assert.match(complete, /^Charmaine’s uploaded policy \(SafeCare Hospital Plan\) doesn’t mention dental cover\. Every page was read, so it isn’t stated in your documents/);
  assert.match(notInDocuments({ question: "What is the waiting period for her hospital plan?", people: [charmaine], contracts: [contract("SafeCare Hospital Plan", "Hospital Cash")], complete: true }), /doesn’t mention a waiting period\./);
  const none = notInDocuments({ question: "What does Marcus's travel policy cover overseas?", people: [{ id: "m", display_name: "Marcus Lim", preferred_name: "Marcus", relationship: "self" }],
    contracts: [contract("SteadySave Endowment 20", "Savings")], complete: true });
  assert.match(none, /^You have no travel policy on file/);
  assert.doesNotMatch(none, /not covered|no cover\b/i);
});

const stored = (id: string, policyId: string, benefitName: string, quote: string, formulaKind: string, formulaValue: number | null, currency: string | null) =>
  ({ id, policyId, productName: null, benefitName, traits: [], formulaKind, formulaValue, currency, factKey: null, offsetDays: null, maximumDays: null,
    sourcePage: 2, quote, conditions: [], requirements: [], needsReview: false }) as unknown as CatalogBenefit;
const scheduleContract = (id: string, name: string, owner = C) => ({ id, name, ownerId: owner, ownerName: "Ivy Tan", insurer: null, confirmed: true, ownershipBasis: "evidence",
  documents: [{ id: id + "-doc" }], references: [], coverages: [] }) as unknown as PolicyContract;
test("Coverage questions: stored rows on the topic, one line and one page citation each; limits keep the printed currency; nothing summed", () => {
  const hospital = scheduleContract("h", "HospitalShield"), accident = scheduleContract("a", "AccidentGuard"), travel = scheduleContract("t", "WanderSafe");
  const catalog = [
    stored("1", "h-doc", "Daily room and board (1-bed private ward)", "Daily room and board (1-bed private ward) S$800 per day, maximum 120 days", "daily", 800, "SGD"),
    stored("2", "h-doc", "Surgical fees", "Surgical fees Up to S$25,000 per surgery", "expense_cap", 25000, "SGD"),
    stored("3", "a-doc", "Fracture of arm", "Fracture of arm S$1,000", "fixed", 1000, "SGD"),
    stored("4", "a-doc", "Surgical benefit", "Surgical benefit S$500 if surgery is performed", "fixed", 500, "SGD"),
    stored("5", "t-doc", "Overseas medical expenses", "Overseas medical expenses US$250,000", "fixed", 250000, "USD"),
    stored("6", "t-doc", "Emergency medical evacuation", "Emergency medical evacuation USD 500,000", "fixed", 500000, "USD"),
    stored("7", "a-doc", "Loss of arm at or above the elbow", "Loss of arm at or above the elbow 100% of Sum Insured", "sum_insured", 1, null),
  ];
  const ivy = { id: C, display_name: "Ivy Tan", preferred_name: "Ivy", relationship: "spouse" };
  const h = catalogueCoverageAnswer({ question: "What is her hospital coverage?", people: [ivy], contracts: [hospital, accident], catalog })!;
  assert.deepEqual(h.lines, ["HospitalShield — Daily room and board (1-bed private ward) (page 2)", "HospitalShield — Surgical fees (page 2)"], "an accident plan's surgical row is not hospital cover");
  assert.equal(h.citations.length, 2);
  assert.deepEqual(h.limits.map((l) => l.amountText), ["S$25,000"], "a per-day rule is not a stated limit; the capped one is");
  const f = catalogueCoverageAnswer({ question: "Does she have a fracture benefit?", people: [ivy], contracts: [hospital, accident], catalog })!;
  assert.deepEqual(f.lines, ["AccidentGuard — Fracture of arm (page 2)"], "fracture is not permanent loss");
  const t = catalogueCoverageAnswer({ question: "What does Ken's travel policy cover overseas?", people: [ivy], contracts: [travel], catalog })!;
  assert.deepEqual(t.limits.map((l) => [l.benefitTitle, l.currency, l.amount]), [["Overseas medical expenses", "USD", 250000], ["Emergency medical evacuation", "USD", 500000]]);
  assert.equal(catalogueCoverageAnswer({ question: "What is her dental coverage?", people: [ivy], contracts: [hospital, accident], catalog })!.lines.length, 0);
  assert.equal(catalogueCoverageAnswer({ question: "What is the waiting period for her hospital plan?", people: [ivy], contracts: [hospital], catalog })!.lines.length, 0, "a policy term is not a coverage listing");
});
test("A passage shown to a person is never a raw page dump", () => {
  const dump = "Schedule of Benefits - Travel Overseas medical expenses US$250,000 Emergency medical evacuation USD 500,000 Trip cancellation S$5,000 Baggage delay S$200 for every 6 hours " +
    "Terms apply to every benefit listed in this schedule and to every claim made under it. ".repeat(3) + "SYNTHETIC TEST DOCUMENT - NOT A REAL INSURANCE POLICY Page 2 of 3";
  const shown = readableObservation(dump);
  assert.ok(shown.length <= 281, "capped: " + shown.length);
  assert.doesNotMatch(shown, /SYNTHETIC|Page \d+ of \d+/);
});

test("D8: the injury lead uses the name the family uses", () => {
  const text = injuryFactFindingText({ person: charmaine, facts: {}, candidateNames: [], permanentLossOnFile: false });
  assert.match(text.summary, /^I’m sorry Charmaine is dealing with this\./);
  assert.doesNotMatch(text.summary, /Ong Pei Lin/);
});

test("Leak: household failure text names no provider, model, key or setting", () => {
  const errors = [new Error("Model request failed (403): API key not valid. Please pass a valid API key."), new Error("Model request failed (404): models/gpt-6-luna is not found"),
    new Error("chat timed out after 150 seconds"), new Error("Model request failed (429): quota"), new Error("fetch failed"), new Error("x"),
    new Error("Vertex AI API has not been used in project 123 before or it is disabled. Enable it"), new TruncatedModelOutput("x", "raw", true)];
  for (const e of errors) {
    const text = householdModelFailure(e);
    assert.doesNotMatch(text, /openai|google|anthropic|gemini|gpt|claude|groq|api key|environment|hosting|console|project \d|MODEL_|_KEY|http/i, text);
  }
});

test("The narration approval guard is a real word-boundary regex", () => {
  const source = readFileSync("lib/chat/workflow.ts", "utf8");
  assert.equal(/\x08/.test(source), false, "no raw backspace characters in workflow.ts");
  assert.match(source, /\/\\b\(\?:approved\|definitely\|guaranteed\|will receive\|will pay\|entitled\)\\b\/i/);
});

console.log(`v1 chat fix regressions: ${cases} passed`);
