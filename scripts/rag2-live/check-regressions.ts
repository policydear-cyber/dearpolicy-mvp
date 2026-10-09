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
  // Integration (round 3, mechanics only): the correct turn-1 ask also cites the passage the L3 expectation requires
  // (SUNHAVEN p2 accident-only wording, expected.ts P.accidentOnly); without it the hand-built "correct" turn failed
  // at retrieval, not at the cause check this test is about.
  const okAsk = { ...ask, citations: [cite("SUNHAVEN", 2, "This policy covers Bodily Injury caused solely and directly by an Accident.")] };
  const ok = grade({ ...sc("L3"), turns: sc("L3").turns.slice(0, 1) }, conv("L3", [okAsk], [{ outcome: "ask_user" }], {}, { subjectId: L.kai.id, facts: { injury: { value: "broken arm", words: "broke his arm" } } }));
  assert.equal(ok.verdict, "PASS", JSON.stringify(ok.checks.filter((c) => !c.ok)));
});
t("C10 a turn stopped by a limit is INCOMPLETE, not a model failure", () => { const v = grade(sc("L1"), conv("L1", [{ summary: "I couldn’t look that up." }], [{ outcome: "limit_reached", limit: { kind: "run_budget", detail: "cap" } }])); assert.equal(v.verdict, "INCOMPLETE"); assert.equal(v.failureStage, null); });

// ------------------------------------------------------------------ Round 6: usefulness, conditions, questioning (L3 t3)
const t3 = { ...sc("L3"), turns: [sc("L3").turns[2]] };
const one = (a: Record<string, any>, trace: Record<string, any> = {}, content?: string): LoadedConversation => ({
  conversationId: "test", pages, state: { ragLoop: { evidence: {}, claim: { subjectId: L.kai.id, facts: { how_it_happened: { value: "fell off his bicycle at the park", words: "He fell off his bicycle at the park." } } }, turns: [] } },
  turns: [{ index: 0, user: t3.turns[0].user, content, answer: { details: [], questions: [], citations: [], ...a }, visible: visibleText({ details: [], questions: [], ...a }, content), questions: (a.questions ?? []).map((q: any) => q.text), userAt: null, assistantAt: null, trace: { outcome: "ask_user", toolCalls: [], evidenceChosen: [], dropped: [], gate: [], ...trace } }],
});
const XQ = { id: "rag_fact_fracture_xray_confirmed", text: "Has a registered medical practitioner confirmed Kai’s fracture by X-ray?", type: "text", why: "This changes what your policy pays under: “Fracture benefit is payable once per fracture confirmed by X-ray and certified by a registered medical practitioner.” (page 2)" };
const fracture = { resolvedFamilyMemberId: L.kai.id,
  summary: "Kai's SunHaven Family Accident Guard lists a Fracture benefit of S$750 per fracture for a child, payable if the fracture is confirmed by X-ray and certified by a registered medical practitioner.",
  questions: [XQ],
  citations: [cite("SUNHAVEN", 1, "Fracture benefit (per fracture)   S$1,200   S$750"), cite("SUNHAVEN", 2, "Fracture benefit is payable once per fracture confirmed by X-ray and certified by a registered medical practitioner.")],
  figureBindings: [{ value: 750, policyId: doc("SUNHAVEN").id, subjectId: L.kai.id, column: "Child" }] };
