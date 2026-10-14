/**
 * Live-model smoke: the deterministic checker graded against hand-built saved conversations (no database, no model):
 * a correct answer PASSES, and each kind of wrong answer FAILS at the stage it should name.
 *   node --import tsx scripts/rag2-live/check-regressions.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DOCS, L, doc } from "../fixtures/rag2-live/household";
import { SCENARIOS } from "./scenarios";
import { blobSha, checkProvenance } from "./provenance";
import os from "node:os";
import { gradeBindingV4, inventedPaperwork, TERM_LIFE_AS_PA_V1, TERM_LIFE_AS_PA_V2, dateAsked, days365Conclusions, gradeBindingV3, unidentifiedAmounts, wrongIdentity } from "./binding-check";
import { grade, turnUsefulness, visibleText, type LoadedConversation } from "./check";
import { CLAIM_LEFT_OUT_NOTE, FIGURE_LEFT_OUT_NOTE } from "@/lib/chat/answer-verification";

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
// ------------------------------------------------------------------ Round 6c: real-model defects as checker cases
const t1 = { ...sc("L3"), turns: [sc("L3").turns[0]] };
const first = (summary: string, binds: any[] = []): LoadedConversation => ({
  conversationId: "test", pages, state: { ragLoop: { evidence: {}, claim: { subjectId: L.kai.id, facts: { injury: { value: "broke his arm", words: "Kai broke his arm yesterday." } } }, turns: [] } },
  turns: [{ index: 0, user: t1.turns[0].user, content: summary, answer: { details: [], citations: [cite("SUNHAVEN", 2, "This policy covers Bodily Injury caused solely and directly by an Accident.")], summary, resolvedFamilyMemberId: L.kai.id, figureBindings: binds, questions: [{ id: "q", text: "How did Kai break his arm?", type: "text" }] } as any, visible: visibleText({ details: [], summary, questions: [{ text: "How did Kai break his arm?" }] } as any, summary), questions: ["How did Kai break his arm?"], userAt: null, assistantAt: null, trace: { outcome: "ask_user", toolCalls: [], evidenceChosen: [], dropped: [], gate: [] } }],
});
t("C21 L3 t1: S$750 before the cause is known passes only with the accident-only condition; how it happened is still asked", () => {
  const ok = grade(t1, first("Kai's SunHaven Family Accident Guard lists a Fracture benefit (per fracture) of S$750 for a child, payable if the fracture is confirmed by X-ray, and only for what the policy covers, which depends on how it happened: “This policy covers Bodily Injury caused solely and directly by an Accident.”"));
  assert.equal(ok.verdict, "PASS", JSON.stringify(bad(ok)));
  const noCause = grade(t1, first("Kai's SunHaven Family Accident Guard lists a Fracture benefit (per fracture) of S$750 for a child, payable if the fracture is confirmed by X-ray."));
  assert.ok(bad(noCause).some((c) => /only with the accident-only cover condition/.test(c.name)), JSON.stringify(bad(noCause)));
});
t("C22 the withheld-amount wording spliced into a sentence FAILS at presentation (it passed L3b in the live run)", () => {
  const v = grade(t1, first("Kai's SunHaven Family Accident Guard lists a Fracture benefit (per fracture) of an amount that is only shown after claim evidence has been reviewed for a child."));
  assert.ok(bad(v).some((c) => c.name === "no withheld-amount wording" && c.stage === "presentation"), JSON.stringify(bad(v)));
});
t("C23 'a limit, not a guaranteed payment' is not an entitlement; 'guaranteed payout of' still is", () => {
  const l2 = { ...sc("L2"), turns: [sc("L2").turns[0]] };
  const mk = (summary: string): LoadedConversation => ({ conversationId: "t", pages, state: { ragLoop: { evidence: {}, claim: null, turns: [] } },
    turns: [{ index: 0, user: l2.turns[0].user, answer: { details: [], questions: [], citations: [cite("SUNHAVEN", 1, "Accidental dental treatment (per accident)   S$800   S$400")], summary, resolvedFamilyMemberId: L.kai.id, figureBindings: [{ value: 400, policyId: doc("SUNHAVEN").id, subjectId: L.kai.id, column: "Child" }] } as any, visible: summary, questions: [], userAt: null, assistantAt: null, trace: { outcome: "final_answer", toolCalls: [], evidenceChosen: [], dropped: [], gate: [] } }] });
  const ok = grade(l2, mk("For Kai, SunHaven's Accidental dental treatment (per accident) benefit is up to S$400 per accident; this is a limit, not a guaranteed payment."));
  assert.equal(ok.verdict, "PASS", JSON.stringify(bad(ok)));
  assert.ok(bad(grade(l2, mk("Kai has a guaranteed payout of S$400 per accident."))).some((c) => c.name === "never states approval, payment or entitlement"));
});
// ------------------------------------------------- Round 7: every substantive turn is useful (L3b turn 2, real runs)
/** A real run's saved L3b conversation (docs/rag-migration/live/RUN-*\/conv-L3b.json, read only), as the checker loads it. */
function savedRun(prefix: string): LoadedConversation {
  const dir = path.resolve("docs/rag-migration/live");
  const run = fs.readdirSync(dir).filter((d) => d.startsWith(prefix)).sort()[0];
  assert.ok(run, "missing run folder " + prefix);
  const j = JSON.parse(fs.readFileSync(path.join(dir, run, "conv-L3b.json"), "utf8"));
  const s = j.saved;
  return { conversationId: j.conversationId, pages, state: { ragLoop: { evidence: s.evidence, claim: s.claim, turns: s.traces } },
    turns: j.turns.map((t: any, i: number) => { const a = s.answers[i] ?? {}; const qs = (a.questions ?? []).map((q: any) => q.text);
      return { index: i, user: t.user, content: t.visible.split("\n").filter((l: string) => !qs.includes(l) && !(a.questions ?? []).some((q: any) => q.why === l)).join(" "), answer: { summary: t.visible, details: [], ...a }, visible: t.visible, questions: qs, userAt: null, assistantAt: null, trace: s.traces[i] }; }) };
}
const echoRun = savedRun("RUN-r6-final-candidate-"), failRun = savedRun("RUN-r6-facts-fix-L3-L3b-");
t("C24 L3b turn 2 of r6-final-candidate (only 'You told me ...', the model gave nothing citable) FAILS as not useful, at model reasoning-tool selection", () => {
  assert.equal(echoRun.turns[1].visible, "You told me the doctor at the clinic did an X-ray and it showed the dislocation.");
  const v = grade(sc("L3b"), echoRun);
  assert.equal(v.verdict, "FAIL", JSON.stringify(bad(v)));
  const u = bad(v).find((c) => c.turn === 2 && /^useful turn/.test(c.name));
  assert.ok(u, JSON.stringify(bad(v)));
  assert.equal(u!.stage, "model reasoning-tool selection"); assert.match(u!.detail, /only says back/);
  assert.ok(!bad(v).some((c) => c.turn === 1), "turn 1 (the conditional S$600 and one question) stays a pass: " + JSON.stringify(bad(v)));
});
t("C25 L3b turn 2 of r6-facts-fix-L3-L3b (only the generic verification failure; the model's cited sentence was dropped) FAILS as not useful, at presentation", () => {
  assert.equal(failRun.turns[1].visible, "I couldn’t confirm an answer to that from your documents.");
  const v = grade(sc("L3b"), failRun);
  assert.equal(v.verdict, "FAIL");
  const u = bad(v).find((c) => c.turn === 2 && /^useful turn/.test(c.name));
  assert.ok(u, JSON.stringify(bad(v)));
  assert.equal(u!.stage, "presentation"); assert.match(u!.detail, /generic failure/);
});
t("C26 L3b turn 2 that says back the X-ray, re-states the cited S$600 with its condition and what remains PASSES; a bare generic failure or an uncited figure does not", () => {
  const good = "You told me the doctor at the clinic did an X-ray and it showed the dislocation. Mei’s PlayWell plan lists a Dislocation benefit of S$600 per dislocation, payable once if diagnosed by a registered medical practitioner and confirmed by X-ray or MRI. What you’ve told me is your own account, not a reviewed medical record: the insurer will check it against the documents it asks for and decides the claim after reviewing them.";
  const base = echoRun.turns[1];
  const mk = (summary: string, extra: Record<string, any> = {}) => ({ ...echoRun, turns: [echoRun.turns[0], { ...base, content: summary, visible: summary, answer: { ...base.answer, summary, ...extra } }] });
  const cites = { citations: [cite("PLAYWELL", 1, "Dislocation benefit (per dislocation)   S$600"), cite("PLAYWELL", 2, "Dislocation benefit is payable once per dislocation that is diagnosed by a registered medical practitioner and confirmed by X-ray or MRI.")], figureBindings: [{ value: 600, policyId: doc("PLAYWELL").id, subjectId: L.mei.id }] };
  const v = grade(sc("L3b"), mk(good, cites));
  assert.equal(v.verdict, "PASS", JSON.stringify(bad(v)));
  assert.equal(turnUsefulness(mk("Mei’s PlayWell plan lists a Dislocation benefit of S$600.").turns[1]).ok, false, "a figure with no citation is not useful");
  assert.equal(turnUsefulness(mk("I couldn’t confirm an answer to that from your documents. You told me the doctor did an X-ray.").turns[1]).ok, false, "generic failure + echo is not useful");
  // Integration (r7): the save-time gate's own notes are generic failures too.
  // (Citations kept from what the gate removed must not make the note look like a cited statement.)
  for (const note of [FIGURE_LEFT_OUT_NOTE, CLAIM_LEFT_OUT_NOTE]) {
    const u = turnUsefulness(mk(note + " You told me the doctor did an X-ray.", cites).turns[1]);
    assert.equal(u.ok, false, "the gate's note + echo is not useful: " + note); assert.match(u.detail, /generic failure/);
  }
  assert.equal(turnUsefulness(mk("Mei’s PlayWell certificate doesn’t mention a benefit for physiotherapy after a dislocation.").turns[1]).ok, true, "what the documents do not say is useful");
  assert.equal(turnUsefulness({ ...mk("I need one more detail first.").turns[1], questions: ["Which clinic did Mei go to?"] }).ok, true, "one material question is useful");
});

