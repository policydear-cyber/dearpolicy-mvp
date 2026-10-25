/**
 * Injury chat sequencing (lib/chat/fact-finding-chat.ts, lib/claims/fact-finding.ts).
 *
 * Replays the workflow's deterministic steps for each turn -- the fact merge
 * (with an empty model interpretation, so no network), explicit deferrals,
 * the direct/pending answer capture, then the injury gate -- and checks the
 * household-visible answer: fact_finding mode, exactly one question, no
 * amounts, no schedule-row titles, no rule counts, and the same next
 * question on a repeat or a reopened chat.
 */
import assert from "node:assert/strict";
import { applyExplicitDeferrals, mergeInterpretation, type Interpretation } from "@/lib/chat/facts";
import { applyInjuryFactFindingTurn, benefitCategories, benefitCategory, nextInjuryQuestion } from "@/lib/chat/fact-finding-chat";
import { categoriesFor, recordDirectFactAnswer } from "@/lib/claims/fact-finding";
import type { ConversationState } from "@/lib/chat/types";
import type { ChatAnswer } from "@/types";

let cases = 0;
function test(name: string, fn: () => void) { try { for (let i = 0; i < 3; i++) fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } }

const JOSEPHINE = { id: "c1", display_name: "Josephine", relationship: "child" };
const now = new Date("2026-09-20T10:00:00+08:00");
const CANDIDATES = ["Accidental medical expenses Personal Accident", "Hospital income benefit Hospital Plan", "Fracture benefit Personal Accident", "Loss of arm Personal Accident"];
const MONEY = /(?:S\$|US\$|SGD|USD|\$)\s?\d|\b\d[\d,]*(?:\.\d+)?\s*(?:dollars|SGD)\b/i;
const FORBIDDEN = [/Not applicable here/i, /benefit rules?\b/i, /\b\d+\s+(?:benefit|rule|row)s?\b/i, /Loss of arm/i, /S\$0\b/, /Answered from/i];

function blank(): ChatAnswer {
  return { mode: "answer", summary: "", details: [], claimItems: [], nextSteps: [], confidence: "insufficient_evidence", citations: [], disclaimer: "",
    claimSessionId: null, questions: [], knownFacts: [], missingFacts: [] } as ChatAnswer;
}
const quiet = (intent: Interpretation["intent"], newTopic = false): Interpretation => ({ intent, newTopic, searchTerms: [], facts: [], scenarioCandidates: [] });

/** One chat turn, through the same deterministic steps runChatWorkflowInternal takes. */
function turn(saved: ConversationState, message: string, first = false, candidates = CANDIDATES) {
  let state: ConversationState = JSON.parse(JSON.stringify(saved));
  const subjectIds = [JOSEPHINE.id];
  const pendingBefore = state.pending ? { factKey: state.pending.factKey, subjectId: state.pending.subjectId, type: state.pending.type, options: state.pending.options } : null;
  state = mergeInterpretation({ state, interpretation: quiet(first ? "claim" : "follow_up", first), message, subjectIds, subjectNames: { c1: ["Josephine"] }, now });
  state = applyExplicitDeferrals(state, message, subjectIds, now);
  recordDirectFactAnswer({ message, subjects: state.subjects, subjectIds, scenarios: state.scenarios, now, pending: pendingBefore });
  const answer = blank();
  const next = state.intent === "claim" ? nextInjuryQuestion(state, [JOSEPHINE]) : null;
  if (next) applyInjuryFactFindingTurn({ answer, state, person: JOSEPHINE, next, candidateNames: candidates, permanentLossOnFile: candidates.some((n) => /loss of arm/i.test(n)) });
  // Saved and reopened: the conversation state is stored as JSON.
  return { state: JSON.parse(JSON.stringify(state)) as ConversationState, answer, next };
}
function visible(answer: ChatAnswer) { return [answer.summary, ...answer.details, ...answer.questions.map((q) => q.text + " " + (q.options ?? []).join(" "))].join("\n"); }
function assertFactFinding(answer: ChatAnswer, factKey: string) {
  assert.equal(answer.mode, "fact_finding");
  assert.equal(answer.questions.length, 1, "exactly one question");
  assert.equal(answer.claimItems.length, 0);
  assert.equal(answer.potentialPayoutTotals, undefined);
  const text = visible(answer);
  assert.doesNotMatch(text, MONEY, "no amounts");
  for (const pattern of FORBIDDEN) assert.doesNotMatch(text, pattern, String(pattern));
  assert.ok(answer.questions[0].id.endsWith(factKey), `asks ${factKey}, got ${answer.questions[0].id}`);
}
const empty: ConversationState = { subjects: {}, scenarios: {} };

