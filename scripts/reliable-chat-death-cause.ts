/**
 * Death-journey cause / applicability (after dj-live-1): each benefit's OWN printed condition decides whether the reported cause of death fits it.
 * Real chat route, scripted model, the death-journey household (Term Life S$1,000,000; Personal Accident S$600,000, accident-only; Accidental Death;
 * Compassionate Death Allowance "if an Insured Person dies as a result of an Accident").
 *   C1 illness reported: Term Life stated; no accident-only benefit's terms/amount; the reply says why; no payment promise
 *   C2 cause unknown: the accident condition is stated and an accident is NOT assumed
 *   C3 accident reported: every benefit listed, no cause note
 *   C4 narrow Term Life question stays narrow (illness reported): nothing else added, no cause note
 *   C5 narrow question that NAMES an accident-only benefit, illness reported: its terms are not given; the note explains it
 *   C6 correction accident -> illness: the illustration worked out for the accident benefit is withdrawn and says so; Term Life remains
 *   C7 a statement of the model's own about an accident-only benefit is not kept for a reported illness
 * Every case also checks returned = saved = displayed and the person / product / currency checks of the existing suites remain (other suites).
 *   node --import tsx scripts/reliable-chat-death-cause.ts      (SHOW=1 prints each answer)
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as DJR from "./fixtures/reliable-chat/death-journey-actual-values";
import { D } from "./fixtures/reliable-chat/death-journey-conversations";
import { ScriptedLoopModel, type ScriptTurn, type ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const visible = (a: any) => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text ?? q.question ?? ""), ...uniqueSteps(a.nextSteps)].filter(Boolean).join("\n");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "\n     " + detail.split("\n").slice(0, 28).join("\n     ")}`); };
const benefitIdOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") for (const d of o.result?.data?.documents ?? []) for (const b of d.benefits ?? []) if (re.test(b.benefit) && b.benefit_id) return b.benefit_id as string; return "missing"; };

async function run(label: string, turns: ScriptTurn[], fn: (out: { v: string; tr: any; raw: any }[]) => void) {
  setEnv(DJR as any);
  const h = await startHarness(DJR as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  try {
    installLoopModel(new ScriptedLoopModel(turns));
    const out: { v: string; tr: any; raw: any }[] = [];
    let c: { id?: string; rev?: number } = {};
    for (const t of turns) {
      const a = await h.send(t.user as string, c); c = { id: a.conversationId, rev: a.conversationRevision };
      const s = await h.savedAnswer(a.conversationId!);
      const tr = s.state.ragLoop.turns.at(-1);
      const shown = visible(a), saved = visible(s.answer);
      check(`${label}: returned = saved = displayed (turn ${out.length + 1})`, shown === saved && shown.length > 0, `${shown}\n---\n${saved}`);
      if (process.env.SHOW) console.log(`--- ${label} turn ${out.length + 1}\n${saved}\n  adjusted: ${JSON.stringify(tr.adjusted ?? [])}\n  dropped: ${JSON.stringify(tr.dropped ?? [])}\n  corrections: ${JSON.stringify(tr.corrections ?? [])}`);
      out.push({ v: saved, tr, raw: s.answer });
    }
    fn(out);
  } finally { installLoopModel(null); await h.db.close(); }
}
const NOT_PROMISED = (v: string) => !/\b(?:will|would|shall) be paid\b|you will receive|is payable to you|you can claim/i.test(v);
const ILL = "Daniel died of an illness last week. What do we receive from his insurance and what should we do?";
const UNKNOWN = "Daniel passed away last week. What do we receive from his insurance and what should we do?";
const ACC = "Daniel died in an accident last week. What do we receive from his insurance and what should we do?";
const TERM_ONLY = (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) }], next_steps: [] })];
const fact = (k: string, w: string) => call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: k, words: w }] });

(async () => {
  // C1
  await run("C1 illness", [{ user: ILL, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), fact("illness", "died of an illness")],
    () => [call("person_benefits", { subject_id: D, topic: "death" })],
    TERM_ONLY,
  ] }], ([o]) => {
    check("C1 Term Life S$1,000,000 (the person's own, dated) is stated", /Group Term Life/.test(o.v) && /1,000,000/.test(o.v), o.v);
    check("C1 no accident-only benefit's amount or terms: no Personal Accident S$600,000, no allowance S$/2,000, no Accidental Death percentage", !/600,000/.test(o.v) && !/\b2,000\b/.test(o.v) && !/100%/.test(o.v) && !/proof of death/i.test(o.v), o.v);
    check("C1 the reply says the accident-only benefits do not fit a death by illness, quoting the printed condition, with no amount", /printed as accident-only/.test(o.v) && /reported as an illness/.test(o.v) && /not fit that report/.test(o.v) && /dies as a result of an Accident/.test(o.v), o.v);
    check("C1 nothing is promised as payable", NOT_PROMISED(o.v), o.v);
    check("C1 the next step is the person's own insurer", /Contact Aldermoor Life Ltd/.test(o.v), o.v);
    check("C1 no orphan condition or raw id", !/\bbn_[a-z0-9]+|\be\d{1,3}\b(?!\w)|benefit_id/.test(o.v), o.v);
  });
  // C2
  await run("C2 unknown", [{ user: UNKNOWN, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death" })],
    TERM_ONLY,
  ] }], ([o]) => {
    check("C2 Term Life stated", /Group Term Life/.test(o.v) && /1,000,000/.test(o.v), o.v);
    check("C2 the accident benefits are listed WITH their accident condition", /Personal Accident/.test(o.v) && /dies as a result of an Accident/.test(o.v), o.v);
    check("C2 it says they apply only to a death caused by an Accident and an accident is not assumed", /only to a death caused by an Accident/.test(o.v) && /not assumed/.test(o.v) && /printed as accident-only/.test(o.v), o.v);
    check("C2 nothing is promised as payable", NOT_PROMISED(o.v), o.v);
  });
  // C3
  await run("C3 accident", [{ user: ACC, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), fact("accident", "died in an accident")],
    () => [call("person_benefits", { subject_id: D, topic: "death" })],
    TERM_ONLY,
  ] }], ([o]) => {
    check("C3 Term Life, Personal Accident and the allowance are all listed", /Group Term Life/.test(o.v) && /600,000/.test(o.v) && /Compassionate Death Allowance/.test(o.v), o.v);
    check("C3 no cause note when an accident is reported", !/accident-only|not assumed|not fit that report/.test(o.v), o.v);
  });
  // C4
  const T4 = "Daniel died of an illness. What does his Group Term Life pay?";
  await run("C4 narrow", [{ user: T4, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), fact("illness", "died of an illness"), call("person_benefits", { subject_id: D, topic: "term life" })],
    TERM_ONLY,
  ] }], ([o]) => {
    check("C4 Term Life stated", /Group Term Life/.test(o.v) && /1,000,000/.test(o.v), o.v);
    check("C4 the narrow question is not expanded: no Personal Accident, no allowance, no cause note", !/Personal Accident|Compassionate|Accidental Death|accident-only/.test(o.v), o.v);
  });
  // C5
  const T5 = "Daniel died of an illness. Would the Compassionate Death Allowance Benefit pay anything towards the funeral?";
  await run("C5 named accident benefit", [{ user: T5, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), fact("illness", "died of an illness"), call("person_benefits", { subject_id: D, topic: "Compassionate Death Allowance funeral" })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Compassionate Death Allowance/i) }], next_steps: [] })],
  ] }], ([o]) => {
    check("C5 the allowance's terms and amount are not given for a death by illness", !/\b2,000\b/.test(o.v) && !/proof of death/i.test(o.v), o.v);
    check("C5 the reply names the allowance, its printed accident condition, and says it does not fit", /Compassionate Death Allowance/.test(o.v) && /dies as a result of an Accident/.test(o.v) && /not fit that report/.test(o.v), o.v);
    check("C5 Term Life is not added to a narrow question", !/Group Term Life/.test(o.v), o.v);
  });
  // C6 correction accident -> illness
  const U1 = "Daniel died in an accident last week. What would the Accidental Death benefit pay?";
  const U2 = "Sorry, I was wrong. Actually he died of an illness, not an accident. What do we receive?";
  await run("C6 correction", [
    { user: U1, steps: [
      () => [call("resolve_person", { mention: "Daniel" }), fact("accident", "died in an accident"), call("person_benefits", { subject_id: D, topic: "accidental death" })],
      (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: benefitIdOf(v, /Accidental Death/i), purpose: "claim", fact_keys: ["how_it_happened"] })],
      (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Accidental Death/i) }], next_steps: [] })],
    ] },
    { user: U2, steps: [
      () => [call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "illness", words: "he died of an illness, not an accident" }] }), call("person_benefits", { subject_id: D, topic: "death" })],
      TERM_ONLY,
    ] },
  ], ([a, b]) => {
    check("C6 turn 1: the accident benefit is stated for a reported accident", /Accidental Death/.test(a.v), a.v);
    check("C6 turn 2: Accidental Death is no longer presented; the accident-only note explains why", !/100%|Sum Insured/i.test(b.v) && /printed as accident-only/.test(b.v) && /reported as an illness/.test(b.v), b.v);
    check("C6 turn 2: Term Life remains", /Group Term Life/.test(b.v) && /1,000,000/.test(b.v), b.v);
    check("C6 turn 2: the correction is recorded in the trace (dependent illustration withdrawn)", JSON.stringify(b.tr.corrections ?? []).includes("how_it_happened") || JSON.stringify(b.tr.invalidated ?? b.tr.withdrawn ?? []).length > 2 || /accident-only/.test(b.v), JSON.stringify(b.tr.corrections));
  });
  // C7 the model's own fact about an accident-only benefit
  await run("C7 model sentence", [{ user: ILL, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), fact("illness", "died of an illness")],
    () => [call("person_benefits", { subject_id: D, topic: "death" })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      { kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) },
      { kind: "benefit_terms", benefit_id: benefitIdOf(v, /Accidental Death/i) },
    ], next_steps: [] })],
  ] }], ([o]) => {
    check("C7 the model's own selection of an accident-only benefit is left out for a reported illness", !/Accidental Death[^\n]*100%/i.test(o.v) && !/600,000/.test(o.v), o.v);
    check("C7 Term Life is kept", /1,000,000/.test(o.v), o.v);
  });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed"); process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
