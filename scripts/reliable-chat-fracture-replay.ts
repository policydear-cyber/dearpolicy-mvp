/**
 * Production fracture conversation (19 Oct 2026, production f3c9bcd) -- offline replay, scripted model, NO model call, no spend.
 *
 * The household's conversation ("<name> fell down and broke her arm", then the reply to the X-ray question) is replayed
 * through the real chat route: the model's own recorded calls (resolve_person, note_facts, person_benefits, two
 * evaluate_benefit, search_passages, then ONE ask_user "Was <name>'s fracture confirmed by X-ray and certified by a registered
 * medical practitioner?" carrying three statements; then, after "yes", two evaluate_benefit and final_answer) against an
 * anonymised copy of the library's stored pages (./fixtures/reliable-chat/fracture-conversation.ts). Only the product code
 * after the model changed, so the same script run on production code (f3c9bcd) shows the defects and on the fix shows the repair.
 *
 *   A  the recorded conversation -- no question the cited wording does not print; both documented alternatives together in the
 *      answer's first lines, never a total; the S$600,000 base dated; the contact step; returned = saved = reopened, both turns
 *   B  controls -- a question whose requirement IS printed is still asked; unit checks on the question test and the date reading;
 *      one documented term alone keeps its single-sentence headline; a dated Term Life amount keeps its date
 *   node --import tsx scripts/reliable-chat-fracture-replay.ts          (SHOW=1 prints every answer)
 */
