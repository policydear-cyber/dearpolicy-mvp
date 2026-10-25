/**
 * Adversarial injury-chat regressions (Agent D). Encodes the SPEC for the
 * "Josephine broke her arm" -> "An accident." defect independently of the
 * implementation agents' own suites. Synthetic fixtures only: no database,
 * network or hosted model. The conversation is driven through the same pure
 * pipeline runChatWorkflow uses for a turn (mergeInterpretation ->
 * applyExplicitDeferrals -> recordDirectFactAnswer -> eventTraits ->
 * reportedClaimEvents -> assessContractFromCatalog -> categoriesFor ->
 * planFactFinding), with the repo's deterministic model stand-in
 * (lib/ai/deterministic-model.ts deterministicInterpretation) or an explicit
 * adversarial model reply standing in for the hosted interpreter.
 * runChatWorkflow itself needs a database, so workflow-only wording
 * (the "Not applicable here" line, rule-count sentence) is checked in its source.
 *
 * Run: node --import tsx scripts/injury-chat-adversarial-regressions.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as Facts from "@/lib/chat/facts";
import { applyExplicitDeferrals, factLabels, knownValue, mergeInterpretation, type Interpretation } from "@/lib/chat/facts";
import * as Catalog from "@/lib/policies/benefit-catalog";
import { assessContractFromCatalog, benefitTraits, eventTraits, matchBenefits, requiredTraits, type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import * as FactFinding from "@/lib/claims/fact-finding";
import { categoriesFor, planFactFinding, recordDirectFactAnswer } from "@/lib/claims/fact-finding";
import { reportedClaimEvents } from "@/lib/insurance/claim-events";
import * as FactFindingChat from "@/lib/chat/fact-finding-chat";
import { describesAScenario } from "@/lib/policies/benefit-catalog";
import { deterministicInterpretation } from "@/lib/ai/deterministic-model";
import { enforceChatMonetarySafety } from "@/lib/claims/monetary-gate";
import { containsMoney, enforceLiveChatMonetaryBoundary, liveClaimContext } from "@/lib/chat/monetary-boundary";
import type { ConversationState, ScenarioTrait, SubjectFacts } from "@/lib/chat/types";
import type { InventoryDocument, PolicyContract } from "@/lib/policies/inventory";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ChatAnswer, ClaimItem } from "@/types";

// ------------------------------------------------------------------ harness
const realLog = console.log.bind(console);
console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && args[0].startsWith("[telemetry]")) return; realLog(...args); };
console.debug = () => undefined;
const results: { label: string; ok: boolean; message?: string }[] = [];
function test(label: string, fn: () => void) {
  try { fn(); results.push({ label, ok: true }); }
  catch (error) {
    const e = error as Error;
    results.push({ label, ok: false, message: (e.message || String(e)).split("\n").slice(0, 6).join(" | ") });
  }
}
const NOW = new Date("2026-09-28T02:00:00.000Z");
const JOSEPHINE = "fm-josephine", BOB = "fm-bob";
const PEOPLE: Record<string, string> = { [JOSEPHINE]: "Josephine", [BOB]: "Bob" };
const LOSS_OF_ARM_NAME = "Loss of arm (at shoulder, between shoulder and elbow, at elbow, between elbow and wrist)";
const RAW_LOSS = /loss of arm/i;

// ------------------------------------------------------------------ fixtures
function doc(id: string, members: string[]): InventoryDocument {
  return {
    id, insurer: "Synthetic Insurer", product_name: "SYNTHETIC Personal Accident", policy_number: "SYN-" + id, group_policy_number: null,
    policy_type: "personal_accident", document_role: "certificate", personal_coverage_confirmed: true, document_authority: 90,
    needs_review: false, processing_status: "ready", original_filename: id + ".pdf", updated_at: "2026-01-01T00:00:00.000Z",
    effective_date: "2020-01-01", renewal_or_expiry_date: null, member_ids: members, products: ["SYNTHETIC Personal Accident"], header: "", page_total: 1, chunk_total: 1,
  };
}
function coverage(id: string, policyId: string, member: string): OwnedCoverage {
  return {
    id, policyId, familyMemberId: member, category: "Personal Accident", amount: 100_000, currency: "SGD",
    productName: "SYNTHETIC Personal Accident", sourcePage: 1, evidenceText: "Sum Insured: S$100,000", insurer: "Synthetic Insurer",
    policyName: "SYNTHETIC Personal Accident", policyNumber: "SYN-" + policyId, groupPolicyNumber: null, documentRole: "certificate",
    effectiveDate: "2020-01-01", renewalOrExpiryDate: null, currencyVerified: true,
  } as OwnedCoverage;
}
function contract(owner: string, docId: string, ownershipBasis: "evidence" | "declared" = "evidence"): PolicyContract {
  return {
    id: "contract-" + owner + "-" + docId, ownerId: owner, ownerName: PEOPLE[owner], name: "SYNTHETIC Personal Accident", insurer: "Synthetic Insurer",
    documents: [doc(docId, [owner])], references: [], coverages: ownershipBasis === "evidence" ? [coverage("cov-" + owner + "-" + docId, docId, owner)] : [],
    confirmed: true, effectiveDate: "2020-01-01", ownershipBasis,
  };
}
function benefit(policyId: string, benefitName: string, quote: string, extra: Partial<CatalogBenefit>): CatalogBenefit {
  return {
    id: policyId + ":" + benefitName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), policyId, productName: "SYNTHETIC Personal Accident", benefitName,
    traits: benefitTraits(benefitName, quote), requires: requiredTraits(benefitName, quote),
    formulaKind: "none", formulaValue: null, currency: "SGD", factKey: null, offsetDays: null, maximumDays: null,
    sourcePage: 4, quote, conditions: [], requirements: [], needsReview: false, ...extra,
  };
}
function catalogFor(policyId: string): CatalogBenefit[] {
  return [
    benefit(policyId, LOSS_OF_ARM_NAME, LOSS_OF_ARM_NAME + " 100% of Sum Insured", { formulaKind: "sum_insured", formulaValue: 1 }),
    benefit(policyId, "Fracture of arm", "Fracture of arm: S$1,000", { formulaKind: "fixed", formulaValue: 1000 }),
    benefit(policyId, "Fractures", "Fractures (simple): S$500 per fracture", { formulaKind: "fixed", formulaValue: 500 }),
    benefit(policyId, "Accident medical reimbursement", "Accident medical reimbursement: medical expenses for bodily injury caused by an accident, up to S$2,000", {
      formulaKind: "expense_cap", formulaValue: 2000, factKey: "hospitalBill" }),
  ];
}
const DOC_C = "doc-pa-josephine", DOC_B = "doc-pa-bob";
const CATALOG = [...catalogFor(DOC_C), ...catalogFor(DOC_B)];

// ------------------------------------------------------------ pipeline turn
type Fact = Interpretation["facts"][number];
type Model = (message: string, state: ConversationState, subjectIds: string[]) => Interpretation;
/** The repo's deterministic model stand-in, unchanged. */
const stub: Model = (message, state, subjectIds) =>
  deterministicInterpretation({ currentMessage: message, subjects: subjectIds.map(id => ({ id })), previousIntent: state.intent ?? null }) as Interpretation;