const bad = (v: ReturnType<typeof grade>) => v.checks.filter((c) => !c.ok);
t("C11 L3 t3: the conditional S$750 first, then ONE X-ray question (the card) PASSES -- asking it is not a failure", () => { const v = grade(t3, one(fracture)); assert.equal(v.verdict, "PASS", JSON.stringify(bad(v))); });
t("C12 L3 t3: only the X-ray question, no figure, FAILS on usefulness", () => {
  const v = grade(t3, one({ ...fracture, summary: "I need one more detail first.", figureBindings: [] }));
  assert.equal(v.verdict, "FAIL"); assert.ok(bad(v).some((c) => c.name === "shows S$750"), JSON.stringify(bad(v)));
});
t("C13 L3 t3: S$750 without its X-ray / certification condition FAILS on conditions", () => {
  const v = grade(t3, one({ ...fracture, summary: "Kai's SunHaven plan has a Fracture benefit of S$750 per fracture." }));
  assert.ok(bad(v).some((c) => /stated with its X-ray/.test(c.name)), JSON.stringify(bad(v)));
});
t("C14 the question repeated in the message body FAILS at presentation", () => {
  const v = grade(t3, one({ ...fracture, summary: fracture.summary + " " + XQ.text }, {}, fracture.summary + " " + XQ.text));
  // the chat page drops a body copy of a carded question (older saved messages), so the transcript shows it once ...
  assert.ok(!bad(v).some((c) => c.name === "each question shown once"), JSON.stringify(bad(v)));
  // ... but a second, differently placed copy (in the details) is still caught.
  const w = grade(t3, one({ ...fracture, details: [XQ.text] }));
  assert.ok(bad(w).some((c) => c.name === "each question shown once" && c.stage === "presentation"), JSON.stringify(bad(w)));
});
t("C15 'you will receive S$750' / 'approved' FAIL (a printed benefit is never a payment or decision)", () => {
  for (const summary of ["Kai will receive S$750 for the fracture, payable if it is confirmed by X-ray.", "The fracture claim is approved: S$750 per fracture, subject to X-ray confirmation."]) {
    const v = grade(t3, one({ ...fracture, summary }));
    assert.ok(bad(v).some((c) => c.name === "never states approval, payment or entitlement"), summary + " " + JSON.stringify(bad(v)));
  }
});
t("C16 two questions in one turn FAIL; a re-ask of how it happened FAILS", () => {
  const v = grade(t3, one({ ...fracture, questions: [XQ, { id: "q2", text: "Which hospital did he go to?", type: "text" }] }));
  assert.ok(bad(v).some((c) => c.name === "at most one question"));
  const w = grade(t3, one({ ...fracture, questions: [{ id: "q", text: "How did Kai break his arm?", type: "text" }] }));
  assert.ok(bad(w).some((c) => /does not re-ask/.test(c.name)));
});
t("C17 internal evidence ids in the text ('[e9, e6]') FAIL at presentation", () => {
  const v = grade(t3, one({ ...fracture, summary: fracture.summary.replace(/\.$/, " [e9, e6].") }));
  assert.equal(v.failureStage, "presentation", JSON.stringify(bad(v)));
});
t("C18 every scenario (L1-L6, L3b, L4b, L5b) is source-grounded: each expected passage is verbatim on its stored page; each calculation recomputes from its operands", () => {
  const ids = SCENARIOS.map((s) => s.id);
  for (const id of ["L3b", "L4b", "L5b"]) assert.ok(ids.includes(id), "missing scenario " + id);
  for (const s of SCENARIOS) {
    s.turns.forEach((turn, i) => {
      for (const p of turn.expect.passages ?? []) assert.ok(String(doc(p.doc).pages[p.page] ?? "").includes(p.text), `${s.id} t${i + 1}: "${p.text}" not on ${p.doc} p${p.page}`);
      const c = turn.expect.calculation;
      if (c?.calculator === "hospital_cash") {
        const at = (k: string) => Date.parse(String(c.operands.find((o) => o.label === k)!.value) + ":00+08:00");
        const rate = Number(c.operands.find((o) => o.source === "document")!.value);
        const periods = Math.min(90, Math.floor((at("discharge") - at("admission")) / 86_400_000));
        assert.equal(periods * rate, c.result, `${s.id}: ${periods} x ${rate}`);
        assert.ok(String(doc("CAREDAY").pages[1]).includes(`S$${rate}`), `${s.id}: rate S$${rate} printed`);
      }
      for (const f of turn.expect.figures ?? []) assert.ok(DOCS.some((d) => Object.values(d.pages).some((pg) => pg.includes(f))) || turn.expect.calculation?.result === Number(f.replace(/[^\d.]/g, "")), `${s.id}: ${f} printed or calculated`);
    });
  }
});
t("C19 L3b: the conditional S$600 for Mei passes; S$600 alone fails on its condition; 'S$900' (burns) fails", () => {
  const s = { ...sc("L3b"), turns: [sc("L3b").turns[0]] };
  const mk = (summary: string, binds = [{ value: 600, policyId: doc("PLAYWELL").id, subjectId: L.mei.id, column: "Sum insured" }]): LoadedConversation => (<any>{ conversationId: "t", pages, state: { ragLoop: { evidence: {}, claim: null, turns: [] } },
    turns: [{ index: 0, user: s.turns[0].user, answer: { details: [], questions: [], citations: [cite("PLAYWELL", 1, "Dislocation benefit (per dislocation)   S$600"), cite("PLAYWELL", 2, "Dislocation benefit is payable once per dislocation that is diagnosed by a registered medical practitioner and confirmed by X-ray or MRI.")], summary, resolvedFamilyMemberId: L.mei.id, figureBindings: binds }, visible: summary, questions: [], userAt: null, assistantAt: null, trace: { outcome: "final_answer", toolCalls: [], evidenceChosen: [], dropped: [], gate: [] } }] });
  const ok = grade(s, mk("Mei's PlayWell Junior Accident Cover lists a Dislocation benefit of S$600 per dislocation, payable if the dislocation is diagnosed by a registered medical practitioner and confirmed by X-ray or MRI."));
  assert.equal(ok.verdict, "PASS", JSON.stringify(bad(ok)));
  assert.ok(bad(grade(s, mk("Mei's PlayWell plan pays S$600 per dislocation."))).some((c) => /stated with/.test(c.name)));
  assert.ok(bad(grade(s, mk("Mei's PlayWell plan lists S$900, payable if confirmed by X-ray."))).some((c) => /never states S\$900/.test(c.name)));
});
// Integration (r6): L4 / L4b require the figure WITH its stated assumption about earlier use of the yearly limit.
t("C20 L4 / L4b: the estimate passes only with its assumption about earlier use of the 90-period yearly limit", () => {
  for (const [id, fig, n] of [["L4", "S$120", 2], ["L4b", "S$300", 3]] as const) {
    const re = new RegExp(sc(id).turns[0].expect.says![0].pattern, "i");
    assert.ok(re.test(`Indicative estimate: CareDay hospital cash of S$${fig.slice(2) === "120" ? 60 : 100} for ${n} complete 24-hour periods comes to ${fig}, assuming at least ${n} of the 90 complete 24-hour periods are still available this year.`), id + " with the assumption");
    assert.ok(!re.test(`Indicative estimate: CareDay hospital cash for ${n} complete 24-hour periods comes to ${fig}.`), id + " without it");
  }
});
console.log(`\nrag2-live checker regressions ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
