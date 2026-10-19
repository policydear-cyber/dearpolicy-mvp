/**
 * fx-live-1 repairs, end to end through the real chat route (recorded model tool calls + scripted continuation; NO model call, no spend).
 *
 * Every conversation starts from the model's RECORDED tool calls of the fx-live-1 run (scripts/fixtures/reliable-chat/fx-live-1-model-calls.json,
 * played by scripts/fixtures/reliable-chat/recorded-model.ts). The recorded final_answer / ask_user is the exact failing output;
 * where the repaired pipeline gives the model one repair round, the continuation is what a model that follows the repair message
 * would send (labelled "continuation"); the "no repair" variants prove the pipeline fails closed when it does not.
 *
 *   A  K6b / K6a absence statements (repair 1)      B  the cancer amount stays with its limitation (repair 2)
 *   C  reported cause, sickness (repair 3)          D  one coherent person correction (repair 4)
 *   E  broad-change reviews (repair 5)              F  the footnote (repair 6)
 *
 *   node --import tsx scripts/reliable-chat-fx-repairs-test.ts          (SHOW=1 prints every answer)
 *   ONLY=A node --import tsx ...                                           (one group)
 */
import { NextRequest } from "next/server";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as FX from "./fixtures/reliable-chat/fracture-conversation";
import { ScriptedLoopModel, type ScriptCall, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { recorded, recordedTerminal, recordedTurns } from "./fixtures/reliable-chat/recorded-model";
import { BS, CERT, G, benefitIdOf, call, idsAny, resultIds } from "./fixtures/reliable-chat/fracture-script";
import { isCauseKey } from "@/lib/rag2/loop/facts";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 30).join("\n     ") : ""}`); };
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const only = (g: string) => !process.env.ONLY || process.env.ONLY.split(",").includes(g);

const K1_MSG = "How much Personal Accident cover does Grace have?";
const K6B_MSG = "Does Grace's cover pay for dental treatment?";
const K6A_MSG = "What does Grace's Group Living Care pay if she is diagnosed with cancer?";
const K2_MSG = "Grace was hospitalised for three days last week because she was sick. Does her accident cover pay anything?";
const K4B_MSG1 = "grace fell down and broke her arm", K4B_MSG2 = "Actually it was Daniel who broke his arm, not Grace.";
const nextStepsOf = (tag: string, turn = 0) => ((recordedTerminal(tag, turn).arguments as any).next_steps ?? []) as string[];

async function main() {
  setEnv(FX as any);
  const h = await startHarness(FX as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { GET: history } = await import("@/app/api/chat/history/[id]/route");
  const reopen = async (conv: string) => { const r = await history(new NextRequest(`http://localhost/api/chat/history/${conv}`), { params: Promise.resolve({ id: conv }) }); const j = await r.json(); return (j.messages ?? []).filter((m: any) => m.role === "assistant").map((m: any) => m.answer_json); };
  type Out = { v: string; shown: string; reopened: string; saved: string; answer: any; trace: any; conv: { id: string; rev: number }; err?: string };
  const turn = async (label: string, user: string, conv: { id?: string; rev?: number } = {}): Promise<Out> => {
    const a = await h.send(user, conv);
    const s = await h.savedAnswer(a.conversationId!);
    const re = (await reopen(a.conversationId!)).at(-1);
    const trace = s.state.ragLoop.turns.at(-1);
    const o: Out = { v: visible(s.answer), shown: visible(a), reopened: visible(re), saved: visible(s.answer), answer: s.answer, trace, conv: { id: a.conversationId!, rev: a.conversationRevision! } };
    if (process.env.SHOW) console.log(`--- ${label}\n${o.v}\n  outcome: ${trace.outcome}\n  dropped: ${JSON.stringify((trace.dropped ?? []).map((d: any) => d.reason))}\n  calls: ${JSON.stringify((trace.toolCalls ?? []).map((c: any) => `${c.name}${c.ok ? "" : " ERR"}`))}`);
    return o;
  };
  const same = (o: Out) => o.shown === o.saved && o.saved === o.reopened;
  const play = async <T>(turns: ScriptTurn[], f: () => Promise<T>): Promise<T> => { installLoopModel(new ScriptedLoopModel(turns)); try { return await f(); } finally { installLoopModel(null); } };
  /** Recorded turn(s) of `tag`, with continuation steps appended to the LAST recorded turn. */
  const withContinuation = (tag: string, ...more: ((v: any) => ScriptCall[])[]): ScriptTurn[] => { const t = recordedTurns(tag); t[t.length - 1].steps.push(...(more as any)); return t; };

  // ================================================================================================ A: absence statements
  if (only("A")) {
    // A1: the exact fx-live-1 K6b output, then what a model that follows the repair message sends
    const notFoundDental = (extra: Record<string, unknown> = {}) => (): ScriptCall[] => [call("final_answer", { subject_id: G, sentences: [{ kind: "not_found", text: "-", claim: "benefit_not_found", topic: "dental treatment", terms: ["dental", "dentist", "tooth"], ...extra }], next_steps: nextStepsOf("A/K6b") })];
    const a1 = await play(withContinuation("A/K6b", notFoundDental()), () => turn("A1 K6b recorded + repair", K6B_MSG));
    check("A1 (K6b) the recorded uncertainty is sent back ONCE with the instruction to use a not_found statement", (a1.trace.toolCalls ?? []).some((c: any) => c.name === "final_answer" && c.ok === false), JSON.stringify((a1.trace.toolCalls ?? []).map((c: any) => [c.name, c.ok])));
    check("A2 (K6b) after the repair the answer says what the documents show: no dental benefit is described in them", /do not describe a benefit for dental treatment/.test(a1.v) && !/couldn.t confirm an answer/.test(a1.v), a1.v);
    check("A3 (K6b) and that this is NOT 'you have no dental cover'", /not the same as saying there is no such cover/.test(a1.v) && !/\b(?:you|she|Grace) (?:has|have|had) no dental (?:cover|coverage)/i.test(a1.v) && !/not covered|excluded/i.test(a1.v.replace(/not the same as saying it is excluded or not covered/gi, "")), a1.v);
    check("A4 (K6b) the scope is named: the three documents checked", /Scheme X Group Insurance/.test(a1.v) && (a1.answer.absenceChecks?.[0]?.documents?.length ?? 0) === 3, JSON.stringify(a1.answer.absenceChecks));
    check("A5 (K6b) returned = saved = reopened, and the checked scope (with source versions) is saved with the answer", same(a1) && !!a1.answer.absenceChecks?.[0]?.documents?.every((d: any) => d.policyId && d.fileHash), `${a1.shown}\n--\n${a1.saved}\n--\n${a1.reopened}`);

    // A6: the model does not repair: fails closed (never an unverified absence, never 'no dental cover')
    const noRepair = await play(withContinuation("A/K6b", () => [call("final_answer", { subject_id: G, sentences: [{ kind: "uncertainty", text: "The uploaded documents I found for Grace do not establish cover for dental treatment; the Scheme X Group Insurance wording and certificate do not state a dental benefit, so I can’t confirm that her treatment would be paid.", evidence_ids: ["e22", "e23"] }] })]), () => turn("A6 K6b, model repeats the unchecked sentence", K6B_MSG));
    check("A6 (K6b, no repair) the unchecked absence sentence is never shown: the answer is the plain 'could not confirm' note", !/do not (?:establish|state|describe)/.test(noRepair.v) && /couldn.t confirm|can.t confirm/.test(noRepair.v), noRepair.v);
    check("A6b (K6b, no repair) returned = saved = reopened", same(noRepair), `${noRepair.shown}\n--\n${noRepair.reopened}`);

    // A7: a false absence is refused (the documents print the topic) and the answer is not an absence
    const fracture = await play(withContinuation("A/K6b", () => [call("final_answer", { subject_id: G, sentences: [{ kind: "not_found", text: "-", claim: "benefit_not_found", topic: "fracture", terms: ["fracture"] }] })], () => [call("final_answer", { subject_id: G, sentences: [{ kind: "not_found", text: "-", claim: "benefit_not_found", topic: "fracture", terms: ["fracture"] }] })]), () => turn("A7 false absence (fracture)", K6B_MSG));
    check("A7 a not_found for a topic the scoped documents print ('fracture') is refused, naming where it is printed; nothing says it is absent", !/do not describe a benefit for fracture/.test(fracture.v) && (fracture.trace.toolCalls ?? []).some((c: any) => /prints|printed/.test(JSON.stringify(c.error ?? c.result ?? c.summary ?? ""))) , JSON.stringify(fracture.trace.toolCalls?.map((c: any) => [c.name, c.ok, String(c.error ?? c.summary ?? "").slice(0, 160)])));
  }

  // ================================================================================================ B: the cancer amount stays with its limitation
  if (only("B")) {
    const fact = (recordedTerminal("A/K6a").arguments as any).sentences[0];
    const k6aFinal = (...more: Record<string, unknown>[]) => (): ScriptCall[] => [call("final_answer", { subject_id: G, sentences: [fact, ...more], next_steps: nextStepsOf("A/K6a") })];
    const silent = { kind: "not_found", text: "-", claim: "document_silent", topic: "what Group Living Care pays for cancer", terms: ["cancer"], scope_policy_ids: [CERT] };
    const b1 = await play(withContinuation("A/K6a", k6aFinal(silent)), () => turn("B1 K6a recorded + repair (document_silent)", K6A_MSG));
    check("B1 (K6a) with the supported absence the amount is shown WITH its limitation: the dated Living Care sum insured, and that the certificate does not state what it pays for cancer", /S\$350,000/.test(b1.v) && /does not state what Group Living Care pays for cancer/.test(b1.v), b1.v);

    // B2: the model's own sentence (the recorded one, unchanged) is not repaired: the amount must not stand alone as the answer
    const legacy = (recordedTerminal("A/K6a").arguments as any).sentences[1];
    const b2 = await play(withContinuation("A/K6a", k6aFinal(legacy)), () => turn("B2 K6a, model repeats the recorded unchecked sentence", K6A_MSG));
    if (process.env.DEBUGB) console.log(JSON.stringify(b2.answer.figureBindings?.map((b: any) => ({ ...b, passage: String(b.passage).slice(0, 80) })), null, 1));
    check("B2 (K6a, no repair) the unverified absence sentence is not shown", !/do not establish what Group Living Care pays for cancer/.test(b2.v), b2.v);
    check("B2b (K6a, no repair) the amount does NOT stand alone as the answer to the cancer question: its limitation (a listed sum insured does not say what is paid for a diagnosis) stays with it", /S\$350,000/.test(b2.v) && /(?:does not|doesn.t) (?:by itself )?(?:say|show|state|establish) what (?:is|it) pa(?:id|ys) for/i.test(b2.v) || !/S\$350,000/.test(b2.v), b2.v);
    check("B2c (K6a, no repair) returned = saved = reopened", same(b2), `${b2.shown}\n--\n${b2.reopened}`);

    // B3 control: a plain amount lookup (recorded K1, unchanged) carries no limit it was never given
    const k1 = await play(recordedTurns("A/K1"), () => turn("B3 K1 recorded (control)", K1_MSG));
    check("B3 (K1 control) a plain lookup of the dated amount is unchanged: the figure and its date, no added limitation", /S\$/.test(k1.v) && !/does not by itself say what is paid/.test(k1.v), k1.v);
    // B4 control: a qualifier about ANOTHER benefit that is left out does not put a limit on this benefit's amount
    const other = { kind: "uncertainty", text: "The uploaded documents available here do not establish what the Wellness Rider pays for dental, so I can’t determine a dental benefit from them.", evidence_ids: (legacy as any).evidence_ids };
    const b4 = await play(withContinuation("A/K6a", k6aFinal(other)), () => turn("B4 K6a, left-out qualifier about another benefit (control)", K6A_MSG));
    check("B4 (control) a left-out qualifier about a different benefit (it WAS left out) adds no limit to the Living Care amount", /S\$350,000/.test(b4.v) && (b4.trace.dropped ?? []).length > 0 && !/does not by itself say what is paid/.test(b4.v), `${b4.v}\n${JSON.stringify(b4.trace.dropped)}`);
  }

  // ================================================================================================ C: the reported cause (K2)
  if (only("C")) {
    check("C0a invented keys for the cause of an event are the cause concept: accident_cause, was_it_accident, due_to_accident_or_illness, cause_of_hospitalisation", ["accident_cause", "was_it_accident", "due_to_accident_or_illness", "cause_of_hospitalisation", "accident"].every(isCauseKey));
    check("C0b and keys about something else are not: accident_date, accident_location, accidental_death_amount, hospital_name, injury_type, continuous_confinement", ["accident_date", "accident_location", "accidental_death_amount", "hospital_name", "injury_type", "continuous_confinement"].every((k) => !isCauseKey(k)));
    const ask = recordedTerminal("A/K2").arguments as any;
    const c0 = await play(recordedTurns("A/K2"), () => turn("C0 K2 recorded", K2_MSG));
    if (process.env.DEBUGC) console.log(JSON.stringify(c0.trace.toolCalls?.map((c: any) => [c.name, c.ok, String(c.error ?? c.summary ?? "").slice(0, 400)]), null, 1));
    check("C1 (K2) the household said it was sickness: the accident question is NOT asked again", !/accident|injury/i.test((c0.answer.questions ?? []).map((q: any) => q.text).join(" ")) && !(c0.answer.questions ?? []).length, JSON.stringify(c0.answer.questions));
    check("C2 (K2) the accident/injury requirement is quoted from the benefit's own wording, with its page, and the reported cause is said not to fit it", /Accidental Hospital Recuperation Benefit \(page 9\)/.test(c0.v) && /bodily injury as a result of an Accident/.test(c0.v) && /“she was sick”\) is an illness, not an accident/.test(c0.v) && /condition is not met/.test(c0.v), c0.v);
    check("C3 (K2) the $250 amount (a bare '$') is not left looking like what is payable for a sickness", !/\$\s?250|\b250\b/.test(c0.v), c0.v);
    check("C4 (K2) returned = saved = reopened; the question is not pending for the next turn", same(c0) && !c0.trace.pending, `${c0.shown}\n--\n${c0.reopened}`);
    // C5: the model asks without statements -- the refusal says what to do, and the model's own final_answer gets the same explanation
    const noStmts = recordedTurns("A/K2"); const last = noStmts[0].steps.length - 1;
    noStmts[0].steps[last] = () => [call("ask_user", { ...ask, statements: undefined })];
    noStmts[0].steps.push(() => [call("final_answer", { subject_id: G, sentences: ask.statements, next_steps: ["contact:" + CERT] })]);
    const c5 = await play(noStmts, () => turn("C5 K2, ask without statements, then final_answer", K2_MSG));
    check("C5 (K2) the refused question is followed by the model's own final_answer: the same explanation, no question, the contact step kept", !(c5.answer.questions ?? []).length && /is an illness, not an accident/.test(c5.v) && /Aldermoor Life Ltd/.test(c5.v), c5.v);
    // C6 (accident reported): the terms stay, and the reported cause is said to meet the accident condition
    const accidentTurn: ScriptTurn = { steps: [
      () => [call("resolve_person", { mention: "Grace" })],
      () => [call("note_facts", { subject_id: G, facts: [{ key: "how_it_happened", value: "fell down the stairs", words: "fell down the stairs" }, { key: "hospital_stay_duration", value: "3 days", words: "hospitalised for three days" }] }), call("person_benefits", { subject_id: G, topic: "accident cover and hospitalisation" })],
      () => [call("evaluate_benefit", { benefit_id: (ask.statements[0] as any).benefit_id, subject_id: G, purpose: "claim", assumption_words: "hospitalised for three days after she fell down the stairs" })],
      () => [call("ask_user", { ...ask, fact_key: "accident_cause", question: "Was Grace’s hospitalisation caused by an accident?" })],
      () => [call("final_answer", { subject_id: G, sentences: ask.statements, next_steps: ["contact:" + CERT] })],
    ] };
    const c6 = await play([accidentTurn], () => turn("C6 accident reported", "Grace fell down the stairs and was hospitalised for three days last week. Does her accident cover pay anything?"));
    if (process.env.DEBUGC) { const sv = await h.savedAnswer(c6.conv.id); console.log(JSON.stringify(sv.state.ragLoop.claim?.facts ?? null), JSON.stringify(Object.keys(sv.state.ragLoop.otherClaims ?? {}))); }
    check("C6 (accident reported) the accident question is not asked, the benefit's terms are kept and the reported cause is said to meet the accident condition", !(c6.answer.questions ?? []).length && /250/.test(c6.v) && /is an accident, which is what that condition requires/.test(c6.v), c6.v);
    // C7 (cause unknown, control): the accident question IS legitimately asked and nothing is said about fit
    const unknownTurn: ScriptTurn = { steps: [
      () => [call("resolve_person", { mention: "Grace" })],
      () => [call("note_facts", { subject_id: G, facts: [{ key: "hospital_stay_duration", value: "3 days", words: "hospitalised for three days" }] }), call("person_benefits", { subject_id: G, topic: "accident cover and hospitalisation" })],
      () => [call("evaluate_benefit", { benefit_id: (ask.statements[0] as any).benefit_id, subject_id: G, purpose: "claim", assumption_words: "hospitalised for three days" })],
      () => [call("ask_user", ask)],
    ] };
    const c7 = await play([unknownTurn], () => turn("C7 cause not reported (control)", "Grace was hospitalised for three days last week. Does her accident cover pay anything?"));
    if (process.env.DEBUGC) console.log(JSON.stringify(c7.trace.toolCalls?.map((c: any) => [c.name, c.ok, String(c.error ?? "").slice(0, 900)])));
    check("C7 (control, cause not reported) the accident question is still asked, and nothing is said about a reported cause", (c7.answer.questions ?? []).length === 1 && !/The cause you reported/.test(c7.v), c7.v);
  }

  // ================================================================================================ D: one coherent person correction (K4b)
  if (only("D")) {
    const rec = recordedTurns("A/K4b");
    const d = await play(rec, async () => { const t1 = await turn("D1 K4b turn 1", K4B_MSG1); const t2 = await turn("D2 K4b turn 2 (the correction to Daniel)", K4B_MSG2, t1.conv); return { t1, t2 }; });
    if (process.env.DEBUGD) console.log(JSON.stringify(d.t2.trace.toolCalls?.map((c: any) => [c.name, c.ok, String(c.error ?? "").slice(0, 200), JSON.stringify(c.args).slice(0, 200)]), null, 1));
    const notices = (d.t2.v.match(/Updated:[^.]*\./g) ?? []);
    check("D1 (K4b) the correction produces exactly ONE person-correction notice, naming Daniel as the person now meant", notices.filter((n: string) => /this is about/i.test(n)).length === 1 && /this is about Daniel, not Grace/.test(d.t2.v), d.t2.v);
    check("D2 (K4b) no notice contradicts it: 'this is about Grace, not Daniel' never appears", !/this is about Grace, not Daniel/i.test(d.t2.v), d.t2.v);
    check("D3 (K4b) no spurious fact correction caused by the move itself (an 'Updated: injury is now ...' notice)", !/Updated: (?!this is about)/.test(d.t2.v), d.t2.v);
    check("D4 (K4b) the answer uses Daniel's facts and documents: his figures, his name, not Grace's", /Daniel/.test(d.t2.v) && !/\bGrace\b[^.]*\b(?:S\$1,250|S\$120,000)/.test(d.t2.v.replace(/Updated:[^.]*\./g, "")), d.t2.v);
    check("D5 (K4b) returned = saved = reopened", same(d.t2), `${d.t2.shown}\n--\n${d.t2.reopened}`);
    const DAN = FX.M.daniel.id;
    if (process.env.DEBUGD) console.log(JSON.stringify(Object.keys(d.t2.answer)), JSON.stringify((d.t2.answer.calculations ?? []).map((c: any) => Object.keys(c))), JSON.stringify((d.t2.answer.calculations ?? []).map((c: any) => c.subjectId ?? c.subject_id ?? c.who)));
    const calcSubjects = (a: any) => [...(a.calculations ?? []).map((c: any) => c.subjectId ?? c.subject_id), ...(a.figureBindings ?? []).map((b: any) => b.subjectId)];
    check("D6 (K4b) every calculation and figure of the corrected answer is bound to Daniel's own row", calcSubjects(d.t2.answer).length > 0 && calcSubjects(d.t2.answer).every((x: string) => x === DAN), JSON.stringify(calcSubjects(d.t2.answer)));
    const sv = await h.savedAnswer(d.t2.conv.id);
    const cl = sv.state.ragLoop.claim;
    check("D7 (K4b) the saved active claim is Daniel's with his own words ('broke his arm'); Grace's claim is kept aside with hers", cl?.subjectId === DAN && /broke his arm/.test(JSON.stringify(cl.facts)) && !/broke her arm/.test(JSON.stringify(cl.facts)) && /broke her arm/.test(JSON.stringify(sv.state.ragLoop.otherClaims?.[G]?.facts ?? {})), JSON.stringify({ active: cl?.facts, other: sv.state.ragLoop.otherClaims?.[G]?.facts }));
    // D8: the other order of the same intermediate updates -- Daniel's facts first, Grace's after: still one notice, still Daniel
    const rr = recorded("A/K4b"); const mk = (calls: { name: string; arguments: Record<string, unknown> }[]) => () => calls.map((c) => ({ name: c.name, arguments: c.arguments }));
    const [resolveD, noteG] = rr[3].calls, [noteD, benefitsD] = rr[4].calls;
    const swapped: ScriptTurn = { steps: [mk([resolveD, noteD]), mk([noteG, benefitsD]), ...rr.slice(5).map((r) => mk(r.calls))] };
    const d8 = await play([recordedTurns("A/K4b")[0], swapped], async () => { const t1 = await turn("D8 turn 1", K4B_MSG1); return turn("D8 K4b turn 2, Daniel's facts first then Grace's", K4B_MSG2, t1.conv); });
    check("D8 (K4b, other order) one notice, naming Daniel; Grace's fact written after the move does not move the claim back", d8.v.match(/Updated: this is about [^.]*\./g)?.length === 1 && /this is about Daniel, not Grace/.test(d8.v) && !/Grace, not Daniel/.test(d8.v) && calcSubjects(d8.answer).every((x: string) => x === DAN), d8.v);
    // D9: a LATER, separate correction back to Grace is a new correction (one notice) -- the guard only holds within one turn
    const back: ScriptTurn = { steps: [
      () => [call("resolve_person", { mention: "Grace" })],
      () => [call("final_answer", { subject_id: G, sentences: [{ kind: "suggestion", text: "You can ask me to go through the fracture figures for Grace again." }] })],
    ] };
    const d9 = await play([...recordedTurns("A/K4b"), back], async () => { const t1 = await turn("D9 turn 1", K4B_MSG1); const t2 = await turn("D9 turn 2", K4B_MSG2, t1.conv); const t3 = await turn("D9 turn 3 (a later correction back to Grace)", "Sorry, I meant Grace after all, not Daniel.", t2.conv); return t3; });
    check("D9 (control) a later correction back to Grace IS made, once: 'this is about Grace, not Daniel'", d9.v.match(/Updated: this is about [^.]*\./g)?.length === 1 && /this is about Grace, not Daniel/.test(d9.v), d9.v);
  }

  // ================================================================================================ E: the two broad changes of the PR, reviewed
  if (only("E")) {
    const { sanitizeStoredAnswer, storedRenderContext } = await import("@/lib/chat/monetary-boundary");
    // the production shape: a QUESTION turn (mode fact_finding) asked together with the established illustrations
    const TA: ScriptTurn = { steps: [
      () => [call("resolve_person", { mention: "grace" })],
      () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: "broke her arm", words: "broke her arm" }], subject_id: G }), call("person_benefits", { topic: "fracture after a fall", subject_id: G })],
      (v) => { const sb = benefitIdOf(v, /^Simple Fracture$/i), so = benefitIdOf(v, /Simple Fracture or Other Fracture/i); const ev = (id: string) => call("evaluate_benefit", { case: "broke her arm", purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: G, assumption_words: "broke her arm" }); return [ev(sb), ev(so), call("search_passages", { k: 6, query: "accidental hospital recuperation benefit hospital 24 hours", policy_ids: [BS] })]; },
      (v) => { const r = resultIds(v); return [call("ask_user", { kind: "fact", fact_key: "continuous_confinement", subject_id: G, question: "Was Grace confined as a resident patient in a hospital for a continuous period of at least 24 hours?", statements: [{ kind: "calculation", text: "-", result_id: r[0], subject_id: G }, { kind: "calculation", text: "-", result_id: r[1], subject_id: G }], because_evidence_ids: idsAny(v, /continuous period of at least 24 hours/, "search_passages").slice(0, 1) })]; },
    ] };
    const base = await play([TA], () => turn("E0 a genuine question asked with the established illustrations (mode fact_finding)", K4B_MSG1));
    check("E0 (setup) the saved answer is a question turn (fact_finding) that carries calculations", base.answer.mode === "fact_finding" && (base.answer.calculations ?? []).length >= 2, `${base.answer.mode} ${(base.answer.calculations ?? []).length}`);
    const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
    const reopenedText = (a: any) => visible(sanitizeStoredAnswer(clone(a)));
    // ---- 5a: the claim-context shortcut
    check("E1 (5a) the loop records the context it wrote the answer under, and it validates on reopening (the calculations recompute; every figure shown is a stored record's)", base.answer.renderContext?.origin === "rag_loop" && storedRenderContext(base.answer) === false, JSON.stringify(base.answer.renderContext));
    check("E2 (5a) reopened = saved for the answer written under it (the production defect stays fixed)", reopenedText(base.answer) === base.saved && /S\$120,000/.test(reopenedText(base.answer)), reopenedText(base.answer));
    const legacy = clone(base.answer); delete legacy.renderContext;
    check("E3 (5a) the same answer WITHOUT recorded provenance (saved by an older build, or by another pipeline) is not trusted for having calculations: read under the default, claim-aware context", storedRenderContext(legacy) === null && !/S\$120,000/.test(reopenedText(legacy)), reopenedText(legacy));
    const extra = clone(base.answer); extra.details = [...extra.details, "You will receive S$9,999 from the insurer."];
    check("E4 (5a) a figure in the text that no stored record states voids the provenance for the whole answer (fail closed), however many calculations it carries", storedRenderContext(extra) === null && !/S\$9,999/.test(reopenedText(extra)), reopenedText(extra));
    const tampered = clone(base.answer); tampered.calculations[0].result.value += 1;
    check("E5 (5a) a stored calculation that does not recompute voids the provenance", storedRenderContext(tampered) === null, String(storedRenderContext(tampered)));
    const claimy = clone(base.answer); claimy.claimItems = [{ benefitTitle: "x", status: "potentially_applicable", conditions: [], reason: "x" }];
    check("E6 (5a) an answer that carries claim items is always a claim answer", storedRenderContext(claimy) === null);
    const forged = clone(base.answer); forged.details = ["The insurer will pay you S$50,000."]; forged.summary = "Quick answer.";
    check("E7 (5a) a forged or edited text with the recorded context but figures no record states is not restored", storedRenderContext(forged) === null && !/S\$50,000/.test(reopenedText(forged)), reopenedText(forged));
    const noCalc = clone(base.answer); noCalc.calculations = []; noCalc.details = (noCalc.details ?? []).filter((d: string) => !/S\$/.test(d));
    check("E6b (5a, control) an answer that carries no stored calculation keeps being read under the default context, as before (it labels the printed figures it states)", storedRenderContext(noCalc) === null);
    // lifecycle and the boundary still run on top of the restored context: a deleted or replaced document withdraws the reopened answer
    const cert = FX.doc("CERT").id;
    await h.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [cert]);
    const afterDelete = (await reopen(base.conv.id)).at(-1);
    await h.db.query("UPDATE policies SET lifecycle_state='active' WHERE id=$1", [cert]);
    check("E8 (5a) lifecycle is retained: with a document the answer rests on deleted, the reopened answer is withdrawn, not served from its stored context", !/S\$120,000|S\$1,250/.test(visible(afterDelete)), visible(afterDelete));
    check("E9 (5a) and the same answer is whole again when the document is active (the test changed nothing else)", visible((await reopen(base.conv.id)).at(-1)) === base.saved);

    // ---- 5b: the question-support test is a heuristic: its controls
    const { unprintedAsk } = await import("@/lib/rag2/loop/questions");
    const names = [FX.M.grace.name, FX.M.daniel.name];
    const fractureLead = ["If an Insured Person sustains bodily injury as a result of an Accident, which results in a Simple Fracture or Other Fracture of the nature mentioned in the table below, we will pay the relevant amount specified in the table below."];
    const proofWording = [...fractureLead, "Proof of the fracture, confirmed by X-ray and certified by a Registered Medical Practitioner, must be provided."];
    const hospitalClause = ["In addition to the specific exclusions listed below, if within 30 days following bodily injury as a result of an Accident, it is medically necessary due to the said injury (whether directly or indirectly necessary) of the Insured Person to be confined as a resident patient in a Hospital for a continuous period of at least 24 hours on the recommendation of a Registered Medical Practitioner but not for the purpose of convalescent rest, We will pay a one-time amount of $250 per hospitalisation."];
    const un = (q: string, key: string, ev: string[]) => unprintedAsk(q, key, ev, names);
    check("P1 (5b) the recorded K4b question, a requirement (X-ray + registered practitioner) the fracture wording does not print, is not asked", !!un("Was Grace’s arm fracture confirmed by X-ray and certified by a registered medical practitioner?", "fracture_confirmation", fractureLead));
    check("P2 (5b, short unsupported) 'Was it confirmed by X-ray?' is judged too, however short: the fracture wording prints no X-ray", !!un("Was it confirmed by X-ray?", "fracture_confirmation", fractureLead), JSON.stringify(un("Was it confirmed by X-ray?", "fracture_confirmation", fractureLead)));
    check("P3 (5b, short supported) the same short question against wording that prints it is asked", un("Was it confirmed by X-ray?", "fracture_confirmation", proofWording) === null);
    check("P4 (5b, paraphrased legitimate) 'Did the stay run through a whole day?' (key continuous_confinement) is asked: it is the printed 24-hour confinement requirement in other words", un("Did the stay run through a whole day?", "continuous_confinement", hospitalClause) === null, JSON.stringify(un("Did the stay run through a whole day?", "continuous_confinement", hospitalClause)));
    check("P5 (5b, paraphrased legitimate) 'Was Grace in hospital as an in-patient for a full day or longer?' is asked", un("Was Grace in hospital as an in-patient for a full day or longer?", "continuous_confinement", hospitalClause) === null);
    check("P6 (5b, long unsupported, not a procedure) a long question about conditions the wording never prints, under a key it does not print either, is not asked", !!un("Was Grace’s fracture displaced and did it need surgical pinning under general anaesthetic?", "fracture_displacement", fractureLead));
    check("P7 (5b, paraphrased, unaligned key) enough shared words still counts: 'Was Grace confined in hospital for a continuous 24 hours?' under another key is asked", un("Was Grace confined in hospital for a continuous 24 hours?", "overnight_stay", hospitalClause) === null);
    check("P8 (5b, procedure supported by what it names) 'Was the diagnosis certified by a registered medical practitioner?' against wording that prints a Registered Medical Practitioner is asked", un("Was the diagnosis certified by a registered medical practitioner?", "diagnosis_certification", hospitalClause) === null);
    check("P9 (5b) a question choosing among printed cases ('Which bone ...?') and the cause / stay vocabulary checks are untouched", un("Which bone did Grace break?", "bone", fractureLead) === null && un("Was it an accident?", "accident_cause", fractureLead) === null);
  }

  // ================================================================================================ F: the footnote
  if (only("F")) {
    const { percentTables, rowNotes, tableNotes } = await import("@/lib/rag2/calc/pct-rows");
    const NOTE_TOE = /toe and foot are not covered/, NOTE_HAND = /thumb, finger and palm are not covered/;
    // the household's event, evaluated against BOTH fracture documents, then the answer: the Product Summary's illustration, the certificate's, and the summary's printed terms
    const fractureTurn = (words: string, withTerms = false): ScriptTurn => ({ steps: [
      () => [call("resolve_person", { mention: "grace" })],
      () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: words, words }], subject_id: G }), call("person_benefits", { topic: "fracture after a fall", subject_id: G })],
      (v) => { const sb = benefitIdOf(v, /^Simple Fracture$/i), so = benefitIdOf(v, /Simple Fracture or Other Fracture/i); const ev = (id: string) => call("evaluate_benefit", { case: words, purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: G, assumption_words: words }); return [ev(sb), ev(so)]; },
      (v) => { const r = resultIds(v); const sb = benefitIdOf(v, /^Simple Fracture$/i); return [call("final_answer", { subject_id: G, sentences: [{ kind: "calculation", text: "-", result_id: r[0], subject_id: G }, { kind: "calculation", text: "-", result_id: r[1], subject_id: G }, ...(withTerms ? [{ kind: "benefit_terms", text: "-", benefit_id: sb, subject_id: G }] : [])] })]; },
    ] });
    // (each server-written statement is one line of the visible answer)
    const lineWith = (v: string, re: RegExp) => v.split("\n").filter((x) => re.test(x)).join(" ").replace(/\s+/g, " ");
    const arm = await play([fractureTurn("broke her arm")], () => turn("F1 arm", K4B_MSG1));
    check("F1 the Product Summary's Arm row illustration (S$1,250) carries the '#' footnote from the page: thumb, finger and palm are not covered", NOTE_HAND.test(lineWith(arm.v, /S\$1,250/)), arm.v);
    check("F2 …and NOT the leg row's '^' footnote (toe and foot): it qualifies a different row", !NOTE_TOE.test(arm.v), arm.v);
    const certSentence = lineWith(arm.v, /S\$120,000/);
    check("F3 the certificate's own row (S$120,000, a different document and row) carries neither footnote", /S\$120,000/.test(certSentence) && !NOTE_HAND.test(certSentence) && !NOTE_TOE.test(certSentence), certSentence);
    check("F4 returned = saved = reopened, and the saved answer still reopens whole (its calculations recompute)", same(arm) && arm.answer.renderContext?.origin === "rag_loop", `${arm.shown}\n--\n${arm.reopened}`);
    const { sentencesOf } = await import("@/lib/chat/answer-verification");
    const calcLines = (o: Out) => ((o.answer.calculations ?? []) as any[]).map((k) => String(k.sentence));
    check("F4b the footnote is part of the SAVED calculation sentence, which stays ONE sentence for the splitter and is displayed and reopened whole", calcLines(arm).filter((x) => NOTE_HAND.test(x)).length === 1 && calcLines(arm).every((x) => sentencesOf(x).length === 1 && arm.v.includes(x) && arm.shown.includes(x) && arm.reopened.includes(x)), JSON.stringify(calcLines(arm)));
    const leg = await play([fractureTurn("broke her leg")], () => turn("F5 leg", "grace fell down and broke her leg"));
    check("F5 the Leg row's illustration (S$2,500) carries the '^' footnote: toe and foot are not covered", NOTE_TOE.test(lineWith(leg.v, /S\$2,500/)), leg.v);
    check("F6 …and not the arm row's '#' footnote", !NOTE_HAND.test(leg.v), leg.v);
    check("F7 returned = saved = reopened (leg)", same(leg), `${leg.shown}\n--\n${leg.reopened}`);
    const terms = await play([fractureTurn("broke her arm", true)], () => turn("F8 terms", K4B_MSG1));
    const listing = lineWith(terms.v, /for each listed case/);
    const notesPart = listing.split("Arm, Elbow, Wrist or Ribs 25%.")[1] ?? "";
    check("F8 the printed terms of the Product Summary state each footnote with the row that prints its marker, and only those rows", /Leg, Ankle or Knee”[^“]*“[^”]*toe and foot are not covered”/.test(notesPart) && /Arm, Elbow, Wrist or Ribs”[^“]*“[^”]*thumb, finger and palm are not covered”/.test(notesPart) && !/Hip|Neck|Cheekbone/.test(notesPart), listing);
    check("F9 returned = saved = reopened (terms)", same(terms), `${terms.shown}\n--\n${terms.reopened}`);

    // ---- the parser's controls (pure: the page text decides, nothing else)
    const PAGE = (rows: string[], after: string[]) => ["Fracture Benefit Limit: S$5,000", "Schedule\tCompensation", "(% of S$5,000)", ...rows, ...after].join("\n");
    const notesOf = (page: string) => percentTables(page).flatMap((t) => t.rows.filter((r) => r.percents.length === 1).map((r) => [r.label, rowNotes(page, t, r).map((n) => n.text)] as const));
    const base = ["Hip\t75%", "Leg^, Ankle or Knee\t50%", "Wrist or Ribs\t25%"];
    const c1 = notesOf(PAGE(base, ["^\tToe and foot are not covered."]));
    check("F10 (control) a row with no marker gets no note: only the row printing '^' carries it", c1.find(([l]) => l === "Hip")![1].length === 0 && c1.find(([l]) => /Leg/.test(l))![1].join() === "Toe and foot are not covered." && c1.find(([l]) => /Wrist/.test(l))![1].length === 0, JSON.stringify(c1));
    const c2 = notesOf(PAGE(base, ["#\tThumb and finger are not covered."]));
    check("F11 (control) a footnote whose marker no row prints is attached to nothing", c2.every(([, n]) => n.length === 0), JSON.stringify(c2));
    const c3 = notesOf(PAGE(base, ["Page 3 of 36"]));
    check("F12 (control) a row printing a marker the page never defines gets no note (nothing is invented)", c3.every(([, n]) => n.length === 0), JSON.stringify(c3));
    const c4 = notesOf(PAGE(base, ["", "•\tAmbulance Cost*\tUp to S$500 per incident", "*This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme."]));
    check("F13 (control) a '*' footnote further down, after other benefits, is not taken for a note of this table", c4.every(([, n]) => n.length === 0), JSON.stringify(c4));
    const c5 = notesOf(PAGE(["Hip\t75%", "Leg*, Ankle or Knee\t50%", "Wrist or Ribs\t25%"], ["*\tToe and foot are", "not covered", "•\tDisappearance\t100% of Sum Insured"]));
    check("F14 (control) a note wrapped onto the next line is whole, and stops at the next bullet", c5.find(([l]) => /Leg/.test(l))![1].join() === "Toe and foot are not covered" && c5.filter(([, n]) => n.length).length === 1, JSON.stringify(c5));
    const c6 = notesOf(PAGE(["Hip\t75%", "Leg^, Ankle or Knee\t50%", "Wrist¹ or Ribs\t25%"], ["^\tToe and foot are not covered", "¹\tElbow is a separate case"]));
    check("F15 (control) two markers on two rows: each row gets its own note and not the other's", c6.find(([l]) => /Leg/.test(l))![1].join() === "Toe and foot are not covered" && c6.find(([l]) => /Wrist/.test(l))![1].join() === "Elbow is a separate case", JSON.stringify(c6));
    const c7 = notesOf(PAGE(base, ["Fractures are paid once per policy year.", "^\tToe and foot are not covered"]));
    check("F16 (control) an ordinary sentence under the table is not a footnote, and a marker line after it is not taken for this table's", c7.every(([, n]) => n.length === 0), JSON.stringify(c7));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