test("A: broke her arm -> accident or illness; 'An accident.' -> location; no totals, rows, counts or 'Not applicable'", () => {
  const t1 = turn(empty, "Josephine broke her arm.", true);
  assert.equal(t1.state.subjects.c1.injuryKind?.value, "fracture");
  assertFactFinding(t1.answer, "eventType");
  assert.equal(t1.answer.questions[0].text, "Was this caused by an accident, or an illness?");
  assert.equal(t1.state.pending?.factKey, "eventType");
  const t2 = turn(t1.state, "An accident.");
  assert.equal(t2.state.subjects.c1.eventType?.value, "accident", "a bare reply is captured against the pending question");
  assertFactFinding(t2.answer, "eventLocation");
  assert.equal(t2.answer.questions[0].text, "Where did the accident happen?");
  assert.deepEqual(t2.answer.questions[0].options, ["Singapore", "Overseas", "Not sure"]);
  assert.match(t2.answer.summary, /^I’m sorry Josephine is dealing with this\. A broken arm may relate to accident medical reimbursement, fracture or hospital cash benefits in Josephine’s policies, depending on the answers\./);
  assert.match(t2.answer.summary, /not the same as permanent loss of a limb/);
  assert.equal(t2.state.pending?.factKey, "eventLocation");
});
test("A (continued): the full injury sequence, one question each, then the plan is complete", () => {
  let s = turn(empty, "Josephine broke her arm.", true).state;
  const asked: string[] = [];
  const replies: Record<string, string> = { eventType: "An accident.", eventLocation: "Singapore", eventDate: "When did it happen: 2026-09-18",
    fractureConfirmed: "Yes", treatmentType: "Admitted to hospital", hospitalNights: "2" };
  for (let i = 0; i < 10; i++) {
    const key = s.pending?.factKey;
    if (!key) break;
    asked.push(key);
    const t = turn(s, replies[key] ?? "Not sure");
    s = t.state;
    if (!t.next) { assert.equal(t.answer.mode, "answer", "no injury question left"); break; }
    assertFactFinding(t.answer, t.next.question.factKey);
  }
  assert.deepEqual(asked, ["eventType", "eventLocation", "eventDate", "fractureConfirmed", "treatmentType", "hospitalNights"]);
  assert.equal(s.subjects.c1.hospitalised?.value, true, "admission derived from the treatment answer");
  assert.equal(s.subjects.c1.hospitalNights?.value, 2);
  assert.equal(s.subjects.c1.eventDate?.value, "2026-09-18");
});
test("A: 'Not sure' moves the interview on instead of re-asking", () => {
  const t1 = turn(empty, "Josephine broke her arm.", true);
  const t2 = turn(t1.state, "An accident.");
  const t3 = turn(t2.state, "Not sure");
  assertFactFinding(t3.answer, "eventDate");
});
test("C: hurt her arm -> the injury-detail question first; 'A broken bone' -> fracture questions follow", () => {
  const t1 = turn(empty, "Josephine hurt her arm.", true);
  assert.equal(t1.state.subjects.c1.injuryKind, undefined, "no injury kind from 'hurt'");
  assertFactFinding(t1.answer, "injuryKind");
  assert.match(t1.answer.questions[0].text, /What kind of injury was it/);
  assert.match(t1.answer.summary, /An injury to the arm/);
  assert.doesNotMatch(t1.answer.summary, /permanent loss/, "no fracture reported yet");
  const t2 = turn(t1.state, "A broken bone");
  assert.equal(t2.state.subjects.c1.injuryKind?.value, "fracture");
  assertFactFinding(t2.answer, "eventType");
});
test("H: the same input twice, and a reopened chat, give the same facts and the same next question", () => {
  const a = turn(turn(empty, "Josephine broke her arm.", true).state, "An accident.");
  const b = turn(turn(empty, "Josephine broke her arm.", true).state, "An accident.");
  assert.deepEqual(a.answer, b.answer);
  assert.deepEqual(a.state, b.state);
  const reopened = JSON.parse(JSON.stringify(a.state)) as ConversationState;
  assert.equal(nextInjuryQuestion(reopened, [JOSEPHINE])?.question.factKey, a.state.pending?.factKey);
  // Re-sending the same reply is idempotent: the question does not move backwards or skip ahead.
  const again = turn(a.state, "An accident.");
  assert.equal(again.state.subjects.c1.eventType?.value, "accident");
  assert.equal(again.next?.question.factKey, "eventLocation");
});
test("categories: permanent loss, death and critical illness are never offered for a fracture; only categories that exist are named", () => {
  assert.equal(benefitCategory("Loss of arm"), "permanent disability");
  assert.equal(benefitCategory("Permanent total disablement"), "permanent disability");
  assert.equal(benefitCategory("Accidental medical expenses"), "accident medical reimbursement");
  assert.equal(benefitCategory("Fracture benefit"), "fracture");
  assert.deepEqual(benefitCategories(["Hospital income benefit", "Loss of arm"]), ["hospital cash", "permanent disability"]);
  const cands = ["Hospital income benefit Hospital Plan", "Loss of arm PA"];
  const t0 = turn(empty, "Josephine broke her arm.", true, cands);
  // Before the cause is known, no categories are named: accident-only cover depends on it.
  assert.doesNotMatch(t0.answer.summary, /may relate to|permanent loss/, "turn 1 is a short lead and the question: " + t0.answer.summary);
  const t = turn(t0.state, "An accident.", false, cands);
  assert.match(t.answer.summary, /may relate to hospital cash benefits/);
  assert.match(t.answer.summary, /not the same as permanent loss of a limb/);
  // Said once: the next turn acknowledges the answer and asks the next question.
  const t3 = turn(t.state, "Singapore", false, cands);
  assert.equal(t3.answer.summary, "Thanks, noted.");
  assert.equal(t3.answer.questions.length, 1);
  assert.doesNotMatch(t.answer.summary, /fracture benefits|accident medical/);
  const none = turn(empty, "Josephine broke her arm.", true, []);
  assert.doesNotMatch(none.answer.summary, /permanent loss/, "no permanent-loss rows on file -> no disclaimer");
  assert.match(none.answer.summary, /need a few details/);
});
test("a negated bare reply is not matched on its keyword; an unrelated pending key is left to the interpreter", () => {
  const t1 = turn(empty, "Josephine broke her arm.", true);
  const t2 = turn(t1.state, "It wasn't an accident");
  assert.equal(t2.state.subjects.c1.eventType, undefined);
  assert.equal(t2.next?.question.factKey, "eventType", "asked again, not skipped");
  const subjects: ConversationState["subjects"] = { c1: {} };
  assert.equal(recordDirectFactAnswer({ message: "Yes", subjects, subjectIds: ["c1"], now, pending: { factKey: "someModelOnlyKey", subjectId: "c1", type: "yes_no" } }), false);
});
test("categoriesFor: an injury opens the injury plan; a death does not", () => {
  assert.ok(categoriesFor(new Set(["bodily_injury"]), {}).includes("accidental_injury"));
  assert.ok(!categoriesFor(new Set(["bodily_injury", "death"]), {}).includes("accidental_injury"));
});

console.log(`injury chat sequencing regressions passed (${cases} cases, each run 3 times).`);