/** The stand-in plus extra model facts/scenarios a real model plausibly returns. */
function withModel(extra: { facts?: Fact[]; scenarioCandidates?: Interpretation["scenarioCandidates"]; intent?: Interpretation["intent"]; newTopic?: boolean }): Model {
  return (message, state, subjectIds) => {
    const base = stub(message, state, subjectIds);
    return { ...base, ...(extra.intent ? { intent: extra.intent } : {}), ...(extra.newTopic != null ? { newTopic: extra.newTopic } : {}),
      facts: [...base.facts, ...(extra.facts ?? [])], scenarioCandidates: [...(base.scenarioCandidates ?? []), ...(extra.scenarioCandidates ?? [])] };
  };
}
const mf = (subjectId: string, key: string, value: Fact["value"], quote: string): Fact => ({ subjectId, key, value, state: "known", quote });

type TurnResult = { state: ConversationState; nextQuestion: FactFindingQuestionLike | null; questionCount: number; categories: string[];
  perContract: { contract: PolicyContract; assessed: ReturnType<typeof assessContractFromCatalog> }[]; planJson: string; answer: ChatAnswer };
type FactFindingQuestionLike = { factKey: string; text: string; type: string; options?: string[] };

function blankAnswer(): ChatAnswer {
  return { mode: "answer", summary: "", details: [], claimItems: [], nextSteps: [], confidence: "insufficient_evidence", citations: [], disclaimer: "",
    claimSessionId: null, questions: [], knownFacts: [], missingFacts: [] } as ChatAnswer;
}
function turn(prior: ConversationState, message: string, opts: { subjectIds?: string[]; model?: Model; contracts?: PolicyContract[] } = {}): TurnResult {
  const subjectIds = opts.subjectIds ?? [JOSEPHINE];
  const model = opts.model ?? stub;
  const pendingBefore = prior.pending ?? null;
  let state = mergeInterpretation({ state: structuredClone(prior), interpretation: model(message, prior, subjectIds), message, subjectIds,
    subjectNames: Object.fromEntries(subjectIds.map(id => [id, [PEOPLE[id]]])), now: NOW, timeZone: "Asia/Singapore" });
  state = applyExplicitDeferrals(state, message, subjectIds, NOW);
  (recordDirectFactAnswer as (a: unknown) => boolean)({ message, subjects: state.subjects, subjectIds, scenarios: state.scenarios, now: NOW, pending: pendingBefore });
  const contracts = opts.contracts ?? [contract(JOSEPHINE, DOC_C)];
  const perContract = contracts.map(c => {
    const facts = state.subjects[c.ownerId] ?? {};
    const traits = eventTraits(facts, (state.scenarios?.[c.ownerId] ?? []).flatMap(s => s.traits));
    const diagnosis = knownValue(facts, "diagnosis");
    const events = reportedClaimEvents(facts, traits, typeof diagnosis === "string" && diagnosis.trim() ? [diagnosis.trim()] : []);
    return { contract: c, assessed: assessContractFromCatalog({ contract: c, catalog: CATALOG, facts, traits, events }) };
  });
  let nextQuestion: FactFindingQuestionLike | null = null, questionCount = 0;
  const categories: string[] = [];
  const plans: unknown[] = [];
  for (const id of subjectIds) {
    const facts = state.subjects[id] ?? {};
    const signals = new Set<string>((state.scenarios?.[id] ?? []).flatMap(s => [...s.traits, s.family]));
    for (const category of categoriesFor(signals, facts)) {
      categories.push(id + ":" + category);
      const plan = planFactFinding({ subjectId: id, category, facts });
      plans.push(plan);
      if (!nextQuestion && plan.nextQuestions.length) { nextQuestion = plan.nextQuestions[0]; questionCount = plan.nextQuestions.length; state.pending = { ...plan.nextQuestions[0], id: "q-" + plan.nextQuestions[0].factKey, subjectId: id, factKey: plan.nextQuestions[0].factKey } as ConversationState["pending"]; }
    }
  }
  if (!nextQuestion) delete state.pending;
  const answer = blankAnswer();
  const people = subjectIds.map(id => ({ id, display_name: PEOPLE[id], relationship: "child" }));
  // The workflow's own injury step (lib/chat/workflow.ts): when a claim turn
  // has an open injury question for someone with cover on file, the answer IS
  // that question, built by applyInjuryFactFindingTurn from the compatible
  // candidates. Driven through the exported helpers, not a re-implementation.
  const FFC = FactFindingChat as unknown as {
    nextInjuryQuestion?: (s: ConversationState, p: typeof people) => { subjectId: string; question: FactFindingQuestionLike & { id: string; why: string } } | null;
    applyInjuryFactFindingTurn?: (a: unknown) => unknown; PERMANENT_LOSS?: RegExp };
  const whatIf = !(state.subjects[subjectIds[0]] && Object.keys(state.subjects[subjectIds[0]]).length) && describesAScenario(message);
  const injuryCandidate = state.intent === "claim" && !whatIf && FFC.nextInjuryQuestion ? FFC.nextInjuryQuestion(state, people) : null;
  const injuryNext = injuryCandidate && contracts.some(c => c.ownerId === injuryCandidate.subjectId) ? injuryCandidate : null;
  if (injuryNext && FFC.applyInjuryFactFindingTurn) {
    const person = people.find(p => p.id === injuryNext.subjectId)!;
    const candidates: string[] = []; let permanentLossOnFile = false;
    for (const p of perContract.filter(x => x.contract.ownerId === person.id)) {
      const ids = new Set([...p.contract.documents, ...p.contract.references].map(d => d.id));
      if (CATALOG.some(e => ids.has(e.policyId) && (FFC.PERMANENT_LOSS ?? /$^/).test(e.benefitName))) permanentLossOnFile = true;
      for (const m of p.assessed.matches) candidates.push(m.benefit.benefitName + " " + (m.benefit.productName ?? ""));
    }
    FFC.applyInjuryFactFindingTurn({ answer, state, person, next: injuryNext, candidateNames: candidates, permanentLossOnFile });
    nextQuestion = injuryNext.question; questionCount = answer.questions.length;
  } else {
    // Generic path: every candidate claim card as the catalogue path would show it.
    answer.mode = nextQuestion ? "fact_finding" : "claim_assessment";
    answer.claimItems = perContract.flatMap(p => p.assessed.items);
    if (nextQuestion) answer.questions = [{ id: "q-" + nextQuestion.factKey, text: nextQuestion.text, type: nextQuestion.type, why: "", options: nextQuestion.options } as ChatAnswer["questions"][number]];
    answer.claimItems = enforceChatMonetarySafety(answer.claimItems, { householdId: "hh-synthetic" });
  }
  answer.knownFacts = subjectIds.flatMap(id => [PEOPLE[id], ...factLabels(state.subjects[id] ?? {})]);
  // Both monetary gates exactly as runChatWorkflow applies them before saving.
  enforceLiveChatMonetaryBoundary(answer, { claimContext: liveClaimContext(state.intent, answer, message) });
  return { state, nextQuestion, questionCount, categories, perContract, planJson: JSON.stringify(plans), answer };
}
const fresh = (): ConversationState => ({ subjects: {} });
const factsOf = (r: TurnResult, id = JOSEPHINE): SubjectFacts => r.state.subjects[id] ?? {};
const candidateNames = (r: TurnResult) => r.perContract.flatMap(p => p.assessed.matches.map(m => m.benefit.benefitName));
const itemTitles = (r: TurnResult) => r.perContract.flatMap(p => p.assessed.items.map(i => i.title));
/** Every string a person could see from this turn (claim cards, ruled-out
 * reasons as the workflow renders them, questions, known facts, the plan). */
