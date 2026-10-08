/**
 * Live-model smoke: the deterministic checker graded against hand-built saved conversations (no database, no model):
 * a correct answer PASSES, and each kind of wrong answer FAILS at the stage it should name.
 *   node --import tsx scripts/rag2-live/check-regressions.ts
 */
import assert from "node:assert/strict";
import { DOCS, L, doc } from "../fixtures/rag2-live/household";
import { SCENARIOS } from "./scenarios";
import { grade, visibleText, type LoadedConversation } from "./check";

const pages = new Map<string, string>();
for (const d of DOCS) for (const [n, t] of Object.entries(d.pages)) pages.set(`${d.id}:${n}`, t);
const sc = (id: string) => SCENARIOS.find((s) => s.id === id)!;
function conv(id: string, answers: Record<string, any>[], traces: Record<string, any>[] = [], evidence: Record<string, any> = {}, claim: any = null): LoadedConversation {
  const s = sc(id);
  return {
    conversationId: "test", pages, state: { ragLoop: { evidence, claim, turns: [] } },
    turns: answers.map((a, i) => ({ index: i, user: s.turns[i].user, answer: { details: [], questions: [], citations: [], ...a }, visible: visibleText({ details: [], questions: [], ...a }), questions: (a.questions ?? []).map((q: any) => q.text), userAt: null, assistantAt: null, trace: { outcome: "final_answer", toolCalls: [], evidenceChosen: [], dropped: [], gate: [], ...(traces[i] ?? {}) } })),
  };
}
const cite = (key: any, page: number, excerpt: string) => ({ policyId: doc(key).id, pageStart: page, pageEnd: page, excerpt });
const ev = (key: any, page: number, text: string) => ({ policyId: doc(key).id, page: { start: page, end: page }, passage: { text, onPage: page } });

let passed = 0, failed = 0;
function t(name: string, fn: () => void) { try { fn(); passed++; console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + String((e as Error).message).split("\n").join("\n     ")); } }

const icu = { summary: "Grace's CareDay ICU cash is S$200 for each complete 24 hours in intensive care.", resolvedFamilyMemberId: L.grace.id,
  citations: [cite("CAREDAY", 1, "ICU cash (each complete 24 hours, max 30 per year)   S$200   S$120")], figureBindings: [{ value: 200, policyId: doc("CAREDAY").id, subjectId: L.grace.id, column: "Insured Adult" }] };
t("C1 L1 correct answer passes", () => { const v = grade(sc("L1"), conv("L1", [icu])); assert.equal(v.verdict, "PASS", JSON.stringify(v.checks.filter((c) => !c.ok))); });
t("C2 L1 the child's column fails at person-version resolution", () => {
  const v = grade(sc("L1"), conv("L1", [{ ...icu, summary: "Grace's CareDay ICU cash is S$120 per day.", figureBindings: [{ value: 120, policyId: doc("CAREDAY").id, subjectId: L.grace.id, column: "Insured Child" }] }]));
  assert.equal(v.verdict, "FAIL"); assert.equal(v.failureStage, "person-version resolution");
});
t("C3 L1 a figure the composer dropped fails at verification", () => {
  const v = grade(sc("L1"), conv("L1", [{ ...icu, summary: "Part of what I was going to say couldn't be tied to a passage of your documents, so I left it out.", figureBindings: [{ value: 200, policyId: doc("CAREDAY").id, subjectId: L.grace.id, column: "Insured Adult" }] }], [{ dropped: [{ sentence: "Grace gets S$200 a day.", reason: "x" }] }], { e1: ev("CAREDAY", 1, pages.get(`${doc("CAREDAY").id}:1`)!) }));
  assert.equal(v.failureStage, "verification", JSON.stringify(v.checks.filter((c) => !c.ok)));
});
t("C4 L1 an internal id shown fails at presentation", () => { const v = grade(sc("L1"), conv("L1", [{ ...icu, summary: icu.summary + " (v3)" }])); assert.equal(v.failureStage, "presentation"); });
const endt = { summary: "Your KestrelShield annual claim limit is now S$1,500,000; it was S$1,000,000 before Endorsement No. 1.", resolvedFamilyMemberId: L.daniel.id,
  citations: [cite("KESTREL_ENDT", 1, "Annual claim limit\tS$1,000,000\tS$1,500,000")], figureBindings: [{ value: 1500000, policyId: doc("KESTREL_ENDT").id, subjectId: L.daniel.id, column: "After" }] };
t("C5 L5 the endorsed figure, with the old one stated as what it was, passes", () => { const v = grade(sc("L5"), conv("L5", [endt])); assert.equal(v.verdict, "PASS", JSON.stringify(v.checks.filter((c) => !c.ok))); });
t("C6 L5 the superseded schedule figure as the current limit (endorsement retrieved) fails at person-version resolution", () => {
  const v = grade(sc("L5"), conv("L5", [{ ...endt, summary: "Your annual claim limit is S$1,000,000.", citations: [cite("KESTREL", 1, "Annual claim limit\tS$1,000,000")], figureBindings: [{ value: 1000000, policyId: doc("KESTREL").id, subjectId: L.daniel.id }] }], [], { e1: ev("KESTREL_ENDT", 1, pages.get(`${doc("KESTREL_ENDT").id}:1`)!), e2: ev("KESTREL", 1, pages.get(`${doc("KESTREL").id}:1`)!) }));
  assert.equal(v.failureStage, "person-version resolution");
});
t("C7 L6 'the documents do not say' passes", () => { const v = grade(sc("L6"), conv("L6", [{ summary: "Your SunHaven documents don't mention an emergency medical evacuation benefit, so I can't tell you a limit for it." }])); assert.equal(v.verdict, "PASS", JSON.stringify(v.checks.filter((c) => !c.ok))); });
t("C8 L6 an invented evacuation limit fails", () => { const v = grade(sc("L6"), conv("L6", [{ summary: "SunHaven pays emergency evacuation up to S$50,000." }])); assert.equal(v.verdict, "FAIL"); assert.ok(v.checks.some((c) => !c.ok && /invented/.test(c.name))); });
t("C9 L3 asking how it happened, then a fact recorded as 'accident' that was never said, fails", () => {
  const ask = { summary: "How did Kai break his arm?", questions: [{ text: "How did Kai break his arm?" }], resolvedFamilyMemberId: L.kai.id };
  const v = grade({ ...sc("L3"), turns: sc("L3").turns.slice(0, 1) }, conv("L3", [ask], [{ outcome: "ask_user" }], {}, { subjectId: L.kai.id, facts: { cause: { value: "accident", words: "broke his arm" } } }));
  assert.ok(v.checks.some((c) => !c.ok && /never records cause=accident/.test(c.name)));
  const ok = grade({ ...sc("L3"), turns: sc("L3").turns.slice(0, 1) }, conv("L3", [ask], [{ outcome: "ask_user" }], {}, { subjectId: L.kai.id, facts: { injury: { value: "broken arm", words: "broke his arm" } } }));
  assert.equal(ok.verdict, "PASS", JSON.stringify(ok.checks.filter((c) => !c.ok)));
});
t("C10 a turn stopped by a limit is INCOMPLETE, not a model failure", () => { const v = grade(sc("L1"), conv("L1", [{ summary: "I couldn’t look that up." }], [{ outcome: "limit_reached", limit: { kind: "run_budget", detail: "cap" } }])); assert.equal(v.verdict, "INCOMPLETE"); assert.equal(v.failureStage, null); });
console.log(`\nrag2-live checker regressions ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
