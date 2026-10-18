/**
 * Death-journey applicability at the final structured-statement boundary (after dj-live-2, DI).
 * Real chat route, scripted model, the death-journey household. Each benefit has an explicit applicability result for the reported cause
 * (supported / not_applicable / unresolved, with its source and the reported facts it depends on) and EVERY output path honours it:
 * the model's statements, the server's completion, certificate summaries, repair and budget fallbacks.
 *   A1  dj-live-2 DI replayed with the model's recorded tool calls and both recorded final answers (one stray value id "v1"):
 *       Term Life S$1,000,000 (dated) is kept; no accident-only amount (Personal Accident S$600,000) is presented as payable; never
 *       "no amount is given" beside a shown amount; returned = saved = displayed
 *   A2  a stray citation does not cost the supported amount (recovered from the validated record), but a wrong-person / wrong-currency /
 *       stale / inapplicable claim is never restored
 *   A3  accident, illness, unknown; corrections both ways
 *   A4  a direct historical Personal Accident amount question: shown, separated from this event, nothing promised
 *   A5  another person; a superseded source
 *   A6  budget fallback and the certificate summary path honour applicability
 *   A7  a policy whose actual wording differs from this fixture (applicability from the benefit's own wording, not its product name)
 *   node --import tsx scripts/reliable-chat-death-applicability.ts      (SHOW=1 prints each answer)
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as DJR from "./fixtures/reliable-chat/death-journey-actual-values";
import { D } from "./fixtures/reliable-chat/death-journey-conversations";
import * as DJ from "./fixtures/reliable-chat/death-journey";
import { ScriptedLoopModel, type ScriptTurn, type ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const visible = (a: any) => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text ?? q.question ?? ""), ...uniqueSteps(a.nextSteps)].filter(Boolean).join("\n");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "\n     " + detail.split("\n").slice(0, 6).join("\n     ")}`); };
const benefitIdOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") for (const d of o.result?.data?.documents ?? []) for (const b of d.benefits ?? []) if (re.test(b.benefit) && b.benefit_id) return b.benefit_id as string; return "missing"; };
/** The n-th value key (from the end) the server issued for a select_table_value of this turn. */
const keyOf = (v: ScriptView, back = 0) => {  const ks = [...v.turn].filter((o) => o.name === "select_table_value" && o.ok).map((o) => (o.result?.data?.valueId ?? o.result?.data?.key) as string).filter(Boolean); return ks[ks.length - 1 - back] ?? "missing"; };

async function run(label: string, turns: ScriptTurn[], fn: (out: { v: string; tr: any; raw: any }[]) => void, fx: any = DJR) {
  setEnv(fx);
  const h = await startHarness(fx);
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
      // reopened: the answer the conversation shows when it is loaded again equals what was returned
      let reopened = saved;
      try { const r2 = await h.savedAnswer(a.conversationId!); reopened = visible(r2.answer); } catch { /* same */ }
      check(`${label}: returned = saved = reopened/displayed (turn ${out.length + 1})`, shown === saved && saved === reopened && shown.length > 0, `${shown}\n---\n${saved}`);
      if (process.env.SHOW) console.log(`--- ${label} turn ${out.length + 1}\n${saved}\n  adjusted: ${JSON.stringify(tr.adjusted ?? [])}\n  dropped: ${JSON.stringify((tr.dropped ?? []).map((d: any) => d.reason + " :: " + String(d.sentence).slice(0, 80)))}`);
      out.push({ v: saved, tr, raw: s.answer });
    }
    fn(out);
  } finally { installLoopModel(null); await h.db.close(); }
}
const CERT = DJR.doc("CERT").id;
const NOT_PROMISED = (v: string) => !/\b(?:will|would|shall) be paid\b|you will receive|is payable to you|you can claim/i.test(v);
/** "no amount is given for X" while that amount is shown elsewhere */
const CONTRADICTS = (v: string) => /no amount is given/i.test(v) && /600,000/.test(v);