// Round 8: every sentence of the visible answer, fallback prose included, against the household's documents.
const wa = (v: ReturnType<typeof grade>) => v.checks.filter((c) => !c.ok && /^(every figure|every date|no placeholder|no uncertainty|no superseded)/.test(c.name)).map((c) => c.name);
t("C30 L5 the right limit with a wrong neighbouring date FAILS (whole answer)", () => assert.ok(wa(grade(sc("L5"), conv("L5", [{ ...endt, summary: endt.summary + " The endorsement took effect on 1 September 2026." }]))).includes("every date stated is one the expected facts give")));
t("C31 L5 fallback prose with a placeholder ('a set amount') FAILS although S$1,500,000 is right", () => assert.ok(wa(grade(sc("L5"), conv("L5", [{ ...endt, details: ["Before the endorsement the limit was a set amount."] }]))).includes("no placeholder where the documents give a figure")));
t("C32 L5 'the effective date is not confirmed' FAILS (the endorsement prints 01 Jul 2026)", () => assert.ok(wa(grade(sc("L5"), conv("L5", [{ ...endt, details: ["The endorsement's effective date is not confirmed in your records."] }]))).includes("no uncertainty the expected facts contradict")));
t("C33 L5 S$1,000,000 stated as current in a second sentence FAILS (whole answer)", () => assert.ok(wa(grade(sc("L5"), conv("L5", [{ ...endt, details: ["Your limit for this year is S$1,000,000."] }]))).includes("no superseded figure presented as current")));
t("C34 L5 the correct answer has no whole-answer failure", () => assert.deepEqual(wa(grade(sc("L5"), conv("L5", [endt]))), []));

