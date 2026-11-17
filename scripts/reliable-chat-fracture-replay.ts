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
import { OPEN_FRACTURE_DEFINITION, withOtherFractureDefined } from "./fixtures/reliable-chat/other-fracture-defined";
import { cellDate } from "@/lib/rag2/tables";
import { BS, CERT, G, MSG1, MSG2, PS, Q_XRAY, T1, T2, benefitIdOf, call, idsAny, resultIds } from "./fixtures/reliable-chat/fracture-script";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 30).join("\n     ") : ""}`); };
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
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
  // Declutter (16 Nov 2026): a row's case is said WITH its amount only when a document defines the case. The controls below that test
  // the certificate's sum-insured base (B9-B12, B14) therefore run on a SYNTHETIC variant whose Benefit Summary adds one definition
  // page ("Other Fracture means ..."), so they keep testing the base, person and version they were written for. Not a real page.
  const defined = (fx: any) => withOtherFractureDefined(fx) as any;
  check("A0 the recorded evidence is the library's pages (page 13 fixed limit S$5,000; page 8 20% of the Sum Insured; the certificate's S$600,000)", /Simple Fracture Benefit Limit: S\$5,000/.test(JSON.stringify(t1.answer.citations)) || /S\$5,000/.test(JSON.stringify(t1.answer)), JSON.stringify(t1.answer.citations ?? []).slice(0, 600));
  check("A1 turn 1: the X-ray / registered-practitioner question is NOT asked (no cited page prints it): the documents' terms are the answer", t1.trace.outcome === "final_answer" && !(t1.answer.questions ?? []).length && !/X-ray|registered medical practitioner/i.test(t1.v), `${t1.trace.outcome}\n${t1.v}`);
  // ---- DC, 16 Nov 2026 (declutter; Critic site review A1-A3). EXPECTATION CHANGES, recorded in
  // docs/rag-migration/declutter-20261116/EXPECTATION-CHANGES.md with the original checks quoted there and kept below as ORIG lines.
  // ORIG A2: both alternatives (S$1,250 and S$120,000) in the first lines, with "never a total".
  // ORIG A3: the "alternatives" framing before S$1,250.  ORIG A4: S$600,000 dated "printed as of 6 October 2022 ...".
  // ORIG A5: 25% x S$5,000 = S$1,250 and 20% x S$600,000 = S$120,000 both shown.  ORIG A9/A11: turn 2 repeats both amounts.
  // ORIG A13/A14/A15: the two-document relationship note (bases, standing clauses, "Neither document says whether one amends ...").
  // What stays asserted on behaviour: no total of any kind, no unsupported question, the row's own document and page, the missing
  // definition, the insurer's part said, returned = saved = reopened, citations of every figure that IS shown.
  const both = t1.v + "\n" + t2.v;
  check("A2 turn 1 leads with the benefit whose row matches: S$1,250 = 25% of the S$5,000 Simple Fracture limit, Product Summary (page 13)", /S\$1,250: 25% of the Simple Fracture benefit limit of S\$5,000, in the Product Summary \(page 13\)/.test(String(t1.answer.summary ?? "")), sumOf(t1));
  check("A3 (A1 of the Critic review) the certificate's Other Fracture row is named, with its document and page, WITHOUT an amount: S$120,000 (and its S$600,000 base) appear nowhere in either turn", /Certificate of Insurance Part 2 \(page 8\) also lists “Arm, Elbow, Wrist or Ribs” under Other Fracture/.test(t1.v) && !/S\$120,000|S\$600,000/.test(both + JSON.stringify(t1.answer.calculations ?? []) + JSON.stringify(t2.answer.calculations ?? [])), both);
  check("A4 the household is told what to do about that row: ask the insurer whether Grace's fracture counts", /Ask the insurer whether Grace's fracture is one\./.test(t1.v), t1.v);
  check("A5 no total is formed in any form (S$121,250, a sum, 'in total', 'combined', 'added')", !/S\$121,250|S\$302,500|in total|combined|added (?:up|together)|\bplus\b/i.test(both), both);
  check("A6 the row's label \"(Other Fracture)\" and the missing definition are said (neither document defines which fractures that is)", /don't say which fractures count as Other Fracture/.test(t1.v), t1.v);
  check("A6b (A2 of the Critic review) no narration: no 'never a total', no 'alternatives from separate documents', no per-amount 'not a payment or an insurer's decision'; the insurer's part said exactly once", !/never a total|alternatives from separate documents|not a payment or an insurer/i.test(both) && (t1.v.match(/The insurer decides what is paid\./g) ?? []).length === 1, both);
  check("A7 no 'withheld until claim evidence is reviewed' notice anywhere in either turn", !/withh|until claim evidence|left out a sentence/i.test(t1.v + t2.v), t1.v + "\n" + t2.v);
  check("A8 turn 1: returned = saved = reopened (text, sources, steps)", t1.shown === t1.saved && t1.saved === t1.reopened, `shown:\n${t1.shown}\n--saved:\n${t1.saved}\n--reopened:\n${t1.reopened}`);
  check("A9 (A3 of the Critic review) turn 2 (the recorded reply, 'yes') does not repeat turn 1: it says the amounts don't change, then the new next step; no new question", t2.trace.outcome === "final_answer" && /^That doesn't change the amounts above\./.test(String(t2.answer.summary ?? "")) && !/S\$1,250|Other Fracture/.test(t2.v) && !(t2.answer.questions ?? []).length, `${t2.trace.outcome}\n${t2.v}`);
  check("A10 the supported next step (contact the insurer named on the certificate) is in the correction turn, returned = saved = reopened", /Aldermoor Life Ltd/.test(t2.v) && t2.shown === t2.saved && t2.saved === t2.reopened, `${t2.v}\n--reopened:\n${t2.reopened}`);
  check("A11 what the household said about the confirmation is recorded as their report (not as a policy term): the amounts do not change with it (turn 2 says so; no new or changed amount)", !/S\$[\d,]+/.test(t2.v) && /doesn't change the amounts/.test(t2.v), t2.v);
  check("A12 the figures' citations in turn 1: page 13 (S$5,000 and 25%) for the amount shown, and the page-8 row the Other Fracture line names", (() => { const c = JSON.stringify(t1.answer.citations ?? []); return /Simple Fracture Benefit Limit: S\$5,000/.test(c) && /Arm , Elbow, Wrist or Ribs\\t25%/.test(c) && /Other Fracture\)\\t20%/.test(c); })(), JSON.stringify(t1.answer.citations ?? []).slice(0, 900));
  check("A15 no document is said to govern: nothing says one prevails, overrides or replaces the other", !/prevail|overrid|supersed|takes precedence|replaces the (?:Product|Certificate)/i.test(both), both);

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

  // B9: a GENUINE question (its requirement is printed) asked together with the established illustrations: what the household sees
  // when the question is asked is what they see when the conversation is reopened (the illustrations are not withheld on reopening)
  {
    const TA: ScriptTurn = { user: /broke her arm/, steps: [
      () => [call("resolve_person", { mention: "grace" })],
      () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: "broke her arm", words: "broke her arm" }], subject_id: G }), call("person_benefits", { topic: "fracture after a fall", subject_id: G })],
      (v) => {
        const sb = benefitIdOf(v, /^Simple Fracture$/i), so = benefitIdOf(v, /Simple Fracture or Other Fracture/i);
        const ev = (id: string) => call("evaluate_benefit", { case: "broke her arm", purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: G, assumption_words: "broke her arm" });
        return [ev(sb), ev(so), call("search_passages", { k: 6, query: "accidental hospital recuperation benefit hospital 24 hours", policy_ids: [BS] })];
      },
      (v) => { const r = resultIds(v); return [call("ask_user", { kind: "fact", fact_key: "continuous_confinement", subject_id: G, question: "Was Grace confined as a resident patient in a hospital for a continuous period of at least 24 hours?", statements: [{ kind: "calculation", text: "-", result_id: r[0], subject_id: G }, { kind: "calculation", text: "-", result_id: r[1], subject_id: G }], because_evidence_ids: idsAny(v, /continuous period of at least 24 hours/, "search_passages").slice(0, 1) })]; },
    ] };
    installLoopModel(new ScriptedLoopModel([TA]));
    const h7 = await startHarness(defined(FX));
    try {
      const a = await h7.send(MSG1, {}); const sv = await h7.savedAnswer(a.conversationId!);
      const re = (await reopen(a.conversationId!)).at(-1);
      const q = { v: visible(sv.answer), shown: visible(a), saved: visible(sv.answer), reopened: visible(re), trace: sv.state.ragLoop.turns.at(-1) };
      check("B9 (control) a genuine question asked with the established illustrations: the question is asked, the illustrations are shown, and reopening shows exactly the same (no 'left out a sentence' notice)", q.trace.outcome === "ask_user" && /S\$1,250/.test(q.v) && /S\$120,000/.test(q.v) && !/left out a sentence|until claim evidence/i.test(q.reopened) && q.shown === q.saved && q.saved === q.reopened, `${q.trace.outcome}\n--saved:\n${q.saved}\n--reopened:\n${q.reopened}`);
    } finally { installLoopModel(null); }
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

  // B10: the standing statements are said ONLY when the documents' own pages print them (a library without the summary's claims page and the certificate's status note)
  {
    const bare = { ...FX, DOCS: FX.DOCS.map((d) => d.key === "PRODUCT_SUMMARY" ? { ...d, pages: { 8: FX.PS_P8, 12: FX.PS_P12, 13: FX.PS_P13 } } : d.key === "BENEFIT_SUMMARY" ? { ...d, pages: { 3: FX.BS_P3, 5: FX.BS_P5, 7: FX.BS_P7, 8: FX.BS_P8, 9: FX.BS_P9 } } : d) } as any;
    const h3 = await startHarness(defined(bare));
    const TB: ScriptTurn = { user: /broke her arm/, steps: [
      () => [call("resolve_person", { mention: "grace" })],
      () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: "broke her arm", words: "broke her arm" }], subject_id: G }), call("person_benefits", { topic: "fracture after a fall", subject_id: G })],
      (v) => { const ev = (id: string) => call("evaluate_benefit", { case: "broke her arm", purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: G, assumption_words: "broke her arm" }); return [ev(benefitIdOf(v, /^Simple Fracture$/i)), ev(benefitIdOf(v, /Simple Fracture or Other Fracture/i))]; },
      (v) => [call("final_answer", { subject_id: G, sentences: [{ kind: "calculation", text: "-", result_id: resultIds(v)[0] }, { kind: "calculation", text: "-", result_id: resultIds(v)[1] }], next_steps: ["contact:" + CERT] })],
    ] };
    installLoopModel(new ScriptedLoopModel([TB]));
    try {
      const a = await h3.send(MSG1, {}); const s = await h3.savedAnswer(a.conversationId!); const v = visible(s.answer);
      check("B10 (control) pages that print no standing statement: none is said, the two schedules are still given with their bases and the unresolved relationship", /S\$1,250/.test(v) && /S\$120,000/.test(v) && !/describes itself|not a contract|dated July/.test(v) && /Grace's documents give two different amounts for this, and neither document says which one applies\./.test(v) && !/never a total|S\$121,250/.test(v), v);
      // ORIG B10 (declutter, 16 Nov 2026): also required "Neither document says whether one amends, replaces or adds to the other" and
      // "takes its percentage of a fixed" (the bases note). Both lines were removed at DC's request; each amount still states its own base:
      check("B10b (control) each amount still says its own base (25% of the S$5,000 limit; 20% of Grace's sum insured of S$600,000), so removing the bases note loses nothing", /25% of the Simple Fracture benefit limit of S\$5,000/.test(v) && /20% of Grace's sum insured of S\$600,000/.test(v), v);
    } finally { installLoopModel(null); }
  }

  // B14 (declutter, 16 Nov 2026): the no-amount rule follows the documents, not the row: on the variant whose Benefit Summary defines
  // Other Fracture, the recorded conversation shows the certificate's S$120,000 again, its row label whole and no "don't say" line.
  {
    const h8 = await startHarness(defined(FX));
    installLoopModel(new ScriptedLoopModel([T1]));
    try {
      const a = await h8.send(MSG1, {}); const s = await h8.savedAnswer(a.conversationId!); const v = visible(s.answer);
      check("B14 (positive control) a case a document defines keeps its amount: S$120,000 = 20% of Grace's sum insured of S$600,000 is shown with S$1,250, no 'don't say which fractures' line, no total", /S\$120,000: 20% of Grace's sum insured of S\$600,000/.test(v) && /S\$1,250/.test(v) && !/don't say which fractures|do not define/.test(v) && !/S\$121,250|never a total/.test(v), v);
      check("B14b the insurer's part is said once in that two-amount answer, not after each amount", (v.match(/The insurer decides what is paid\./g) ?? []).length === 1 && !/not a payment or an insurer/.test(v), v);
    } finally { installLoopModel(null); }
  }

  // ------------------------------------------------------------------------------------------------ B11-B13: wrong-person, wrong-version, wrong-base controls (numbers that differ, so a mix-up shows)
  const withCert = (text: string) => ({ ...FX, DOCS: FX.DOCS.map((d) => d.key === "CERT" ? { ...d, pages: { 1: text } } : d) }) as any;
  const fracScript = (who: { id: string; mention: string; msg: RegExp }, contact: string = CERT, both = true): ScriptTurn => ({ user: who.msg, steps: [
    () => [call("resolve_person", { mention: who.mention })],
    () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: "broke arm", words: "broke" }], subject_id: who.id }), call("person_benefits", { topic: "fracture after a fall", subject_id: who.id })],
    (v) => { const ev = (id: string) => call("evaluate_benefit", { case: "broke arm", purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: who.id, assumption_words: "broke" }); return [ev(benefitIdOf(v, /^Simple Fracture$/i)), ...(both ? [ev(benefitIdOf(v, /Simple Fracture or Other Fracture/i))] : [])]; },
    (v) => [call("final_answer", { subject_id: who.id, sentences: resultIds(v).slice(0, both ? 2 : 1).map((r) => ({ kind: "calculation", text: "-", result_id: r })), next_steps: contact ? ["contact:" + contact] : [] })],
  ] });
  // B11: wrong person. Daniel's printed Personal Accident sum is S$800,000 and Grace's S$600,000: each person's conversation uses only that person's own sum.
  {
    const diff = FX.CERT_P1.replace("S****411A\tLee Wei Ming, Daniel\tS$600,000", "S****411A\tLee Wei Ming, Daniel\tS$800,000");
    const h4 = await startHarness(defined(withCert(diff)));
    const run = async (who: { id: string; mention: string; msg: RegExp }, text: string) => {
      installLoopModel(new ScriptedLoopModel([fracScript(who)]));
      try { const a = await h4.send(text, {}); const s = await h4.savedAnswer(a.conversationId!); return { v: visible(s.answer), shown: visible(a), saved: visible(s.answer), answer: s.answer, trace: s.state.ragLoop.turns.at(-1) }; } finally { installLoopModel(null); }
    };
    const d = await run({ id: FX.M.daniel.id, mention: "daniel", msg: /daniel/i }, "daniel fell down and broke his arm");
    check("B11a (wrong-person control) Daniel's conversation uses Daniel's own sum insured: 20% x S$800,000 = S$160,000; Grace's S$120,000 and S$600,000 appear nowhere", /S\$160,000/.test(d.v) && /S\$800,000/.test(d.v) && !/S\$120,000|S\$600,000/.test(d.v) && d.shown === d.saved, d.v);
    const g = await run({ id: G, mention: "grace", msg: /grace/i }, "grace fell down and broke her arm");
    check("B11b (wrong-person control) Grace's conversation in the same library keeps her own S$600,000 -> S$120,000 and never Daniel's S$160,000 / S$800,000", /S\$120,000/.test(g.v) && /S\$600,000/.test(g.v) && !/S\$160,000|S\$800,000/.test(g.v) && g.shown === g.saved, g.v);
    check("B11c (wrong-person control) the fixed-limit alternative (25% x S$5,000 = S$1,250) is the same for both people and is not scaled by either person's sum", /S\$1,250/.test(d.v) && /S\$1,250/.test(g.v) && !/S\$200,000|S\$150,000/.test(d.v + g.v), d.v + "\n" + g.v);
  }
  // B15 (Critic on #512, M1): only a PURE repeat is shortened. A reply that adds a new amount keeps the earlier amount beside it (nothing
  // dropped, no lead line), so the new amount never reads as the whole answer; a reply with nothing new gets the one-line lead.
  {
    const { followUp } = await import("@/lib/rag2/loop/hook");
    const A = { text: "If X applies, the conditional illustration is S$1,250 ...", kind: "conditional_illustration" }, B = { text: "If Y applies, the conditional illustration is S$9,000 ...", kind: "conditional_illustration" }, F = { text: "Some printed term.", kind: "printed" };
    const both = followUp([A, B], [A.text]), same = followUp([A], [A.text]), none = followUp([A, B], []), factsOnly = followUp([F], [F.text]);
    check("B15 (M1) a new amount beside a repeated one keeps both and adds no lead; a pure repeat becomes 'That doesn't change the amounts above.' (or 'my answer above' with no amount)",
      both.lead === null && both.fresh.length === 2 && same.lead === "That doesn't change the amounts above." && !same.fresh.length && none.lead === null && none.fresh.length === 2 && factsOnly.lead === "That doesn't change my answer above.", JSON.stringify({ both, same, none, factsOnly }));
  }
  // B16 (Critic on #512, M2): "Other Fracture means ..." printed by ANOTHER policy of Grace's (a different policy number) does not define the
  // certificate's term: the S$120,000 stays hidden and the no-amount line with "Ask the insurer" is said, with no S$ figure in it.
  {
    const otherPolicy = { ...FX.DOCS.find((d) => d.key === "BENEFIT_SUMMARY")!, key: "OTHER_POLICY", id: "7d000000-0000-4000-8000-000000000109", hash: "sha256:fx-other-policy", policyNumber: "TRV-555", product: "Wanderlust Travel Cover", filename: "Travel wording.pdf", pages: { 4: "DEFINITIONS\nOther Fracture means a fracture in which the broken bone pierces the skin." } };
    const h10 = await startHarness({ ...FX, DOCS: [...FX.DOCS, otherPolicy] } as any);
    installLoopModel(new ScriptedLoopModel([T1]));
    try {
      const a = await h10.send(MSG1, {}); const sv = await h10.savedAnswer(a.conversationId!); const v = visible(sv.answer);
      const line = v.split("\n").find((l) => /under Other Fracture/.test(l)) ?? "";
      check("B16 (M2) another policy's definition does not unlock this policy's row: no S$120,000; the Other Fracture line has no S$ figure and says 'Ask the insurer'", !/S\$120,000|S\$600,000/.test(v + JSON.stringify(sv.answer.calculations ?? [])) && !!line && !/S\$/.test(line) && /Ask the insurer/.test(line), v);
    } finally { installLoopModel(null); }
  }
  // B17-B23 (Test engineer on #512, F1-F8): the no-amount rule holds whatever carries the row, and the follow-up rule keeps what was asked.
  {
    const G2 = { id: G, mention: "grace", msg: /grace/i };
    const once = async (fx: any, script: ScriptTurn, text: string) => {
      const hx = await startHarness(fx);
      installLoopModel(new ScriptedLoopModel([script]));
      try { const a = await hx.send(text, {}); const s = await hx.savedAnswer(a.conversationId!); return { v: visible(s.answer), shown: visible(a), answer: s.answer }; } finally { installLoopModel(null); }
    };
    const hidden = (o: { v: string; answer: any }) => !/S\$120,000|S\$600,000/.test(o.v + JSON.stringify(o.answer.calculations ?? []) + JSON.stringify(o.answer.figureBindings ?? []) + JSON.stringify(o.answer.computations ?? []));
    const rowLine = (v: string) => v.split("\n").find((l) => /under Other Fracture/.test(l)) ?? "";
    // F1: the model states the certificate's result as a "fact" or an "uncertainty" carrying its result_id
    for (const k of ["fact", "uncertainty"]) {
      const sc = fracScript(G2);
      sc.steps[3] = (v) => { const r = resultIds(v); return [call("final_answer", { subject_id: G, sentences: [{ kind: "calculation", text: "-", result_id: r[0] }, { kind: k, text: "If the Other Fracture benefit applies to Grace's case, the conditional illustration is S$120,000: 20% of Grace's sum insured of S$600,000.", result_id: r[1] }], next_steps: ["contact:" + CERT] })]; };
      const o = await once(FX as any, sc, "grace fell down and broke her arm");
      check(`B17 (F1) a '${k}' statement carrying the undefined row's result_id shows no amount: S$120,000 appears nowhere (text, calculations, bindings); the row is named once with 'Ask the insurer'`, hidden(o) && /Ask the insurer/.test(rowLine(o.v)) && (o.v.match(/under Other Fracture/g) ?? []).length === 1 && o.shown === o.v, o.v);
    }
    // F2b: the case name anywhere inside the brackets
    for (const [tagText, said] of [["(Other Fracture/s)", "Other Fracture"], ["(Other Fracture, see note 3)", "Other Fracture"], ["(other fracture)", "other fracture"]] as const) {
      const fx2 = { ...FX, DOCS: FX.DOCS.map((d) => ({ ...d, pages: Object.fromEntries(Object.entries(d.pages).map(([n, t]) => [n, String(t).replace(/\(Other Fracture\)/g, tagText)])) })) } as any;
      const o = await once(fx2, fracScript(G2), "grace fell down and broke her arm");
      const line = o.v.split("\n").find((l) => l.includes(`under ${said}`)) ?? "";
      check(`B24 (F2b) a label '${tagText}' is the same undefined case: no S$120,000, the row named with 'Ask the insurer', no 'labelled as neither'`, hidden(o) && /Ask the insurer/.test(line) && !/labelled as neither/.test(o.v), o.v);
    }
    // F2c / F10: the same case written another way, or printed as a sub-heading above the row
    for (const [name, to] of [["[Other Fracture]", "Arm, Elbow, Wrist or Ribs [Other Fracture]\t20%"], ["a dash", "Arm, Elbow, Wrist or Ribs - Other Fracture\t20%"], ["a leading 'Other Fracture:'", "Other Fracture: Arm, Elbow, Wrist or Ribs\t20%"], ["a sub-heading line (F10)", "Other Fracture:\nArm, Elbow, Wrist or Ribs\t20%"], ["a sub-heading with a note (F11)", "Other Fracture (see note 2):\nArm, Elbow, Wrist or Ribs\t20%"], ["a sub-heading 30 rows up (F11)", "Other Fracture:\n" + Array.from({ length: 30 }, (_, k) => `Finger ${k + 1}\t1%`).join("\n") + "\nArm, Elbow, Wrist or Ribs\t20%"]] as const) {
      const fx2 = { ...FX, DOCS: FX.DOCS.map((d) => ({ ...d, pages: Object.fromEntries(Object.entries(d.pages).map(([n, t]) => [n, String(t).replace("Arm, Elbow, Wrist or Ribs (Other Fracture)\t20%", to)])) })) } as any;
      const o = await once(fx2, fracScript(G2), "grace fell down and broke her arm");
      check(`B25 (F2c/F10) the Other Fracture case written as ${name} is the same undefined case: no S$120,000 anywhere, the row named with 'Ask the insurer', no 'labelled as neither'`, hidden(o) && /Ask the insurer/.test(rowLine(o.v)) && !/labelled as neither/.test(o.v), o.v);
    }
    // TE journeys on main 9bca70a, W1: a bracket that names the kind without the word -- "(Other)", or "(Compound)" under a benefit
    // named "Simple Fracture or Compound Fracture" -- is the same undefined case: no amount, the row named, 'Ask the insurer'.
    for (const [name, from, to, kind] of [["(Other)", /\(Other Fracture\)/g, "(Other)", "Other Fracture"], ["(Compound) under Simple or Compound", /Other Fracture/g, "Compound Fracture", "Compound Fracture"]] as const) {
      const fx2 = { ...FX, DOCS: FX.DOCS.map((d) => ({ ...d, pages: Object.fromEntries(Object.entries(d.pages).map(([n, t]) => [n, String(t).replace(from, to).replace(/\(Compound Fracture\)/g, "(Compound)")])) })) } as any;
      const o = await once(fx2, fracScript(G2), "grace fell down and broke her arm");
      const line = o.v.split("\n").find((l) => l.includes(`under ${kind}`)) ?? "";
      check(`B26 (W1) a row labelled ${name} is the undefined ${kind} case: no S$120,000 anywhere, the row named with 'Ask the insurer', no 'labelled as neither'`, hidden(o) && /Ask the insurer/.test(line) && !/labelled as neither/.test(o.v), o.v);
    }
    // Critic on #516 M2: "(Other)" under a benefit that names fewer than two kinds is no case label.
    for (const title of ["Accidental Fracture", "Dislocation or Fracture"]) {
      const fx2 = { ...FX, DOCS: FX.DOCS.map((d) => ({ ...d, pages: Object.fromEntries(Object.entries(d.pages).map(([n, t]) => [n, String(t).replace(/Simple Fracture or Other Fracture due to Accident/g, title).replace(/\(Other Fracture\)/g, "(Other)")])) })) } as any;
      const o = await once(fx2, fracScript(G2), "grace fell down and broke her arm");
      check(`B26c (Critic #516 M2) '(Other)' under '${title}' is not named as an undefined Other Fracture case`, !/under Other Fracture/.test(o.v) && !/Or Fracture/.test(o.v), o.v);
    }
    // ... a bracket that names no kind the benefit prints ("(Left)") is not a case label: the row keeps its amount, with the note.
    {
      const fx2 = { ...FX, DOCS: FX.DOCS.map((d) => ({ ...d, pages: Object.fromEntries(Object.entries(d.pages).map(([n, t]) => [n, String(t).replace(/\(Other Fracture\)/g, "(Left)")])) })) } as any;
      const o = await once(fx2, fracScript(G2), "grace fell down and broke her arm");
      check("B26b (W1 control) a row labelled '(Left)' is not a case label: it is not named as an undefined case", !/under Left Fracture/.test(o.v), o.v);
    }
    // F2: the plural label "(Other Fractures)"
    {
      const plural = { ...FX, DOCS: FX.DOCS.map((d) => ({ ...d, pages: Object.fromEntries(Object.entries(d.pages).map(([n, t]) => [n, String(t).replace(/\(Other Fracture\)/g, "(Other Fractures)")])) })) } as any;
      const o = await once(plural, fracScript(G2), "grace fell down and broke her arm");
      check("B18 (F2) a plural label '(Other Fractures)' is the same undefined case: no S$120,000, the row named with 'Ask the insurer', no 'labelled as neither'", hidden(o) && /Ask the insurer/.test(rowLine(o.v.replace(/Other Fractures/g, "Other Fracture"))) && !/labelled as neither/.test(o.v), o.v);
    }
    // F4: a definition the household's report does not fit ("pierces the skin", reported closed)
    {
      const o = await once(withOtherFractureDefined(FX as any, OPEN_FRACTURE_DEFINITION) as any, fracScript(G2), "grace fell down and broke her arm. It was a closed fracture, the skin wasn't broken.");
      check("B19 (F4) a definition the reported fracture does not fit (open, reported closed) shows no amount: the row is named with the definition and what was reported, 'Ask the insurer'", hidden(o) && /defines it as “Other Fracture means a fracture in which the broken bone pierces the skin\.”/.test(o.v) && /reported as a closed fracture/.test(o.v) && /Ask the insurer/.test(o.v), o.v);
    }
    // F5: a pointer is not a definition
    {
      const pointer = { ...FX, DOCS: FX.DOCS.map((d) => { if (!Object.values(d.pages).some((t) => /\(Other Fracture\)/.test(String(t)))) return d; const next = Math.max(0, ...Object.keys(d.pages).map(Number)) + 1; return { ...d, pages: { ...d.pages, [next]: "DEFINITIONS\nOther Fracture refers to the table in Part 2 above." } }; }) } as any;
      const o = await once(pointer, fracScript(G2), "grace fell down and broke her arm");
      check("B20 (F5) 'Other Fracture refers to the table in Part 2 above.' defines nothing: no S$120,000, the row named with 'Ask the insurer'", hidden(o) && /Ask the insurer/.test(rowLine(o.v)), o.v);
    }
    // F7, F8: units
    {
      const { followUp } = await import("@/lib/rag2/loop/hook");
      const { supersededIn } = await import("@/lib/chat/stale-answers");
      const A = { text: "If X applies, the conditional illustration is S$1,250 ...", kind: "conditional_illustration" };
      const again = followUp([A], [A.text], "Sorry, how much was that again?"), plain = followUp([A], [A.text], "Yes, the X-ray confirmed it.");
      check("B21 (F7) asking for the amount again gets the amount (no shortening); a plain pure repeat is still shortened", again.lead === null && again.fresh.length === 1 && plain.lead === "That doesn't change the amounts above.", JSON.stringify({ again, plain }));
      const state = { ragLoop: { claim: { calcs: { k1: { withdrawn: true } } } } };
      check("B22 (F8) a shortened answer that restated a withdrawn calculation is replaced with the answer it pointed back to", supersededIn(state)({ restatedCalculationIds: ["k1"] } as any) && !supersededIn(state)({ restatedCalculationIds: ["k2"] } as any), "");
    }
    // F3: after "no, it's daniel", Daniel's undefined row is still named (the page was first read in Grace's turn)
    {
      const hx = await startHarness(FX as any);
      const D = FX.M.daniel.id;
      const corr: ScriptTurn = { user: /daniel/i, steps: [
        () => [call("resolve_person", { mention: "daniel" })],
        () => [call("note_facts", { facts: [{ key: "injury", value: "broke arm", words: "broke his arm" }], subject_id: D }), call("person_benefits", { topic: "fracture after a fall", subject_id: D })],
        (v) => { const ev = (id: string) => call("evaluate_benefit", { case: "broke arm", purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: D, assumption_words: "broke" }); return [ev(benefitIdOf(v, /^Simple Fracture$/i)), ev(benefitIdOf(v, /Simple Fracture or Other Fracture/i))]; },
        (v) => [call("final_answer", { subject_id: D, sentences: resultIds(v).slice(0, 2).map((r) => ({ kind: "calculation", text: "-", result_id: r })), next_steps: ["contact:" + CERT] })],
      ] };
      installLoopModel(new ScriptedLoopModel([fracScript(G2), corr]));
      try {
        const a1 = await hx.send("grace fell down and broke her arm", {});
        const a2 = await hx.send("No, sorry, it's daniel, not grace. He broke his arm.", { id: a1.conversationId!, rev: a1.conversationRevision! });
        const s2 = await hx.savedAnswer(a2.conversationId!); const v2 = visible(s2.answer);
        check("B23 (F3) after a person correction, the new person's undefined row is still named: 'Ask the insurer whether Daniel's fracture is one', no S$120,000", /Ask the insurer whether Daniel's fracture is one\./.test(v2) && hidden({ v: v2, answer: s2.answer }), v2);
      } finally { installLoopModel(null); }
    }
  }
  // B12: wrong version. A later certificate for the household (S$750,000 for Grace) and the earlier one superseded: only the current one is used; the superseded figure is not cited.
  {
    const oldCert = FX.CERT_P1;
    const newCert = FX.CERT_P1.replace(/As of 06\/10\/2022/g, "As of 06/10/2024").replace("S****822B\tTan Hui Min Grace\tS$600,000", "S****822B\tTan Hui Min Grace\tS$750,000");
    const base = FX.DOCS.find((d) => d.key === "CERT")!;
    const docs = FX.DOCS.map((d) => d.key === "CERT" ? { ...d, pages: { 1: oldCert }, superseded: true } : d);
    docs.push({ ...base, key: "CERT_NEW", id: "7d000000-0000-4000-8000-000000000104", hash: "sha256:fx-cert-new", effective: "2024-10-06", filename: "Certificate of Insurance (2024).pdf", pages: { 1: newCert }, superseded: false } as any);
    const h5 = await startHarness(defined({ ...FX, DOCS: docs }));
    installLoopModel(new ScriptedLoopModel([fracScript({ id: G, mention: "grace", msg: /grace/i }, "7d000000-0000-4000-8000-000000000104")]));
    try {
      const a = await h5.send("grace fell down and broke her arm", {}); const s = await h5.savedAnswer(a.conversationId!); const v = visible(s.answer);
      check("B12 (wrong-version control) with the earlier certificate superseded, the current one's S$750,000 is the base (20% = S$150,000, dated 2024) and the superseded S$600,000 / S$120,000 appear nowhere", /S\$150,000/.test(v) && /S\$750,000/.test(v) && !/S\$120,000|S\$600,000/.test(v) && /2024/.test(v), v);
    } finally { installLoopModel(null); }
  }
  // B13: wrong base. A library with the Product Summary only has no sum insured to take 20% of: nothing is taken from the other document's base or from a sum no document prints.
  {
    const only = { ...FX, DOCS: FX.DOCS.filter((d) => d.key === "PRODUCT_SUMMARY") } as any;
    const h6 = await startHarness(only);
    installLoopModel(new ScriptedLoopModel([fracScript({ id: G, mention: "grace", msg: /grace/i }, "", false)]));
    try {
      const a = await h6.send("grace fell down and broke her arm", {}); const s = await h6.savedAnswer(a.conversationId!); const v = visible(s.answer);
      check("B13 (wrong-base control) the Product Summary alone: 25% x the printed S$5,000 limit only (S$1,250); never 25% of a sum insured (S$150,000) nor the certificate's S$120,000", /S\$1,250/.test(v) && !/S\$150,000|S\$120,000|S\$600,000/.test(v), v);
    } catch (e) { check("B13 (wrong-base control) runs", false, String(e)); } finally { installLoopModel(null); }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