// ---- A1: dj-live-2 DI, recorded ----
const DI = "Daniel passed away last week after a long illness - it was not an accident. What would the family receive from his insurance, and what should we do?";
const SEL = (benefit: string) => call("select_table_value", { want: "amount", benefit, policy_id: CERT, subject_id: D });
const CDA_NOTE = (id: string, name: string) => ({ kind: "fact", text: `For a death reported as an illness, ${name}`, subject_id: D, evidence_ids: [id] });
const diFinal = (v: ScriptView, pass: 1 | 2) => {
  const k = (n: number) => keyOf(v, n);
  const termFact = "Daniel’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; that dated amount is not confirmation of cover on the date of death. [Page 1]";
  const summary = "The Group Insurance Product Summary says Group Term Life pays 100% of the Sum Assured for death or terminal illness, provided death occurs while the insured person is covered, and defines the Sum Assured as the amount on the person’s certificate. [Page 12]";
  const accidentRelated = "The Group Insurance Product Summary describes Accidental Death as a separate benefit, and the Compassionate Death Allowance wording applies only when death results from an accident; based on what you told me, those accident-related terms do not match Daniel’s reported death. [Pages 12, 9]";
  const suggestion = "Suggested next step: contact the employer or scheme administrator and Aldermoor Life Ltd to confirm cover on the date of death, the beneficiary/claimant process, and the required claim documents; the uploaded documents do not set out that process.";
  const cda = "For a death reported as an illness, Compassionate Death Allowance Benefit is printed as accident-only (printed condition: “If an Insured Person dies as a result of an Accident”), so it does not fit that report and no amount is given for it.";
  const pa = "For a death reported as an illness, Group Personal Accident is printed as accident-only, so it does not fit that report and no amount is given for it.";
  const ad = "For a death reported as an illness, Accidental Death is printed as accident-only and Death due to natural catastrophe is printed for a natural catastrophe, so they do not fit that report and no amount is given for them.";
  const steps = ["Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim."];
  const ev = (re: RegExp) => { const ids = new Set<string>(); for (const o of v.turn) for (const e of o.result?.evidence ?? []) { if (re.test(e.passage?.text ?? "")) ids.add(e.id); } return [...ids][0] ?? "e1"; };
  void ev;
  const uncertainty1 = "The uploaded documents do not establish whether Daniel was covered when he died last week, so they do not establish what the family will receive; the certificate’s listed amount is dated 2022 and the summary does not state a coverage period. [Pages 1, 12]";
  const uncertainty2 = "The uploaded documents do not establish whether Daniel was covered when he died last week; the certificate lists S$1,000,000 as of 6 October 2022, and the summary does not state a coverage period. [Pages 1, 12]";
  const e = { cert: "e1", summ: "e16", acc: "e18", cda: "e12", pa: "e2", ad: "e3", nat: "e8" };
  const s = pass === 1
    ? [{ kind: "fact", text: termFact, evidence_ids: [e.cert] }, { kind: "fact", text: summary, evidence_ids: [e.summ] }, { kind: "uncertainty", text: uncertainty1, evidence_ids: [e.cert, e.summ] }, { kind: "fact", text: accidentRelated, evidence_ids: [e.summ, e.acc] }, { kind: "suggestion", text: suggestion }, { kind: "fact", text: cda, subject_id: D, evidence_ids: [e.cda] }, { kind: "fact", text: pa, subject_id: D, evidence_ids: [e.pa] }, { kind: "fact", text: ad, subject_id: D, evidence_ids: [e.ad, e.nat] }]
    : [{ kind: "fact", text: termFact, value_ids: ["v1"], evidence_ids: [e.cert] }, { kind: "fact", text: summary, evidence_ids: [e.summ] }, { kind: "uncertainty", text: uncertainty2, value_ids: ["v1"], evidence_ids: [e.cert, e.summ] }, { kind: "fact", text: accidentRelated, evidence_ids: [e.summ, e.acc] }, { kind: "suggestion", text: suggestion }, { kind: "fact", text: cda, subject_id: D, evidence_ids: [e.cda] }, { kind: "fact", text: pa, subject_id: D, evidence_ids: [e.pa] }, { kind: "fact", text: ad, subject_id: D, evidence_ids: [e.ad, e.nat] },
      { kind: "benefit_terms", text: "Daniel's certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.", benefit: "Group Term Life", value_ids: ["v1"], benefit_id: "bde834f90e0", subject_id: D, evidence_ids: [e.cert] }];
  void CDA_NOTE;
  return call("final_answer", { sentences: s, next_steps: steps, subject_id: D });
};
const diTurn: ScriptTurn = { user: DI, steps: [
  () => [call("resolve_person", { mention: "Daniel" })],
  () => [call("note_facts", { facts: [{ key: "death", value: "passed away last week", words: "Daniel passed away last week" }, { key: "illness_duration", value: "long illness", words: "after a long illness" }, { key: "how_it_happened", value: "not an accident", words: "it was not an accident" }], subject_id: D })],
  () => [call("person_benefits", { topic: "death after illness", subject_id: D })],
  () => [call("search_passages", { query: "Group Term Life death benefit natural death illness beneficiary claim notification documents proof of death claim procedure", subject_id: D })],
  () => [call("search_passages", { query: "Compassionate Death Allowance Benefit death as a result of accident conditions", subject_id: D })],
  () => [call("policies_for", { as_of: "2026-10-18", topic: "death life insurance", subject_id: D })],
  (v: ScriptView) => [diFinal(v, 1)],
  (v: ScriptView) => [diFinal(v, 2)],
] };