// V1.4: the binding grader's "Term Life presented as Personal Accident" pattern -- version 2 fixes version 1's false
// positive, with independent controls (sentences written for this check, not taken from the run it misgraded alone).
{
  const wrong = ["Your Personal Accident cover is S$1,000,000.", "Darren's Group Personal Accident sum insured is S$1,000,000 as of 6 October 2022.", "Personal Accident: S$1,000,000", "S$1,000,000 under Group Personal Accident is payable.", "The certificate shows S$1,000,000 for the Personal Accident benefit.", "S$1,000,000 is his Personal Accident amount."];
  const right = ["Darren's certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000 as of 6 October 2022.", "Term Life S$1,000,000; Personal Accident S$600,000.", "Group Term Life: S$1,000,000. Group Personal Accident: S$600,000.", "S$1,000,000 (Group Term Life) and the Group Personal Accident S$600,000 are separate amounts.", "His Personal Accident sum insured is S$600,000, not S$1,000,000 which is his Term Life amount."];
  t("C40 binding grader v2: every wrong attribution of S$1,000,000 to Personal Accident is flagged", () => { for (const x of wrong) assert.ok(TERM_LIFE_AS_PA_V2.test(x), x); });
  t("C41 binding grader v2: correct answers naming both products separately are NOT flagged (version 1 flagged the first)", () => { for (const x of right) assert.ok(!TERM_LIFE_AS_PA_V2.test(x), x); assert.ok(TERM_LIFE_AS_PA_V1.test(right[0]), "version 1's false positive is reproduced"); });
}