function visibleText(r: TurnResult) {
  return JSON.stringify({ answer: r.answer, ruledOut: r.perContract.flatMap(p => p.assessed.ruledOut.map(x => [x.benefit.benefitName, x.because])), plan: r.planJson });
}
function assertNoAmount(r: TurnResult, label: string) {
  for (const item of r.answer.claimItems) {
    assert.equal(item.calculatedAmount, undefined, label + ": calculatedAmount on " + item.title);
    assert.ok(item.amountText == null, label + ": amountText on " + item.title + " = " + item.amountText);
  }
  assert.deepEqual(r.answer.potentialPayoutTotals ?? [], [], label + ": payout totals");
  const texts = [r.answer.summary, ...r.answer.details, ...r.answer.nextSteps, ...r.answer.claimItems.flatMap(i => [i.reason, ...i.conditions])];
  for (const t of texts) assert.ok(!containsMoney(t), label + ": money in user text: " + t);
}
const INJURY_KEYS = ["injured", "injuryKind", "fractureBodyPart", "injuryBodyPart", "injurySide", "injuries", "permanentImpairment"];
function assertNoInjuryFacts(facts: SubjectFacts, label: string) {
  for (const key of INJURY_KEYS) assert.ok(facts[key] == null || facts[key].state !== "known" || facts[key].value === false || facts[key].value === null,
    label + ": unexpected injury fact " + key + "=" + JSON.stringify(facts[key]?.value));
}
function assertNoFracture(facts: SubjectFacts, label: string) {
  assert.notEqual(knownValue(facts, "injuryKind"), "fracture", label + ": injuryKind=fracture");
  assert.equal(knownValue(facts, "fractureBodyPart"), null, label + ": fractureBodyPart=" + JSON.stringify(knownValue(facts, "fractureBodyPart")));
  const injuries = knownValue(facts, "injuries");
  assert.ok(!(typeof injuries === "string" && /fractur|\bbr(?:oke|oken)\b/i.test(injuries)), label + ": injuries=" + injuries);
}
const withoutTimes = (value: unknown) => JSON.stringify(value, (k, v) => (k === "recordedAt" ? undefined : v));