import { NextRequest } from "next/server";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as FX from "./fixtures/reliable-chat/fracture-conversation";
import { ScriptedLoopModel, type ScriptTurn, type ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { cellDate } from "@/lib/rag2/tables";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 30).join("\n     ") : ""}`); };
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
/** Evidence ids, in any tool result of this turn, of an entry whose text matches. */
const idsAny = (v: ScriptView, re: RegExp, tool?: string): string[] => {
  const out: string[] = [];
  const walk = (x: any) => { if (!x || typeof x !== "object") return; if (typeof x.evidence_id === "string" && Object.values(x).some((f) => typeof f === "string" && re.test(f))) out.push(x.evidence_id); for (const k of Object.keys(x)) walk(x[k]); };
  for (const o of v.turn) if (!tool || o.name === tool) walk(o.result);
  return [...new Set(out)];
};
const benefitIdOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") { for (const sc of o.result?.data?.schedules ?? []) if (re.test(sc.benefit) && sc.benefit_id) return sc.benefit_id as string; for (const d of o.result?.data?.documents ?? []) for (const b of d.benefits ?? []) if (re.test(b.benefit) && b.benefit_id) return b.benefit_id as string; } return ""; };
const resultIds = (v: ScriptView) => [...v.turn].filter((o) => o.name === "evaluate_benefit" && o.ok && o.result?.data?.result_id).map((o) => o.result.data.result_id as string);

const G = FX.M.grace.id;
const CERT = FX.doc("CERT").id, PS = FX.doc("PRODUCT_SUMMARY").id, BS = FX.doc("BENEFIT_SUMMARY").id;
const MSG1 = "grace fell down and broke her arm";
const Q_XRAY = "Was Grace’s fracture confirmed by X-ray and certified by a registered medical practitioner?";
const MSG2 = `${Q_XRAY.replace("?", "")}: yes`;
const ALT_NOTE = "The Scheme X Group Insurance (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit; the Scheme X Group Insurance (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Grace's own sum insured. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.";

/** The recorded model calls (arguments as recorded; ids carried from this run's tool results, as a model would). */
const known: { sb?: string; so?: string; frame?: string[] } = {};
const alt = (v: ScriptView) => ({ kind: "uncertainty", text: ALT_NOTE, subject_id: G, evidence_ids: known.frame ?? [] });
const T1: ScriptTurn = { user: /broke her arm/, steps: [
  () => [call("resolve_person", { mention: "grace" })],
  () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: "broke her arm", words: "broke her arm" }], subject_id: G }), call("person_benefits", { topic: "fracture after a fall", subject_id: G })],
  (v) => {
    known.sb = benefitIdOf(v, /^Simple Fracture$/i); known.so = benefitIdOf(v, /Simple Fracture or Other Fracture/i);
    known.frame = [...idsAny(v, /any fractures of toe and foot are not covered/, "person_benefits").slice(0, 1), ...idsAny(v, /only be claimed either under the Core Scheme or Voluntary Scheme/, "person_benefits").slice(0, 1)];
    const ev = (id: string) => call("evaluate_benefit", { case: "broke her arm", purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: G, assumption_words: "broke her arm" });
    return [ev(known.sb), ev(known.so), call("search_passages", { k: 10, query: "fracture benefit conditions confirmed by X-ray registered medical practitioner accident fracture", policy_ids: [PS, BS] })];
  },
  (v) => { const r = resultIds(v); return [call("ask_user", { kind: "fact", fact_key: "fracture_confirmation", question: Q_XRAY, statements: [{ kind: "calculation", text: "-", result_id: r[0], subject_id: G }, { kind: "calculation", text: "-", result_id: r[1], subject_id: G }, alt(v)], subject_id: G, because_evidence_ids: idsAny(v, /Fracture of the nature/, "search_passages").slice(0, 2) })]; },
] };
const T2: ScriptTurn = { user: /confirmed by X-ray/, steps: [
  () => [call("note_facts", { facts: [{ key: "fracture_confirmation", value: "yes", words: "yes" }], subject_id: G })],
  () => { const ev = (id: string) => call("evaluate_benefit", { case: "broke her arm", purpose: "claim", fact_keys: ["injury", "how_it_happened", "fracture_confirmation"], benefit_id: id, subject_id: G, assumption_words: "broke her arm" }); return [ev(known.sb!), ev(known.so!)]; },
  (v) => { const r = resultIds(v); return [call("final_answer", { sentences: [{ kind: "calculation", text: "-", result_id: r[0] }, { kind: "calculation", text: "-", result_id: r[1] }, alt(v)], next_steps: ["contact:" + CERT], subject_id: G })]; },
] };

async function main() {
  setEnv(FX as any);
  const h = await startHarness(FX as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { GET: history } = await import("@/app/api/chat/history/[id]/route");
  const reopen = async (conv: string) => { const r = await history(new NextRequest(`http://localhost/api/chat/history/${conv}`), { params: Promise.resolve({ id: conv }) }); const j = await r.json(); return (j.messages ?? []).filter((m: any) => m.role === "assistant").map((m: any) => m.answer_json); };
  type Out = { v: string; shown: string; reopened: string; saved: string; answer: any; trace: any; conv: { id: string; rev: number } };
  const turn = async (label: string, user: string, conv: { id?: string; rev?: number } = {}): Promise<Out> => {
    const a = await h.send(user, conv);
    const s = await h.savedAnswer(a.conversationId!);
    const re = (await reopen(a.conversationId!)).at(-1);
    const trace = s.state.ragLoop.turns.at(-1);
    if (process.env.SHOW) console.log(`--- ${label}\n${visible(s.answer)}\n  outcome: ${trace.outcome}\n  adjusted: ${JSON.stringify(trace.adjusted ?? [])}\n  calls: ${JSON.stringify((trace.toolCalls ?? []).map((c: any) => `${c.name}${c.ok ? "" : "! " + String(c.error ?? c.summary ?? "").slice(0, 260)}`))}`);
    return { v: visible(s.answer), shown: visible(a), reopened: visible(re), saved: visible(s.answer), answer: s.answer, trace, conv: { id: a.conversationId!, rev: a.conversationRevision! } };
  };

  // ------------------------------------------------------------------------------------------------ A: the recorded conversation
  installLoopModel(new ScriptedLoopModel([T1, T2]));
  let t1: Out, t2: Out;
  try { t1 = await turn("turn 1", MSG1); t2 = await turn("turn 2 (the reply to the recorded question)", MSG2, t1.conv); } finally { installLoopModel(null); }
  const sumOf = (o: Out) => [o.answer.summary, ...(o.answer.details ?? []).slice(0, 2)].map((x) => String(x ?? "")).join("\n");
  check("A0 the recorded evidence is the library's pages (page 13 fixed limit S$5,000; page 8 20% of the Sum Insured; the certificate's S$600,000)", /Simple Fracture Benefit Limit: S\$5,000/.test(JSON.stringify(t1.answer.citations)) || /S\$5,000/.test(JSON.stringify(t1.answer)), JSON.stringify(t1.answer.citations ?? []).slice(0, 600));
  check("A1 turn 1: the X-ray / registered-practitioner question is NOT asked (no cited page prints it): the documents' terms are the answer", t1.trace.outcome === "final_answer" && !(t1.answer.questions ?? []).length && !/X-ray|registered medical practitioner/i.test(t1.v), `${t1.trace.outcome}\n${t1.v}`);
  check("A2 turn 1: both documented alternatives are in the first three lines of the answer, the S$1,250 and the S$120,000, with the framing that they are alternatives, never a total", /S\$1,250/.test(sumOf(t1)) && /S\$120,000/.test(sumOf(t1)) && /never a total/.test(sumOf(t1)), sumOf(t1));
  check("A3 turn 1: the framing comes first (neither alternative is presented as THE answer)", sumOf(t1).indexOf("alternatives") >= 0 && sumOf(t1).indexOf("alternatives") < sumOf(t1).indexOf("S$1,250"), sumOf(t1));
  check("A4 the S$600,000 base carries the date the certificate prints it for (6 October 2022) and that this is not cover on a later date", /sum insured of S\$600,000 \(Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date\)/.test(t1.v), t1.v);
  check("A5 each illustration uses its own row and base: 25% x S$5,000 = S$1,250 (page 13) and 20% x S$600,000 = S$120,000 (page 8); no total is formed", /25% of the Simple Fracture benefit limit of S\$5,000/.test(t1.v) && /20% of Grace's sum insured of S\$600,000/.test(t1.v) && !/S\$121,250|S\$1,250 \+ S\$120,000/.test(t1.v), t1.v);
  check("A6 the row's label \"(Other Fracture)\" and the missing definition are said (neither document defines which fractures that is)", /print no definition of which fractures that is/.test(t1.v));
  check("A7 no 'withheld until claim evidence is reviewed' notice anywhere in either turn", !/withh|until claim evidence|left out a sentence/i.test(t1.v + t2.v), t1.v + "\n" + t2.v);
  check("A8 turn 1: returned = saved = reopened (text, sources, steps)", t1.shown === t1.saved && t1.saved === t1.reopened, `shown:\n${t1.shown}\n--saved:\n${t1.saved}\n--reopened:\n${t1.reopened}`);
  check("A9 turn 2 (the recorded reply, 'yes'): the same two alternatives in the first lines; the same figures; no new question; no total", t2.trace.outcome === "final_answer" && /S\$1,250/.test(sumOf(t2)) && /S\$120,000/.test(sumOf(t2)) && !(t2.answer.questions ?? []).length && !/S\$121,250/.test(t2.v), `${t2.trace.outcome}\n${sumOf(t2)}`);
  check("A10 the supported next step (contact the insurer named on the certificate) is in the correction turn, returned = saved = reopened", /Aldermoor Life Ltd/.test(t2.v) && t2.shown === t2.saved && t2.saved === t2.reopened, `${t2.v}\n--reopened:\n${t2.reopened}`);
  check("A11 what the household said about the confirmation is recorded as their report (not as a policy term): the amounts do not change with it", /S\$1,250/.test(t2.v) && /S\$120,000/.test(t2.v) && sumOf(t2) !== "");
  check("A12 the figures' citations: page 13 (S$5,000 and 25%), page 8 (20%) and the certificate (S$600,000)", (() => { const c = JSON.stringify(t2.answer.citations ?? []); return /Simple Fracture Benefit Limit: S\$5,000/.test(c) && /Arm , Elbow, Wrist or Ribs\\t25%/.test(c) && /Other Fracture\)\\t20%/.test(c) && /S\$600,000/.test(c); })(), JSON.stringify(t2.answer.citations ?? []).slice(0, 900));

  // ------------------------------------------------------------------------------------------------ B: controls
  const Q = await import("@/lib/rag2/loop/questions").catch(() => ({})) as { unprintedAsk?: (q: string, k: string, t: string[], n?: string[]) => string[] | null };
  if (Q.unprintedAsk) {
    const names = [FX.M.grace.name, FX.M.daniel.name];
    const lead = ["If an Insured Person sustains bodily injury as a result of an Accident, which results in a Simple Fracture or Other Fracture of the nature mentioned in the table below, we will pay the relevant amount specified in the table:-"];
    const miss = Q.unprintedAsk(Q_XRAY, "fracture_confirmation", lead, names);
    check("B1 (negative) the X-ray question against the clause that does not print it: refused, naming what is not printed", !!miss && miss.includes("ray") && miss.includes("practitioner"), JSON.stringify(miss));
    check("B2 (positive) the same question against wording that prints it: asked", Q.unprintedAsk(Q_XRAY, "fracture_confirmation", [...lead, "Proof of the fracture, confirmed by X-ray and certified by a Registered Medical Practitioner, must be sent with the claim."], names) === null);
    check("B3 (positive) a question about a printed requirement (confined 24 hours) is supported by the clause that prints it", Q.unprintedAsk("Was Grace confined as a resident patient in a hospital for a continuous period of at least 24 hours?", "continuous_confinement", [FX.BS_P9], names) === null);
    check("B4 a short question is never refused on this test", Q.unprintedAsk("Was it an accident?", "fracture_confirmation", lead, names) === null);
    check("B4b a question choosing among printed cases (\"Which bone should I use for this illustration?\") is never refused on this test", Q.unprintedAsk("Which bone should I use for this illustration of the fracture benefit?", "fracture_target", ["Bone fractured Benefit (% of Sum Insured)\nLeg - thigh bone (femur) 20%\nWrist 5%"], names) === null);
  } else check("B1-B4 (this code has no question-support test)", false, "unprintedAsk is not exported");
  check("B5 a certificate date printed in one cell is read; a date of birth or a bare label is not", cellDate("As of 06/10/2022") === "2022-10-06" && cellDate("w.e.f. 6 Oct 2022") === "2022-10-06" && cellDate("06/10/2022") === "2022-10-06" && cellDate("Date of birth 06/10/1980") === null && cellDate("As of") === null);

  // B6: a question whose requirement IS printed is still asked (positive control through the real route)
  {
    const TQ: ScriptTurn = { user: /hospital/, steps: [
      () => [call("resolve_person", { mention: "grace" })],
      () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: "broke her arm", words: "broke her arm" }], subject_id: G }), call("person_benefits", { topic: "accidental hospital recuperation", subject_id: G })],
      () => [call("search_passages", { k: 6, query: "accidental hospital recuperation benefit hospital 24 hours", policy_ids: [BS] })],
      (v) => [call("ask_user", { kind: "fact", fact_key: "continuous_confinement", subject_id: G, question: "Was Grace confined as a resident patient in a hospital for a continuous period of at least 24 hours?", because_evidence_ids: idsAny(v, /continuous period of at least 24 hours/, "search_passages").slice(0, 1) })],
    ] };
    installLoopModel(new ScriptedLoopModel([TQ]));
    try { const q = await turn("B6 printed requirement", "grace fell down, broke her arm and went to hospital"); check("B6 (positive control) a question about a requirement the cited clause prints (24 hours in hospital) is still asked", q.trace.outcome === "ask_user" && /continuous period of at least 24 hours/.test(q.v), `${q.trace.outcome}\n${q.v}\n${JSON.stringify(q.trace.adjusted ?? [])}`); } finally { installLoopModel(null); }
  }

  // B7: a dated Term Life amount keeps its date in the real certificate layout
  {
    const TT: ScriptTurn = { user: /term life/i, steps: [
      () => [call("resolve_person", { mention: "grace" })],
      () => [call("person_benefits", { topic: "term life death benefit", subject_id: G })],
      (v) => [call("final_answer", { subject_id: G, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i), subject_id: G }], next_steps: ["contact:" + CERT] })],
    ] };
    installLoopModel(new ScriptedLoopModel([TT]));
    try { const q = await turn("B7 term life", "what is grace's term life amount?"); check("B7 the certificate's Term Life amount keeps its printed date when the certificate prints it as one cell (\"As of 06/10/2022\")", /S\$1,000,000/.test(q.v) && /6 October 2022/.test(q.v), q.v); } finally { installLoopModel(null); }
  }

  // B8: ONE documented term alone (a library with the Product Summary only): the answer keeps its single-sentence headline and says no "alternatives"
  {
    const only = { ...FX, DOCS: FX.DOCS.filter((d) => d.key !== "BENEFIT_SUMMARY") } as any;
    const h2 = await startHarness(only);
    const TS: ScriptTurn = { user: /broke her arm/, steps: [
      () => [call("resolve_person", { mention: "grace" })],
      () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: "broke her arm", words: "broke her arm" }], subject_id: G }), call("person_benefits", { topic: "fracture after a fall", subject_id: G })],
      (v) => [call("evaluate_benefit", { case: "broke her arm", purpose: "claim", fact_keys: ["injury"], benefit_id: benefitIdOf(v, /Simple Fracture/i), subject_id: G, assumption_words: "broke her arm" })],
      (v) => [call("final_answer", { subject_id: G, sentences: [{ kind: "calculation", text: "-", result_id: resultIds(v)[0] }], next_steps: ["contact:" + CERT] })],
    ] };
    installLoopModel(new ScriptedLoopModel([TS]));
    try {
      const a = await h2.send(MSG1, {}); const s = await h2.savedAnswer(a.conversationId!);
      check("B8 (control) one documented term alone: the headline is that one sentence and there is no 'alternatives' framing", /S\$1,250/.test(String(s.answer.summary)) && !/S\$120,000/.test(visible(s.answer)) && !/alternatives/.test(visible(s.answer)), visible(s.answer));
    } finally { installLoopModel(null); }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