// V1.4 binding grader version 3: identity-based amounts, either missing date first, no 365-day conclusion before both
// dates. Independent controls (sentences and bindings written for this check).
{
  const DARREN = "7f000000-0000-4000-8000-000000000001", MICHELLE = "7f000000-0000-4000-8000-000000000002", CERT = "7f000000-0000-4000-8000-000000000101", OLD = "7f000000-0000-4000-8000-000000000107";
  const fb = (value: number, benefit: string, o: Record<string, unknown> = {}) => ({ value, benefit, subjectId: DARREN, rowPerson: "Tan Kai Ming, Darren", policyId: CERT, ...o });
  t("C42 binding grader v3: amounts judged by identity -- Darren's own S$300,000 Living Care Plus passes, Michelle's S$300,000 PA fails", () => {
    assert.deepEqual(unidentifiedAmounts("The certificate also lists Group Living Care Plus of S$300,000 for Darren.", []), []);
    assert.deepEqual(wrongIdentity([fb(300000, "Group Living Care Plus")]), []);
    assert.equal(wrongIdentity([fb(300000, "Group Personal Accident", { subjectId: MICHELLE, rowPerson: "Ong Li Ting, Michelle" })]).length, 1);
    assert.equal(wrongIdentity([fb(300000, "Group Personal Accident")]).length, 1, "right person, wrong product: the number exists in the household but not in Darren's PA row");
    assert.equal(wrongIdentity([fb(600000, "Group Term Life")]).length, 1, "swapped products");
    assert.equal(wrongIdentity([fb(1000000, "Group Term Life", { policyId: OLD })]).length, 1, "another source document");
    assert.equal(unidentifiedAmounts("Group Personal Accident of S$300,000 is listed.", []).length, 1, "S$300,000 next to PA is not Darren's PA");
    assert.equal(unidentifiedAmounts("Michelle's Group Living Care Plus is S$300,000.", []).length, 1, "another member's clause");
    assert.equal(unidentifiedAmounts("The plan lists S$300,000.", []).length, 1, "an amount with no product or binding");
    assert.deepEqual(unidentifiedAmounts("The plan lists S$600,000.", [fb(600000, "Group Personal Accident")]), [], "a bound figure");
  });
  t("C43 binding grader v3: either missing date is a relevant first question; an ambiguous one is not", () => {
    assert.equal(dateAsked("On what date did the accident happen?"), "accident");
    assert.equal(dateAsked("When did Darren die (the date of death)?"), "death");
    assert.equal(dateAsked("What was Darren's date of death?"), "death");
    assert.equal(dateAsked("When did Darren die (the date of the accident/death)?"), null);
    assert.equal(dateAsked("Which hospital was he taken to?"), null);
  });
  t("C44 binding grader v3: 365-day conclusions are found, the condition itself and conditional wording are not", () => {
    for (const x of ["He died within 365 days of the accident.", "The 365-day condition is met.", "Death occurred within the 365 days, so it qualifies.", "His death was outside the 365-day window.", "This satisfies the 365-day requirement."]) assert.equal(days365Conclusions(x).length, 1, x);
    for (const x of ["Accidental Death: 100% of the Sum Insured if death results from an Accident within 365 days.", "Whether he died within 365 days of the accident decides the PA benefit.", "Did he die within 365 days of the accident?"]) assert.deepEqual(days365Conclusions(x), [], x);
  });
  const base = "Darren's certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000 as of 6 October 2022; the PA summary pays Accidental Death if death occurs within 365 days of the Accident.";
  const conv3 = (turns: { user: string; visible: string; questions: string[]; fbs?: any[] }[]) => [{ scenario: "S50", turns: turns.map((x) => ({ user: x.user })), loaded: { turns: turns.map((x) => ({ visible: x.visible, questions: x.questions, answer: { figureBindings: x.fbs ?? [fb(1000000, "Group Term Life"), fb(600000, "Group Personal Accident")] }, trace: { outcome: "final_answer", toolCalls: [] } })) } }];
  const bad3 = (c: any[]) => gradeBindingV3(c).checks.filter((x) => !x.ok).map((x) => x.name);
  const U1 = "Darren died in a car accident in Japan, what can I do?", U2 = "The accident happened on 3 October 2026 and he died on 5 October 2026.";
  t("C45 binding grader v3: a correct two-turn conversation passes, whichever date is asked first", () => {
    for (const q of ["On what date did the accident happen?", "What was Darren's date of death?"]) assert.deepEqual(bad3(conv3([{ user: U1, visible: base, questions: [q] }, { user: U2, visible: base + " He died within 365 days of the accident.", questions: [] }])), [], q);
  });
  t("C46 binding grader v3: a 365-day conclusion before both dates, a swapped binding, and re-asking a given date FAIL", () => {
    assert.ok(bad3(conv3([{ user: U1, visible: base + " He died within 365 days of the accident.", questions: ["On what date did the accident happen?"] }, { user: U2, visible: base, questions: [] }])).some((n) => /before both/.test(n)));
    assert.ok(bad3(conv3([{ user: U1, visible: base, questions: ["When did the accident happen?"], fbs: [fb(600000, "Group Term Life"), fb(1000000, "Group Personal Accident")] }, { user: U2, visible: base, questions: [] }])).some((n) => /identity/.test(n)));
    assert.ok(bad3(conv3([{ user: U1, visible: base, questions: ["When did the accident happen?"] }, { user: U2, visible: base, questions: ["When did Darren die?"] }])).some((n) => /neither is asked/.test(n)));
    assert.ok(bad3(conv3([{ user: U1, visible: base, questions: ["When did the accident happen?"] }, { user: U2, visible: base + " His death was outside the 365-day window.", questions: [] }])).some((n) => /agrees with the dates/.test(n)));
  });
}