// The realistic model reply for "An accident." (the pending question's answer).
const accidentAnswer = withModel({ intent: "follow_up", facts: [mf(JOSEPHINE, "eventType", "accident", "An accident")] });

// =================================================================== A
test("A. 'Josephine broke her arm.' -> 'An accident.': fracture kept, no Loss of arm, no amount, next asks location", () => {
  const t1 = turn(fresh(), "Josephine broke her arm.");
  const f1 = factsOf(t1);
  assert.equal(knownValue(f1, "injured"), true, "turn1 injured");
  assert.equal(knownValue(f1, "injuryKind"), "fracture", "turn1 injuryKind");
  assert.match(String(knownValue(f1, "fractureBodyPart")), /\barm\b/, "turn1 fractureBodyPart");
  assert.ok(t1.nextQuestion, "turn1 must ask a question");
  assert.equal(t1.questionCount, 1, "turn1 exactly one question, got " + t1.questionCount);
  assert.equal(t1.nextQuestion!.factKey, "eventType", "turn1 asks accident/illness first, got " + t1.nextQuestion!.factKey);
  assert.equal(t1.answer.mode, "fact_finding");
  for (const [label, r] of [["turn1", t1]] as const) {
    assert.ok(!candidateNames(r).some(n => RAW_LOSS.test(n)), label + ": Loss of arm is a candidate");
    assertNoAmount(r, label);
  }
  // Both the realistic model reply and the bare stand-in (short-answer path).
  for (const [variant, model] of [["model", accidentAnswer], ["stand-in", stub]] as const) {
    const t2 = turn(t1.state, "An accident.", { model });
    const f2 = factsOf(t2);
    const L = "turn2(" + variant + ")";
    assert.equal(knownValue(f2, "eventType"), "accident", L + " eventType");
    assert.equal(knownValue(f2, "injuryKind"), "fracture", L + " fracture kept");
    assert.match(String(knownValue(f2, "fractureBodyPart")), /\barm\b/, L + " fractureBodyPart kept");
    assert.ok(!candidateNames(t2).some(n => RAW_LOSS.test(n)), L + ": Loss of arm among candidates " + JSON.stringify(candidateNames(t2)));
    assert.ok(!itemTitles(t2).some(n => RAW_LOSS.test(n)), L + ": Loss of arm among claim items");
    assertNoAmount(t2, L);
    assert.ok(t2.nextQuestion, L + " must ask the next question");
    assert.equal(t2.questionCount, 1, L + " exactly one question");
    assert.equal(t2.nextQuestion!.factKey, "eventLocation", L + " next asks location, got " + t2.nextQuestion!.factKey + " / " + t2.nextQuestion!.text);
    assert.match(t2.nextQuestion!.text, /\bwhere\b/i, L + " location wording");
    for (const o of ["Singapore", "Overseas", "Not sure"]) assert.ok((t2.nextQuestion!.options ?? []).includes(o), L + " option " + o);
    const visible = visibleText(t2);
    assert.ok(!/Not applicable here/i.test(visible), L + ": 'Not applicable here' visible");
    assert.ok(!/\b\d+\s+benefit rules?\b/i.test(visible), L + ": benefit-rule count visible");
    assert.ok(!RAW_LOSS.test(visible), L + ": raw 'Loss of arm' in a user-visible string");
    // The workflow's injury step: fact_finding, one question, no cards.
    assert.equal(t2.answer.mode, "fact_finding", L + " mode");
    assert.equal(t2.answer.questions.length, 1, L + " answer carries exactly one question");
    assert.equal(t2.answer.claimItems.length, 0, L + " claim cards shown while fact-finding");
    assert.ok(!/permanent disability benefits/i.test(t2.answer.summary), L + ": permanent disability offered as a category: " + t2.answer.summary);
  }
  // Turn 1 answer as well.
  assert.equal(t1.answer.questions.length, 1, "turn1 answer one question");
  assert.ok(!RAW_LOSS.test(visibleText(t1)), "turn1: raw 'Loss of arm' visible");
  assert.ok(!/Not applicable here/i.test(visibleText(t1)), "turn1: 'Not applicable here' visible");
});
test("A2. workflow/page source: no 'Not applicable here' line, no benefit-rule count sentence, incompatible list never rendered", () => {
  const root = process.cwd();
  const workflow = readFileSync(path.join(root, "lib/chat/workflow.ts"), "utf8");
  const page = readFileSync(path.join(root, "app/chat/page.tsx"), "utf8");
  for (const [name, src] of [["lib/chat/workflow.ts", workflow], ["app/chat/page.tsx", page]] as const) {
    assert.ok(!/["'`]Not applicable here/.test(src), name + " still emits 'Not applicable here'");
    assert.ok(!/benefit rule["'`]\s*\+\s*\(\s*catalog\.length/.test(src) && !/["'`]Answered from ["'`]\s*\+\s*catalog\.length/.test(src),
      name + " still emits the 'Answered from N benefit rules' sentence");
    assert.ok(!/["'`]None of the ["'`]\s*\+\s*catalog\.length\s*\+\s*["'`] benefit rules/.test(src), name + " still emits 'None of the N benefit rules' sentence");
    assert.ok(!/may respond, depending on the answers: ["'`]\s*\+\s*names\.join/.test(src), name + " still lists raw benefit row names as candidates");
    assert.ok(!/\.incompatible\b/.test(src) || !/details\.push\([^)]*incompatible/.test(src), name + " renders the internal incompatible list");
  }
});

// =================================================================== B
test("B. 'permanently lost use of her arm in an accident': Loss-of-arm may be a candidate, but no payable amount/total", () => {
  const msg = "Josephine permanently lost use of her arm in an accident";
  const model = withModel({ intent: "claim", facts: [mf(JOSEPHINE, "injured", true, "permanently lost use of her arm"),
    mf(JOSEPHINE, "permanentImpairment", "permanently lost use of her arm", "permanently lost use of her arm"),
    mf(JOSEPHINE, "eventType", "accident", "in an accident")],
    scenarioCandidates: [{ subjectId: JOSEPHINE, label: "Permanent loss of use of arm", family: "injury", traits: ["bodily_injury", "accident", "disability"], quote: msg }] });
  const r = turn(fresh(), msg, { model });
  assertNoFracture(factsOf(r), "B");
  assertNoAmount(r, "B");
  // Monetary gates unchanged: the raw engine output may carry a figure, the
  // chat gate must not let an unreviewed one through.
  const raw = r.perContract.flatMap(p => p.assessed.items);
  const gated = enforceChatMonetarySafety(structuredClone(raw), { householdId: "hh-synthetic" });
  const answer = blankAnswer(); answer.mode = "claim_assessment"; answer.claimItems = gated;
  enforceLiveChatMonetaryBoundary(answer, { claimContext: true });
  for (const item of answer.claimItems) assert.ok(item.calculatedAmount == null && item.amountText == null, "B: gated amount on " + item.title);
});

// =================================================================== C
test("C. 'Josephine hurt her arm': no fracture/permanent-loss assumed; next question is injury detail", () => {
  const r = turn(fresh(), "Josephine hurt her arm");
  const f = factsOf(r);
  assertNoFracture(f, "C");
  assert.equal(knownValue(f, "permanentImpairment"), null, "C: permanentImpairment assumed");
  assert.ok(!candidateNames(r).some(n => RAW_LOSS.test(n) || /fracture/i.test(n)), "C: schedule rows visible " + JSON.stringify(candidateNames(r)));
  assert.ok(r.nextQuestion, "C: must ask");
  assert.equal(r.questionCount, 1, "C: exactly one question");
  assert.equal(r.nextQuestion!.factKey, "injuryKind", "C: first question should be injury detail, got " + r.nextQuestion!.factKey);
  assert.match(r.nextQuestion!.text, /kind of injury|broken bone|what (?:happened|injury)/i, "C: injury-detail wording");
  assertNoAmount(r, "C");
  // The model's vague label must not be taken for a kind of injury.
  const vague = turn(fresh(), "Josephine hurt her arm", { model: withModel({ facts: [mf(JOSEPHINE, "injuryKind", "hurt", "hurt her arm")] }) });
  assert.equal(vague.nextQuestion?.factKey, "injuryKind", "C(vague model kind): still asks injury kind, got " + vague.nextQuestion?.factKey);
});

// =================================================================== D
test("D. 'She did not break her arm': no confirmed fracture (fresh and as a correction)", () => {
  const model = withModel({ facts: [mf(JOSEPHINE, "fractureBodyPart", "arm", "break her arm")] });
  const d1 = turn(fresh(), "She did not break her arm", { model });
  assertNoFracture(factsOf(d1), "D1 fresh");
  const t1 = turn(fresh(), "Josephine broke her arm.");
  const d2 = turn(t1.state, "Sorry, she did not break her arm.", { model: withModel({ intent: "follow_up" }) });
  assertNoFracture(factsOf(d2), "D2 correction");
  assert.ok(!candidateNames(d2).some(n => /fracture of arm|^fractures$/i.test(n)), "D2: fracture rows still candidates " + JSON.stringify(candidateNames(d2)));
});

// =================================================================== E
test("E. hypotheticals create no claim-event fact or scenario", () => {
  for (const q of ["Could this cover a broken arm?", "What if someone fractures a wrist?", "Does my policy pay if Josephine breaks her arm?"]) {
    const r = turn(fresh(), q);
    assertNoInjuryFacts(factsOf(r), "E " + q);
    assert.deepEqual(r.state.scenarios?.[JOSEPHINE] ?? [], [], "E scenario for: " + q);
    assert.ok(!r.categories.some(c => c.endsWith("accidental_injury")), "E injury category opened for: " + q);
    assert.equal(r.nextQuestion, null, "E asked a claim question for: " + q + " -> " + r.nextQuestion?.text);
    assert.equal((Facts as unknown as { reportedFractureStatement?: (t: string) => unknown }).reportedFractureStatement?.(q) ?? null, null, "E reportedFractureStatement: " + q);
  }
});

// =================================================================== F
test("F. a genuine fracture benefit stays eligible/visible for the arm fracture", () => {
  const t1 = turn(fresh(), "Josephine broke her arm.");
  const t2 = turn(t1.state, "An accident.", { model: accidentAnswer });
  const names = candidateNames(t2);
  assert.ok(names.includes("Fracture of arm"), "F: 'Fracture of arm' not a candidate: " + JSON.stringify(names));
  assert.ok(names.includes("Fractures"), "F: 'Fractures' not a candidate: " + JSON.stringify(names));
  const compat = (Catalog as unknown as { injuryCompatibility?: (b: CatalogBenefit, f: SubjectFacts) => { visible: boolean; lineKind: string | null } }).injuryCompatibility;
  assert.ok(compat, "F: injuryCompatibility not exported");
  const fracture = CATALOG.find(b => b.benefitName === "Fracture of arm" && b.policyId === DOC_C)!;
  const v = compat!(fracture, factsOf(t2));
  assert.equal(v.visible, true); assert.equal(v.lineKind, "fracture");
  // matchBenefits with facts: same answer.
  const m = (matchBenefits as (...a: unknown[]) => { benefit: CatalogBenefit }[])(catalogFor(DOC_C), eventTraits(factsOf(t2)), [], factsOf(t2)).map(x => x.benefit.benefitName);
  assert.ok(m.includes("Fracture of arm") && !m.some(n => RAW_LOSS.test(n)), "F: matchBenefits(facts) " + JSON.stringify(m));
  // Left elbow fracture still answers the generic arm row.
  const elbow = turn(fresh(), "Josephine fractured her left elbow.");
  assert.equal(knownValue(factsOf(elbow), "fractureBodyPart"), "left elbow", "F: left elbow site");
  assert.equal(compat!(fracture, factsOf(elbow)).visible, true, "F: arm row for left elbow");
});

// =================================================================== G
test("G. medical reimbursement stays a plausible candidate for a fracture with bills unknown", () => {
  const t1 = turn(fresh(), "Josephine broke her arm.");
  const t2 = turn(t1.state, "An accident.", { model: accidentAnswer });
  assert.ok(candidateNames(t2).includes("Accident medical reimbursement"), "G: not a candidate after accident: " + JSON.stringify(candidateNames(t2)));
  const item = t2.perContract[0].assessed.items.find(i => /Accident medical reimbursement/.test(i.title));
  assert.ok(item, "G: no assessed item for medical reimbursement");
  assert.notEqual(item!.status, "not_applicable", "G: marked not applicable");
  assert.match(t2.answer.summary, /medical reimbursement/i, "G: category not named to the household: " + t2.answer.summary);
  assert.equal(knownValue(factsOf(t2), "hospitalBill"), null, "G precondition: bill unknown");
  assertNoAmount(t2, "G");
  // Before the cause is known it is still not ruled out.
  assert.ok(!t1.perContract[0].assessed.ruledOut.some(x => /medical reimbursement/i.test(x.benefit.benefitName)), "G: ruled out before cause known");
});

// =================================================================== H
test("H. identical input/state -> identical facts and next question; reopened chat continues identically", () => {
  const run = () => {
    const t1 = turn(fresh(), "Josephine broke her arm.");
    const t2 = turn(t1.state, "An accident.", { model: accidentAnswer });
    return { t1: { state: t1.state, q: t1.nextQuestion }, t2: { state: t2.state, q: t2.nextQuestion, items: t2.answer.claimItems } };
  };
  const a = withoutTimes(run()), b = withoutTimes(run());
  assert.equal(a, b, "H: two independent runs differ");
  // Reopen: the saved state goes through JSON (DB round-trip) before turn 2,
  // and the same message is answered again from the same state.
  const t1 = turn(fresh(), "Josephine broke her arm.");
  const reopened = JSON.parse(JSON.stringify(t1.state)) as ConversationState;
  const live = turn(t1.state, "An accident.", { model: accidentAnswer });
  const again = turn(reopened, "An accident.", { model: accidentAnswer });
  assert.equal(withoutTimes({ s: again.state, q: again.nextQuestion }), withoutTimes({ s: live.state, q: live.nextQuestion }), "H: reopened chat diverged");
  // A repeated identical answer does not advance or lose facts.
  const repeat = turn(live.state, "An accident.", { model: accidentAnswer });
  assert.equal(knownValue(factsOf(repeat), "injuryKind"), "fracture", "H: repeat lost fracture");
  assert.equal(repeat.nextQuestion?.factKey, "eventLocation", "H: repeat changed next question to " + repeat.nextQuestion?.factKey);
});

// =================================================================== I
test("I. cross-member isolation: Josephine's fracture never unlocks Bob's policy; Bob's facts stay empty", () => {
  const contracts = [contract(JOSEPHINE, DOC_C), contract(BOB, DOC_B)];
  // Adversarial model: attributes the fracture to Bob as well.
  const model = withModel({ facts: [mf(BOB, "fractureBodyPart", "arm", "Josephine broke her arm"), mf(BOB, "injured", true, "Josephine broke her arm")],
    scenarioCandidates: [{ subjectId: BOB, label: "Fracture", family: "injury", traits: ["bodily_injury", "accident"], quote: "Josephine broke her arm" }] });
  const t1 = turn(fresh(), "Josephine broke her arm.", { subjectIds: [JOSEPHINE], model, contracts });
  const t2 = turn(t1.state, "An accident.", { subjectIds: [JOSEPHINE], model: accidentAnswer, contracts });
  for (const r of [t1, t2]) {
    assert.deepEqual(r.state.subjects[BOB] ?? {}, {}, "I: Bob's facts not empty: " + JSON.stringify(r.state.subjects[BOB]));
    assert.deepEqual(r.state.scenarios?.[BOB] ?? [], [], "I: Bob has scenarios");
    const bob = r.perContract.find(p => p.contract.ownerId === BOB)!.assessed;
    assert.equal(bob.matches.length, 0, "I: Bob's benefits matched: " + JSON.stringify(bob.matches.map(m => m.benefit.benefitName)));
    assert.equal(bob.items.length, 0, "I: Bob's cards produced");
    assert.ok(!r.answer.claimItems.some(i => /^Bob\b/.test(i.title)), "I: a Bob card reached the answer");
    const charm = r.perContract.find(p => p.contract.ownerId === JOSEPHINE)!.assessed;
    assert.ok(charm.items.every(i => !i.contractId || i.contractId === contracts[0].id), "I: Josephine's cards cite another contract");
    assert.ok(charm.citations.every(c => c.policyId === DOC_C), "I: Josephine cites Bob's document");
  }
  // Both people in scope (e.g. "we"): the fracture sentence names only Josephine.
  const both = turn(fresh(), "Josephine broke her arm.", { subjectIds: [JOSEPHINE, BOB], model, contracts });
  assertNoInjuryFacts(both.state.subjects[BOB] ?? {}, "I (two subjects) Bob");
  assert.deepEqual(both.state.scenarios?.[BOB] ?? [], [], "I (two subjects): Bob has scenarios");
  assert.ok(!both.perContract.find(p => p.contract.ownerId === BOB)!.assessed.matches.length, "I (two subjects): Bob's benefits matched");
});

// =================================================================== J
test("J. no amount from chat-only facts: the existing gates strip/refuse it", () => {
  // Household-asserted bill + declared-only ownership: the engine computes a
  // figure; enforceChatMonetarySafety alone must refuse it.
  const declared = contract(JOSEPHINE, DOC_C, "declared");
  const facts: SubjectFacts = {
    eventType: { value: "accident", state: "known", quote: "An accident", recordedAt: NOW.toISOString(), source: "user" },
    injured: { value: true, state: "known", quote: "broke her arm", recordedAt: NOW.toISOString(), source: "system-derived" },
    injuryKind: { value: "fracture", state: "known", quote: "broke her arm", recordedAt: NOW.toISOString(), source: "system-derived" },
    fractureBodyPart: { value: "arm", state: "known", quote: "broke her arm", recordedAt: NOW.toISOString(), source: "system-derived" },
    hospitalBill: { value: 1800, state: "known", quote: "the bill was S$1,800", recordedAt: NOW.toISOString(), source: "user" },
  };
  const traits = eventTraits(facts) as ScenarioTrait[];
  const assessed = assessContractFromCatalog({ contract: declared, catalog: CATALOG, facts, traits, events: reportedClaimEvents(facts, traits) });
  const withFigure = assessed.items.filter(i => i.calculatedAmount != null);
  assert.ok(withFigure.length > 0, "J precondition: engine produced a figure from chat facts (" + JSON.stringify(assessed.items.map(i => [i.title, i.amountText])) + ")");
  const gated = enforceChatMonetarySafety(structuredClone(assessed.items), { householdId: "hh-synthetic" });
  for (const item of gated) assert.ok(item.calculatedAmount == null && item.amountText == null,
    "J: enforceChatMonetarySafety let a household-asserted figure through: " + item.title + " " + item.amountText);
  // Evidence-owned contract with the same household bill: whatever the chat
  // gate decides, the live boundary must leave no event amount or total.
  const owned = assessContractFromCatalog({ contract: contract(JOSEPHINE, DOC_C), catalog: CATALOG, facts, traits, events: reportedClaimEvents(facts, traits) });
  const answer = blankAnswer(); answer.mode = "claim_assessment";
  answer.claimItems = enforceChatMonetarySafety(structuredClone(owned.items), { householdId: "hh-synthetic" });
  answer.summary = "Potential payout identified so far: S$1,800."; answer.details = ["You can claim S$1,000 for the fracture."];
  enforceLiveChatMonetaryBoundary(answer, { claimContext: liveClaimContext("claim", answer, "How much can I claim?") });
  for (const item of answer.claimItems) assert.ok(item.calculatedAmount == null && item.amountText == null, "J: boundary left amount on " + item.title);
  assert.deepEqual(answer.potentialPayoutTotals, [], "J: totals");
  assert.ok(![answer.summary, ...answer.details].some(containsMoney), "J: money left in text: " + JSON.stringify([answer.summary, answer.details]));
});

// =================================================================== extras
test("X1. self-corrected report ('broke her arm last year? no wait, she didn't') creates no fracture", () => {
  for (const msg of ["Josephine broke her arm last year? no wait, she didn't", "Josephine broke her arm last year. No wait, she didn't.",
    "Josephine broke her arm - actually no, she didn't break it, it was only bruised."]) {
    const r = turn(fresh(), msg);
    assertNoFracture(factsOf(r), "X1 '" + msg + "'");
  }
});
test("X2. 'Josephine broke her left wrist': laterality preserved and used", () => {
  const r = turn(fresh(), "Josephine broke her left wrist.");
  const f = factsOf(r);
  assert.equal(knownValue(f, "injuryKind"), "fracture");
  assert.equal(knownValue(f, "fractureBodyPart"), "left wrist", "X2 site " + JSON.stringify(knownValue(f, "fractureBodyPart")));
  assert.equal(knownValue(f, "injurySide"), "left", "X2 side");
  const compat = (Catalog as unknown as { injuryCompatibility: (b: CatalogBenefit, f: SubjectFacts) => { visible: boolean } }).injuryCompatibility;
  const right = benefit(DOC_C, "Fracture of right wrist", "Fracture of right wrist: S$800", { formulaKind: "fixed", formulaValue: 800 });
  const left = benefit(DOC_C, "Fracture of left wrist", "Fracture of left wrist: S$800", { formulaKind: "fixed", formulaValue: 800 });
  assert.equal(compat(right, f).visible, false, "X2 right-wrist row visible for a left wrist");
  assert.equal(compat(left, f).visible, true, "X2 left-wrist row hidden");
  // Survives the accident answer and a vague model restatement.
  const t2 = turn(r.state, "An accident.", { model: withModel({ intent: "follow_up", facts: [mf(JOSEPHINE, "eventType", "accident", "An accident"), mf(JOSEPHINE, "injurySide", "right", "An accident")] }) });
  assert.equal(knownValue(factsOf(t2), "injurySide"), "left", "X2 side overwritten");
  assert.equal(knownValue(factsOf(t2), "fractureBodyPart"), "left wrist", "X2 site overwritten");
});
test("X3. fracture reported for a member recorded as deceased creates no injury claim", () => {
  const dead: ConversationState = { intent: "claim", subjects: { [JOSEPHINE]: {
    death: { value: true, state: "known", quote: "Josephine passed away", recordedAt: "2026-09-01T00:00:00.000Z", source: "user" },
    eventType: { value: "death", state: "known", quote: "Josephine passed away", recordedAt: "2026-09-01T00:00:00.000Z", source: "system-derived" } } }, scenarios: { [JOSEPHINE]: [] } };
  const r = turn(dead, "Josephine broke her arm.");
  const f = factsOf(r);
  assert.equal(knownValue(f, "death"), true, "X3 death fact lost");
  assertNoFracture(f, "X3");
  assert.notEqual(knownValue(f, "injured"), true, "X3 injured=true on a deceased member");
  assert.ok(!r.categories.some(c => c.endsWith("accidental_injury")), "X3 injury category opened: " + JSON.stringify(r.categories));
});
test("X4. vague model restatement ('injured her arm') does not erase an established fracture", () => {
  const t1 = turn(fresh(), "Josephine broke her arm.");
  const msg = "It was an accident and she injured her arm at the playground.";
  const model = withModel({ intent: "follow_up", facts: [mf(JOSEPHINE, "eventType", "accident", "It was an accident"),
    mf(JOSEPHINE, "injuryKind", "injured", "injured her arm"), mf(JOSEPHINE, "injuries", "injured her arm", "injured her arm"),
    mf(JOSEPHINE, "fractureBodyPart", "arm", "injured her arm")] });
  const t2 = turn(t1.state, msg, { model });
  const f = factsOf(t2);
  assert.equal(knownValue(f, "injuryKind"), "fracture", "X4 kind downgraded to " + knownValue(f, "injuryKind"));
  assert.match(String(knownValue(f, "fractureBodyPart")), /\barm\b/, "X4 site");
  assert.ok(!candidateNames(t2).some(n => RAW_LOSS.test(n)), "X4 Loss of arm candidate");
  assert.equal(t2.nextQuestion?.factKey, "eventLocation", "X4 next question " + t2.nextQuestion?.factKey);
});
test("X5. a sloppy model fact on a hypothetical ('Could this cover a broken arm?') does not become a fracture", () => {
  const model = withModel({ intent: "claim", facts: [mf(JOSEPHINE, "fractureBodyPart", "arm", "a broken arm"), mf(JOSEPHINE, "injured", true, "a broken arm")],
    scenarioCandidates: [{ subjectId: JOSEPHINE, label: "Broken arm", family: "injury", traits: ["bodily_injury"], quote: "a broken arm" }] });
  const r = turn(fresh(), "Could this cover a broken arm?", { model });
  assertNoInjuryFacts(factsOf(r), "X5");
  assert.deepEqual(r.state.scenarios?.[JOSEPHINE] ?? [], [], "X5 scenario");
});
test("X6. answering the location question advances to the date, one question at a time, never re-asking", () => {
  const t1 = turn(fresh(), "Josephine broke her arm.");
  const t2 = turn(t1.state, "An accident.", { model: accidentAnswer });
  const t3 = turn(t2.state, "Singapore", { model: withModel({ intent: "follow_up" }) });
  assert.equal(knownValue(factsOf(t3), "eventLocation"), "Singapore", "X6 location not recorded: " + JSON.stringify(factsOf(t3).eventLocation));
  assert.equal(t3.questionCount, 1, "X6 one question");
  assert.equal(t3.nextQuestion?.factKey, "eventDate", "X6 next " + t3.nextQuestion?.factKey);
  assert.equal(knownValue(factsOf(t3), "injuryKind"), "fracture", "X6 fracture kept");
  assertNoAmount(t3, "X6");
});

// ------------------------------------------------------------------ report
Promise.resolve().then(() => {
  for (const r of results) console.log((r.ok ? "PASS " : "FAIL ") + r.label + (r.ok ? "" : "\n     -> " + r.message));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\ninjury-chat-adversarial-regressions: ${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
});