(async () => {
  await run("A1 dj-live-2 DI replay", [diTurn], ([o]) => {
    check("A1 Term Life S$1,000,000 (Daniel's certificate, dated 6 October 2022) is stated", /Group Term Life/.test(o.v) && /1,000,000/.test(o.v) && /6 October 2022|06\/10\/2022/.test(o.v), o.v);
    check("A1 the dated Term Life amount is not presented as confirmed cover or a payment", !/will be paid|you will receive|is payable to you|confirmed (?:cover|eligib)/i.test(o.v) && /(?:not confirmation|do not establish|does not establish|not established)/i.test(o.v), o.v);
    check("A1 no accident-only amount: no S$600,000 and no certificate line for Personal Accident", !/600,000/.test(o.v) && !/lists Daniel's Group Personal Accident/i.test(o.v), o.v);
    check("A1 no 'schedule's percentages' line for a death question", !/schedule's percentages/i.test(o.v), o.v);
    check("A1 never 'no amount is given' while that amount is shown", !CONTRADICTS(o.v), o.v);
    check("A1 the accident-only benefits are still named with their reason", /Personal Accident/.test(o.v) && /accident-only/i.test(o.v) && /not fit that report/.test(o.v), o.v);
    check("A1 a visible next step and nothing promised", /Contact Aldermoor Life Ltd/.test(o.v) && NOT_PROMISED(o.v), o.v);
  });

  // ---- shared moves ----
  const ILL = "Daniel passed away last week after a long illness - it was not an accident. What would the family receive from his insurance, and what should we do?";
  const UNK = "Daniel passed away last week. What would the family receive from his insurance, and what should we do?";
  const ACC = "Daniel died in an accident last week. What would the family receive from his insurance, and what should we do?";
  const fact = (k: string, val: string, w: string) => call("note_facts", { subject_id: D, facts: [{ key: k, value: val, words: w }] });
  const evId = (v: ScriptView, re: RegExp) => { for (const o of v.turn) for (const e of o.result?.evidence ?? []) if (re.test(e.passage?.text ?? "") && e.id) return e.id as string; return "e1"; };
  const base = (cause: [string, string] | null) => [
    () => [call("resolve_person", { mention: "Daniel" }), ...(cause ? [fact("how_it_happened", cause[0], cause[1])] : [])],
    () => [call("person_benefits", { subject_id: D, topic: "death" })],
  ];
  const TL = (v: ScriptView) => ({ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Group Term Life/i), subject_id: D });
  const PA = (v: ScriptView) => ({ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Group Personal Accident/i), subject_id: D });
  const NO_PA = (t: string) => !/600,000/.test(t);
  const NO_CONTRA = (t: string) => !CONTRADICTS(t);

  // ---- A2: a stray citation does not cost the supported amount; a wrong claim is never restored ----
  await run("A2a stray citation", [{ user: ILL, steps: [
    ...base(["illness", "it was not an accident"]),
    () => [SEL("Group Term Life")],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      { kind: "fact", text: "Daniel’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; that dated amount is not confirmation of cover on the date of death.", subject_id: D, value_ids: ["v99", keyOf(v)], evidence_ids: [evId(v, /Lee Wei Ming/)] },
    ], next_steps: [] })],
  ] }], ([o]) => {
    check("A2a the stray id is set aside: the supported Term Life amount and its dated caveat are kept", /1,000,000/.test(o.v) && /not confirmation of cover/.test(o.v), o.v);
    check("A2a no accident-only amount appears", NO_PA(o.v) && NO_CONTRA(o.v), o.v);
  });
  await run("A2b wrong claims not restored", [{ user: ILL, steps: [
    ...base(["illness", "it was not an accident"]),
    () => [SEL("Group Term Life")], () => [SEL("Group Personal Accident")],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      // wrong amount (bound to the real value), wrong currency, another person's amount, an inapplicable benefit's amount
      { kind: "fact", text: "Daniel’s certificate lists Group Term Life of S$900,000 as of 6 October 2022.", subject_id: D, value_ids: [keyOf(v, 1)], evidence_ids: [evId(v, /Lee Wei Ming/)] },
      { kind: "fact", text: "Daniel’s certificate lists Group Term Life of US$1,000,000 as of 6 October 2022.", subject_id: D, value_ids: [keyOf(v, 1)], evidence_ids: [evId(v, /Lee Wei Ming/)] },
      { kind: "fact", text: "Daniel’s certificate lists Group Term Life of S$200,000 as of 1 July 2024.", subject_id: D, value_ids: [keyOf(v, 1)], evidence_ids: [evId(v, /Lee Wei Ming/)] },
      { kind: "fact", text: "Daniel’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022.", subject_id: D, value_ids: ["v98", keyOf(v, 0)], evidence_ids: [evId(v, /Lee Wei Ming/)] },
    ], next_steps: [] })],
  ] }], ([o]) => {
    check("A2b the wrong S$900,000, US$ and Grace's S$200,000 are not stated", !/900,000|US\$|200,000/.test(o.v), o.v);
    check("A2b the inapplicable Personal Accident amount is not restored", NO_PA(o.v), o.v);
    check("A2b the supported Term Life amount IS recovered from the validated record (S$1,000,000, dated)", /Group Term Life/.test(o.v) && /S\$1,000,000/.test(o.v) && /6 October 2022/.test(o.v), o.v);
  });

  // ---- A3: accident, illness, unknown; corrections both ways ----
  await run("A3a unknown cause", [{ user: UNK, steps: [...base(null), (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [TL(v)], next_steps: [] })]] }], ([o]) => {
    check("A3a Term Life amount stated and the accident condition of the accident benefits stated; an accident is not assumed", /1,000,000/.test(o.v) && /only to a death caused by an Accident/.test(o.v) && /not assumed/.test(o.v), o.v);
    check("A3a nothing promised, and no 'no amount is given' beside a shown amount", NOT_PROMISED(o.v) && NO_CONTRA(o.v), o.v);
  });
  await run("A3b accident", [{ user: ACC, steps: [...base(["accident", "died in an accident"]), (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [TL(v), PA(v)], next_steps: [] })]] }], ([o]) => {
    check("A3b both the Term Life and the Personal Accident amounts are stated (an accident is reported)", /1,000,000/.test(o.v) && /600,000/.test(o.v), o.v);
    check("A3b no accident-only note and no 'no amount is given'", !/accident-only|not fit that report|no amount is given/.test(o.v), o.v);
  });
  await run("A3c illness then accident", [
    { user: ILL, steps: [...base(["illness", "it was not an accident"]), (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [TL(v)], next_steps: [] })]] },
    { user: "I am sorry, I was wrong: it was an accident after all. What would the family receive?", steps: [
      () => [fact("how_it_happened", "accident", "it was an accident after all"), call("person_benefits", { subject_id: D, topic: "death" })],
      (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [TL(v), PA(v)], next_steps: [] })],
    ] },
  ], ([a, b]) => {
    check("A3c turn 1 (illness): no Personal Accident amount", NO_PA(a.v) && /1,000,000/.test(a.v), a.v);
    check("A3c turn 2 (corrected to an accident): the Personal Accident amount is presented again; no stale 'no amount is given' / accident-only note", /600,000/.test(b.v) && !/accident-only|not fit that report|no amount is given/.test(b.v), b.v);
  });
  await run("A3d accident then illness", [
    { user: ACC, steps: [...base(["accident", "died in an accident"]), (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [TL(v), PA(v)], next_steps: [] })]] },
    { user: "Sorry, I was wrong. Actually he died of an illness, not an accident. What would the family receive?", steps: [
      () => [fact("how_it_happened", "illness", "he died of an illness, not an accident"), call("person_benefits", { subject_id: D, topic: "death" })],
      (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [TL(v), PA(v)], next_steps: [] })],
    ] },
  ], ([a, b]) => {
    check("A3d turn 1 (accident): the Personal Accident amount is stated", /600,000/.test(a.v), a.v);
    check("A3d turn 2 (corrected to an illness): the Personal Accident amount is withdrawn (the model selected it again) and the note says why", NO_PA(b.v) && /accident-only/.test(b.v) && /1,000,000/.test(b.v) && NO_CONTRA(b.v), b.v);
  });

  // ---- A4: a direct historical amount question ----
  await run("A4 direct historical PA amount", [{ user: "Daniel passed away last week after a long illness - it was not an accident. What S$ amount does his certificate list for Group Personal Accident, and what would the family receive?", steps: [
    ...base(["illness", "it was not an accident"]),
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [TL(v), PA(v)], next_steps: [] })],
  ] }], ([o]) => {
    check("A4 the certificate's dated Personal Accident amount is shown because it was asked for", /Group Personal Accident/.test(o.v) && /600,000/.test(o.v) && /6 October 2022/.test(o.v), o.v);
    check("A4 it is separated from this event: the answer says it is not an amount for this death and does not apply to a death by illness", /not an amount for this death/.test(o.v) && /accident/i.test(o.v), o.v);
    check("A4 never 'no amount is given' while the amount is shown, and nothing promised", NO_CONTRA(o.v) && !/no amount is given for (?:it|them)[^.]*Group Personal Accident/i.test(o.v) && NOT_PROMISED(o.v), o.v);
    check("A4 Term Life stays the supported dated amount", /1,000,000/.test(o.v), o.v);
  });

  // ---- A5: another person; a superseded source ----
  await run("A5a another person", [{ user: ILL, steps: [
    ...base(["illness", "it was not an accident"]),
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      TL(v),
      { kind: "fact", text: "Grace’s certificate lists Group Term Life of S$200,000 as of 1 July 2024.", subject_id: D, evidence_ids: [evId(v, /Tan Hui Min/)] },
    ], next_steps: [] })],
  ] }], ([o]) => {
    check("A5a Daniel's own amount is stated and no other person's amount (Grace S$200,000 / S$100,000) is", /1,000,000/.test(o.v) && !/200,000|100,000/.test(o.v), o.v);
    check("A5a no accident-only amount for Daniel either", NO_PA(o.v), o.v);
  });
  const OLD = { ...DJ.doc("CERT"), key: "OLD_CERT", id: "7c000000-0000-4000-8000-000000000301", hash: "sha256:old-cert", superseded: true } as any;
  const FX_OLD = { ...DJR, DOCS: [...DJR.DOCS, OLD] };
  await run("A5b superseded source", [{ user: ILL, steps: [
    ...base(["illness", "it was not an accident"]),
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      TL(v),
      { kind: "fact", text: "Daniel’s earlier certificate lists Group Term Life of S$500,000 as of 1 April 2024.", subject_id: D, evidence_ids: [evId(v, /Lee Wei Ming/)] },
    ], next_steps: [] })],
  ] }], ([o]) => {
    check("A5b the current S$1,000,000 (6 October 2022) is stated; the superseded certificate's S$500,000 is not", /1,000,000/.test(o.v) && !/500,000/.test(o.v), o.v);
    check("A5b no accident-only amount", NO_PA(o.v), o.v);
  }, FX_OLD);

  // ---- A6: budget fallback; certificate summary ----
  process.env.DEARPOLICY_RAG_LOOP_MAX_STEPS = "2";
  try {
    await run("A6a budget stop, death question", [{ user: ILL, steps: [
      () => [call("resolve_person", { mention: "Daniel" }), fact("how_it_happened", "illness", "it was not an accident"), call("person_benefits", { subject_id: D, topic: "death" })],
      () => [call("search_passages", { query: "death claim notification", subject_id: D })],
      () => [call("search_passages", { query: "more", subject_id: D })],
    ] }], ([o]) => {
      check("A6a the budget fallback states Term Life S$1,000,000 and names the accident-only benefits without their amounts", /1,000,000/.test(o.v) && /accident-only/.test(o.v) && NO_PA(o.v) && NO_CONTRA(o.v), o.v);
      check("A6a it says it stopped, and promises nothing", /model-use limit/.test(o.v) && NOT_PROMISED(o.v), o.v);
    });
    await run("A6b budget stop, partial answer (two topics)", [{ user: "Daniel died of an illness, it was not an accident. Besides the death benefits, what does he get for a hospital stay?", steps: [
      () => [call("resolve_person", { mention: "Daniel" }), fact("how_it_happened", "illness", "it was not an accident"), call("person_benefits", { subject_id: D, topic: "death" })],
      () => [SEL("Group Term Life"), SEL("Group Personal Accident")],
      () => [call("search_passages", { query: "hospital", subject_id: D })],
    ] }], ([o]) => {
      check("A6b the partial answer never presents the accident-only Personal Accident amount for the reported illness", NO_PA(o.v), o.v);
    });
  } finally { delete process.env.DEARPOLICY_RAG_LOOP_MAX_STEPS; }
  await run("A6c certificate summary", [{ user: ILL, steps: [
    ...base(["illness", "it was not an accident"]),
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      TL(v),
      { kind: "uncertainty", text: "The uploaded documents do not confirm Daniel’s enrolment in the group scheme.", subject_id: D, evidence_ids: [evId(v, /Lee Wei Ming/)] },
    ], next_steps: [] })],
  ] }], ([o]) => {
    check("A6c the certificate summary lists Daniel under Group Term Life, dated, and not under the withheld Group Personal Accident", /lists Daniel under Group Term Life/.test(o.v) && !/under Group Term Life and Group Personal Accident/.test(o.v), o.v);
  });

  // ---- A7: a policy whose actual wording differs: applicability from the benefit's own wording, not its product name ----
  const withPages = (fx: any, edits: { key: string; page: number; fn: (t: string) => string }[], drop: string[] = []) => ({ ...fx, DOCS: fx.DOCS.filter((d: any) => !drop.includes(d.key)).map((d: any) => { const e = edits.filter((x) => x.key === d.key); return e.length ? { ...d, hash: d.hash + "-v", pages: Object.fromEntries(Object.entries(d.pages).map(([pg, t]) => [pg, e.filter((x) => String(x.page) === pg).reduce((a, x) => x.fn(a), t as string)])) } : d; }) });
  // A7a: no document prints a cause condition for the Personal Accident amount (its benefit summary is not in the library): the NAME alone does
  // not decide -- the result is unresolved, said as that, and the amount is still not presented as payable for a reported illness
  await run("A7a name alone does not decide", [{ user: ILL, steps: [
    ...base(["illness", "it was not an accident"]),
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [TL(v), PA(v)], next_steps: [] })],
  ] }], ([o]) => {
    check("A7a Term Life stated; the Personal Accident amount is not presented as payable", /1,000,000/.test(o.v) && NO_PA(o.v), o.v);
    check("A7a it is NOT said to be 'printed as accident-only' (no document prints that for this amount); the uncertainty is said as it is", /Group Personal Accident/.test(o.v) && !/Group Personal Accident is printed as accident-only/.test(o.v) && /no cause condition/.test(o.v), o.v);
  }, withPages(DJR, [], ["PA_SUMMARY", "PRODUCT_SUMMARY", "BOOKLET"]));
  // A7b: the booklet of THIS policy prints the allowance with no accident condition ("If an Insured Person dies, we will pay ..."): the
  // fixture's accident wording is not assumed -- the allowance is presented for a reported illness, with its printed amount
  const ANYCAUSE = withPages(DJR, [{ key: "BOOKLET", page: 9, fn: (t) => t.replace("If an Insured Person dies as a result of an Accident, we will pay", "If an Insured Person dies, we will pay") }]);
  await run("A7b wording without an accident condition", [{ user: ILL, steps: [...base(["illness", "it was not an accident"]), (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [TL(v)], next_steps: [] })]] }], ([o]) => {
    check("A7b the allowance is NOT withheld as accident-only when this policy's wording sets no accident condition", /Compassionate Death Allowance/.test(o.v) && !/Compassionate Death Allowance Benefit is printed as accident-only/.test(o.v) && /2,000/.test(o.v), o.v);
    check("A7b the benefits whose wording does set it (Personal Accident, Accidental Death) are still withheld", NO_PA(o.v) && /accident-only/.test(o.v), o.v);
  }, ANYCAUSE);

  // ---- A2c-e: the remaining paths, each reaching its own repair ----
  // A2c: the model names Term Life only through the product summary (no amount, no benefit_terms): the amount is completed from the person's record
  await run("A2c amount not shown", [{ user: ILL, steps: [
    ...base(["illness", "it was not an accident"]),
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      { kind: "fact", text: "The Group Insurance Product Summary says Group Term Life pays 100% of the Sum Assured for death or terminal illness, provided death occurs while the insured person is covered, and defines the Sum Assured as the amount on the person’s certificate. [Page 12]", evidence_ids: [evId(v, /Group Term Life: Death or Terminal Illness/)] },
    ], next_steps: [] })],
  ] }], ([o]) => {
    check("A2c a benefit named without its amount is completed with the person's dated amount from the record", /Group Term Life[^\n]*S\$1,000,000/.test(o.v) && NO_PA(o.v), o.v);
  });
  // A2d: the household's own message speaks of a percentage of the sum insured, and the model answers with nothing: the server's fallback
  // completion must not pull in the accident-only Personal Accident sum insured
  await run("A2d fallback completion", [{ user: "Daniel passed away last week after a long illness - it was not an accident. What would the family receive, and is it a percentage of the sum insured?", steps: [
    ...base(["illness", "it was not an accident"]),
    (v: ScriptView) => [SEL("Group Personal Accident")],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "fact", text: "Whether the amount is a percentage of the sum insured is not stated for this death in the documents read.", subject_id: D }], next_steps: [] })],
  ] }], ([o]) => {
    check("A2d no Personal Accident amount and no 'schedule's percentages are of that sum insured' line for a death by illness", NO_PA(o.v) && !/schedule's percentages/i.test(o.v), o.v);
  });
  // A2e: a model statement that says no amount is given for a benefit whose amount the same answer shows
  await run("A2e contradiction", [{ user: ILL, steps: [
    ...base(["illness", "it was not an accident"]),
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      TL(v),
      { kind: "fact", text: "For a death reported as an illness, Group Term Life: no amount is given for it in these documents.", subject_id: D, evidence_ids: [evId(v, /Lee Wei Ming/)] },
    ], next_steps: [] })],
  ] }], ([o]) => {
    check("A2e the answer never says no amount is given for Group Term Life while showing S$1,000,000", /1,000,000/.test(o.v) && !/Group Term Life[^\n]*no amount is given/i.test(o.v), o.v);
  });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed"); process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