// V1.4: a run refuses to start when the SHA it would record is not the checked-out code (s50-live-1 recorded a stale
// SHA). Temporary trees; no model call.
{
  const SHA = "a".repeat(40), OTHER = "b".repeat(40);
  const tree = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "prov-"));
    fs.mkdirSync(path.join(d, "lib")); fs.mkdirSync(path.join(d, "scripts")); fs.mkdirSync(path.join(d, ".next"));
    fs.writeFileSync(path.join(d, "lib/a.ts"), "export const a = 1;\n"); fs.writeFileSync(path.join(d, "scripts/b.ts"), "b\n");
    const t = Date.now() / 1000; fs.utimesSync(path.join(d, "lib/a.ts"), t - 100, t - 100); fs.utimesSync(path.join(d, "scripts/b.ts"), t - 100, t - 100);
    fs.writeFileSync(path.join(d, ".next/BUILD_ID"), "x");
    const manifest = { sha: SHA, files: { "lib/a.ts": blobSha(fs.readFileSync(path.join(d, "lib/a.ts"))), "scripts/b.ts": blobSha(fs.readFileSync(path.join(d, "scripts/b.ts"))) } };
    return { d, manifest };
  };
  const noGit = () => null;
  t("C47 provenance: the recorded SHA's tree and a newer build start the run; every mismatch refuses", () => {
    const { d, manifest } = tree();
    const ok = checkProvenance({ recordedSha: SHA, cwd: d, manifest, git: noGit });
    assert.ok(ok.ok, JSON.stringify(ok));
    const no = (r: ReturnType<typeof checkProvenance>, re: RegExp) => { assert.equal(r.ok, false); assert.match((r as { reason: string }).reason, re); };
    no(checkProvenance({ recordedSha: null, cwd: d, manifest, git: noGit }), /no full 40-character/);
    no(checkProvenance({ recordedSha: OTHER, cwd: d, manifest, git: noGit }), /manifest is for/);
    no(checkProvenance({ recordedSha: SHA, cwd: d, manifest: null, git: noGit }), /no tree manifest/);
    fs.writeFileSync(path.join(d, "lib/extra.ts"), "x\n");
    no(checkProvenance({ recordedSha: SHA, cwd: d, manifest, git: noGit }), /not in that commit.*lib\/extra\.ts/);
    fs.rmSync(path.join(d, "lib/extra.ts"));
    fs.writeFileSync(path.join(d, "lib/a.ts"), "export const a = 2;\n");
    no(checkProvenance({ recordedSha: SHA, cwd: d, manifest, git: noGit }), /1 file\(s\) differ \(lib\/a\.ts\)/);
    const { d: d2, manifest: m2 } = tree();
    fs.utimesSync(path.join(d2, "lib/a.ts"), Date.now() / 1000 + 50, Date.now() / 1000 + 50);
    no(checkProvenance({ recordedSha: SHA, cwd: d2, manifest: m2, git: noGit }), /build is older/);
  });
  t("C48 provenance (git checkout): HEAD must be the recorded SHA, or a request commit on it changing only run-request.json; a dirty tree refuses", () => {
    const { d } = tree();
    const g = (map: Record<string, string>) => (c: string) => map[c] ?? null;
    const base = { "git ls-files": "lib/a.ts\nscripts/b.ts", "git status --porcelain --untracked-files=no": "" };
    assert.ok(checkProvenance({ recordedSha: SHA, cwd: d, git: g({ ...base, "git rev-parse HEAD": SHA }) }).ok);
    assert.ok(checkProvenance({ recordedSha: SHA, cwd: d, git: g({ ...base, "git rev-parse HEAD": OTHER, "git rev-parse HEAD^1": SHA, [`git diff --name-only ${SHA} HEAD`]: "scripts/rag2-live/run-request.json" }) }).ok);
    assert.equal(checkProvenance({ recordedSha: SHA, cwd: d, git: g({ ...base, "git rev-parse HEAD": OTHER, "git rev-parse HEAD^1": SHA, [`git diff --name-only ${SHA} HEAD`]: "scripts/rag2-live/run-request.json\nlib/a.ts" }) }).ok, false);
    assert.equal(checkProvenance({ recordedSha: SHA, cwd: d, git: g({ ...base, "git rev-parse HEAD": OTHER, "git rev-parse HEAD^1": "c".repeat(40) }) }).ok, false);
    assert.equal(checkProvenance({ recordedSha: SHA, cwd: d, git: g({ ...base, "git rev-parse HEAD": SHA, "git status --porcelain --untracked-files=no": " M lib/a.ts" }) }).ok, false);
  });
}

// V1.4 binding grader version 4 (written before s50-live-2): inventory padding, injury wording in a death answer and
// invented paperwork, with independent controls.
{
  t("C49 grader v4: paperwork only where Darren's documents print it, or labelled as a suggestion, or asked of the insurer", () => {
    assert.deepEqual(inventedPaperwork("Notify Meridian Life Ltd of a death within 6 months, with the death certificate."), []);
    assert.equal(inventedPaperwork("Provide the death certificate and relevant medical records.").length, 1);
    assert.equal(inventedPaperwork("[next] Keep the police report from Japan.").length, 1);
    assert.deepEqual(inventedPaperwork("[next] Suggestion, not stated in your documents (confirm with the insurer): keep the police report from Japan."), []);
    assert.deepEqual(inventedPaperwork("[next] Ask Meridian Life Ltd whether it needs a police report from Japan."), []);
    assert.deepEqual(inventedPaperwork("The documents do not state which medical records are needed."), []);
  });
  const mk4 = (v1: string, v2: string, q1: string[] = ["On what date did the accident happen?"]) => [{ scenario: "S50", turns: [{ user: "Darren died in a car accident in Japan, what can I do?" }, { user: "The accident happened on 3 October 2026 and he died on 5 October 2026." }], loaded: { turns: [v1, v2].map((v, i) => ({ visible: v, questions: i ? [] : q1, answer: { figureBindings: [{ value: 1000000, benefit: "Group Term Life", subjectId: "7f000000-0000-4000-8000-000000000001", rowPerson: "Tan Kai Ming, Darren", policyId: "7f000000-0000-4000-8000-000000000101" }, { value: 600000, benefit: "Group Personal Accident", subjectId: "7f000000-0000-4000-8000-000000000001", rowPerson: "Tan Kai Ming, Darren", policyId: "7f000000-0000-4000-8000-000000000101" }] }, trace: { outcome: "final_answer", toolCalls: [] } })) } }];
  const good = "Darren's certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000 as of 6 October 2022. The PA summary pays Accidental Death if death occurs within 365 days of the Accident.";
  const bad4 = (c: any[]) => gradeBindingV4(c).checks.filter((x) => !x.ok).map((x) => x.name);
  t("C50 grader v4: a correct conversation passes; inventory padding, injury wording and invented paperwork each FAIL", () => {
    assert.deepEqual(bad4(mk4(good, good)), []);
    assert.ok(bad4(mk4(good + "\nNot linked to anyone in the household: PawSafe Pet Insurance - Policy Wording (Lumen General).", good)).some((n) => /inventory/.test(n)));
    assert.ok(bad4(mk4(good, good + " Whether Darren's death meets the definition must be confirmed through the insurer's medical assessment.")).some((n) => /injury/.test(n)));
    assert.ok(bad4(mk4(good, good + "\n[next] Provide the death certificate and relevant medical records.")).some((n) => /paperwork/.test(n)));
  });
}

console.log(`\nrag2-live checker regressions ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
