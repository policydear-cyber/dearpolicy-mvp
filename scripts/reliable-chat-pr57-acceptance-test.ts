/**
 * PR #57 follow-up: acceptance checks for the demonstrated failures and gaps on C0 (main 4956588), through the real chat route.
 * Scripted model only (ScriptedLoopModel): NO model call, no spend. Owner: Test engineer (docs/rag-migration/pr57-roles/test/).
 *
 * Every check has a class:
 *   AC     acceptance -- written to FAIL on C0; the repaired candidate must PASS it
 *   GUARD  must PASS on C0 and on every later candidate (a control, so a repair cannot over-correct)
 *   INFO   reported, not counted (replay fidelity)
 *
 *   R   fx-live-2 replay: the run's RECORDED model tool calls (responses.jsonl) played through this tree's code. Repetition (K3t1, K4b),
 *       other listed cover for a sickness (v1 K2.3), the K6a limitation in the amount's own sentence, K6c "the policy definition".
 *       LABEL: a recorded-calls replay shows what the code does with the model's recorded statements. A repair made in the prompt or
 *       tool schema cannot show here; it needs an authorised live run.
 *   H1  Critic H1: "Daniel broke his arm too." plus an ordinary correction-like cue is not a correction
 *   H2  Critic H2: an injury reported together with a sickness word does not lose the accident benefit
 *   M1  Critic M1: a reported part the row's own footnote prints as not covered gets no amount for that row
 *   M2  Critic M2: an absence over a document with an unreadable (empty) page is refused
 *   M3  Critic M3: the topic's own word is searched even when the product name contains it
 *       M5: the fixture library (two partial copies) never gets an absence; M0-M4 run on documents stored in full
 *   M4  Critic M4: a saved "not described" answer is withdrawn when a document is added to its scope
 *   N   negative controls: wrong person, product, version and percentage base; supported information surviving verification
 *   GP  DC's live GP-bill failure (20 Oct): the journey, a medical-expense control, G1 must-not-fire cases, no applicability clause
 *   Q3  Policy QC Q3: a person correction where the two people's sums insured differ recalculates from the new person's own row
 *
 *   node --import tsx scripts/reliable-chat-pr57-acceptance-test.ts                 (--show prints every answer; an argument, not an environment variable)
 *   node --import tsx scripts/reliable-chat-pr57-acceptance-test.ts --only=R,H1      (named groups only)
 */
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as FX from "./fixtures/reliable-chat/fracture-conversation";
import { ScriptedLoopModel, type ScriptCall, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { CERT, G, benefitIdOf, call, idsAny, resultIds } from "./fixtures/reliable-chat/fracture-script";
import { recordedTerminal, recordedTurns } from "./fixtures/reliable-chat/recorded-model";
import { sentences } from "./rag2-live/usefulness-check";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
type Cls = "AC" | "GUARD" | "INFO";
const tally: Record<Cls, { pass: number; fail: number }> = { AC: { pass: 0, fail: 0 }, GUARD: { pass: 0, fail: 0 }, INFO: { pass: 0, fail: 0 } };
const check = (cls: Cls, name: string, ok: boolean, detail = "") => {
  tally[cls][ok ? "pass" : "fail"]++;
  console.log(`${ok ? "PASS" : "FAIL"} [${cls}] ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 30).join("\n     ") : ""}`);
};
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const textOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const show = process.argv.includes("--show");
const only = (g: string) => !onlyArg || onlyArg.split(",").includes(g);

const RUN = path.join(process.cwd(), "docs/rag-migration/live/RUN-fx-live-2-2026-10-20T02-39-03");
/** fx-live-2's recorded model calls per conversation, split into turns (a turn after the first starts with resolve_person). */
function fxLive2Turns(conv: string): ScriptTurn[] {
  const steps: ScriptCall[][] = [];
  for (const line of fs.readFileSync(path.join(RUN, "responses.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const j = JSON.parse(line);
    const m = /^A\/(.+)#(\d+)$/.exec(j.key);
    if (!m || m[1] !== conv) continue;
    const msg = JSON.parse(j.response).choices[0].message;
    steps[Number(m[2])] = (msg.tool_calls ?? []).map((t: any) => ({ name: t.function.name, arguments: JSON.parse(t.function.arguments) }));
  }
  const turns: ScriptTurn[] = [];
  steps.forEach((calls, i) => {
    if (i === 0 || calls[0]?.name === "resolve_person") turns.push({ steps: [] });
    turns[turns.length - 1].steps.push(() => calls);
  });
  return turns;
}
const savedAnswers = JSON.parse(fs.readFileSync(path.join(RUN, "answers.json"), "utf8")) as { id: string; turns: { user: string; text: string }[] }[];

/** Sentences that say the documents leave open WHICH alternative/document applies. */
const UNSETTLED = /\b(?:do(?:es)? not (?:establish|settle|say|show|determine)|neither document says)\b[^.;]*\bwhich\b/i;
const NOTE_TOE = /toe and foot are not covered/;

async function main() {
  setEnv(FX as any);
  const h = await startHarness(FX as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { GET: history } = await import("@/app/api/chat/history/[id]/route");
  const reopen = async (conv: string) => { const r = await history(new NextRequest(`http://localhost/api/chat/history/${conv}`), { params: Promise.resolve({ id: conv }) }); const j = await r.json(); return (j.messages ?? []).filter((m: any) => m.role === "assistant").map((m: any) => m.answer_json); };
  type Out = { v: string; text: string; shown: string; reopened: string; saved: string; answer: any; trace: any; conv: { id: string; rev: number } };
  const turn = async (label: string, user: string, conv: { id?: string; rev?: number } = {}): Promise<Out> => {
    const a = await h.send(user, conv);
    const s = await h.savedAnswer(a.conversationId!);
    const re = (await reopen(a.conversationId!)).at(-1);
    const trace = s.state.ragLoop.turns.at(-1);
    const o: Out = { v: visible(s.answer), text: textOf(s.answer), shown: visible(a), reopened: visible(re), saved: visible(s.answer), answer: s.answer, trace, conv: { id: a.conversationId!, rev: a.conversationRevision! } };
    if (show) console.log(`--- ${label}\n${o.v}\n  outcome: ${trace.outcome}\n  dropped: ${JSON.stringify((trace.dropped ?? []).map((d: any) => d.reason))}\n  calls: ${JSON.stringify((trace.toolCalls ?? []).map((c: any) => `${c.name}${c.ok ? "" : " ERR " + String(c.error ?? "").slice(0, 200)}`))}`);
    return o;
  };
  const same = (o: Out) => o.shown === o.saved && o.saved === o.reopened;
  const play = async <T>(turns: ScriptTurn[], f: () => Promise<T>): Promise<T> => { installLoopModel(new ScriptedLoopModel(turns)); try { return await f(); } finally { installLoopModel(null); } };
  const stateOf = async (o: Out) => (await h.savedAnswer(o.conv.id)).state.ragLoop;
  const live = (c: any) => Object.values(c?.calcs ?? {}).filter((r: any) => !r.withdrawn) as any[];
  const claimOf = (s: any, who: string) => (s.claim?.subjectId === who ? s.claim : s.otherClaims?.[who]);
  const DAN = FX.M.daniel.id;

  // The production shape of a fracture turn for one person (as in reliable-chat-fx-repairs-test.ts group G).
  const QG = "Was Grace confined as a resident patient in a hospital for a continuous period of at least 24 hours?";
  const bind = (v: any, re: RegExp) => idsAny(v, re, "search_passages").slice(0, 1);
  const fractureTurn = (who: string, words: string, how: string | null, ask: string | null): ScriptTurn => ({ steps: [
    () => [call("resolve_person", { mention: who === G ? "grace" : "Daniel" })],
    () => [call("note_facts", { facts: [...(how ? [{ key: "how_it_happened", value: how, words: how }] : []), { key: "injury", value: words, words }], subject_id: who }), call("person_benefits", { topic: "fracture after a fall", subject_id: who })],
    (v) => { const sb = benefitIdOf(v, /^Simple Fracture$/i), so = benefitIdOf(v, /Simple Fracture or Other Fracture/i); const ev = (id: string) => call("evaluate_benefit", { case: words, purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: who, assumption_words: words }); return [ev(sb), ev(so), call("search_passages", { k: 6, query: "accidental hospital recuperation benefit hospital continuous period", subject_id: who })]; },
    (v) => { const r = resultIds(v); const st = [{ kind: "calculation", text: "-", result_id: r[0], subject_id: who }, { kind: "calculation", text: "-", result_id: r[1], subject_id: who }]; return ask ? [call("ask_user", { kind: "fact", fact_key: "continuous_confinement", subject_id: who, question: ask, statements: st, because_evidence_ids: bind(v, /continuous period of at least 24 hours/) })] : [call("final_answer", { subject_id: who, sentences: st, next_steps: ["contact:" + CERT] })]; },
  ] });

  // ================================================================================================ R: fx-live-2 recorded calls
  if (only("R")) {
    const out: Record<string, Out[]> = {};
    for (const c of savedAnswers) {
      const turns = fxLive2Turns(c.id);
      out[c.id] = await play(turns, async () => { const o: Out[] = []; for (const [i, t] of c.turns.entries()) o.push(await turn(`R ${c.id} turn ${i + 1}`, t.user, i ? o[i - 1].conv : {})); return o; });
      c.turns.forEach((t, i) => check("INFO", `R0 ${c.id} turn ${i + 1}: the replay on this tree shows the same text as the live run (answers.json)`, out[c.id][i].text === t.text, `live:\n${t.text}\n--replay:\n${out[c.id][i].text}`));
    }
    const count = (t: string, re: RegExp) => sentences(t).filter((s) => re.test(s));
    const k3 = out.K3t1[0].v, k4 = out.K4b[1].v;
    check("AC", "R1 (K3t1, repetition) that the documents leave open which alternative applies is said at most once", count(k3, UNSETTLED).length <= 1, count(k3, UNSETTLED).join("\n"));
    check("AC", "R2 (K4b correction turn, repetition) the same, at most once", count(k4, UNSETTLED).length <= 1, count(k4, UNSETTLED).join("\n"));
    check("AC", "R3 (K3t1, repetition) that the two documents use different bases is said once (no 'different bases' sentence beside the bases sentence)", count(k3, /different bases|takes its percentage of/i).length <= 1, count(k3, /different bases|takes its percentage of/i).join("\n"));
    for (const [id, o] of [["K3t1", out.K3t1[0]], ["K4b", out.K4b[1]]] as const)
      check("GUARD", `R4 (${id}) both alternatives stay (S$1,250 and S$120,000), framed as alternatives, never a total, and the open point is still said`, /S\$1,250/.test(o.v) && /S\$120,000/.test(o.v) && /never a total|not to be added/.test(o.v) && !/S\$121,250/.test(o.v) && count(o.v, UNSETTLED).length >= 1, o.v);
    const k2 = out.K2[0].v;
    check("AC", "R5 (K2, v1 K2.3) the sickness answer says the certificate also lists Living Care cover that no stored page describes", /Living Care/.test(k2) && /(?:no (?:stored )?page|not|do(?:es)? not|don.t) (?:describe|say|show|state)|not described/i.test(k2), k2);
    // R6, expectation correction (Policy QC ruling 1, qc/FINDINGS-C1.md): was "no amount (no S$250 / $250) is given ... no question is asked".
    // The 250 may appear only as printed terms with their conditions and currency basis, never as an amount for this stay.
    const k2with250 = k2.split(/\n|(?<=[.;])\s+(?=[A-Z])/).filter((x) => /\b250\b/.test(x));
    check("GUARD", "R6 (K2) any 250 is the benefit's printed terms with its conditions (accident injury, 30 days, 24 hours) and currency basis (S$ only with the Product Summary, else the bare '$'), never an amount for this stay; nothing promises payment; no question is asked", k2with250.every((x) => /within 30 days/.test(x) && /at least 24 hours/.test(x) && (/S\$\s?250/.test(x) ? /Product Summary/.test(x) : /bare “\$” sign/.test(x)) && !/(?:this|her) stay|(?:Grace|she) (?:can|will|would|could) (?:get|receive|claim)/i.test(x)) && !/will (?:be )?pa(?:y|id) (?:Grace|her|you)/i.test(k2) && !(out.K2[0].answer.questions ?? []).length, k2);
    const k6a = out.K6a[0].v;
    const amountSentence = sentences(k6a).find((s) => /S\$350,000/.test(s)) ?? "";
    check("AC", "R7 (K6a) the S$350,000 sentence itself carries the limitation that the documents do not show what Living Care pays for cancer", /cancer/i.test(amountSentence) && /(?:do(?:es)? not|doesn.t) (?:state|show|say|describe|establish)/i.test(amountSentence), amountSentence);
    // A recorded conversation cannot go on past a refusal the live run never met (the recorded calls have no repair step): such a turn
    // ends in the error answer. That is an evidence limit of the replay, reported as INFO, and R8 judges the turns that completed.
    const done = [out.K6a[0], out.K6c[0]].filter((o) => o.trace.outcome !== "error");
    for (const [id, o] of [["K6a", out.K6a[0]], ["K6c", out.K6c[0]]] as const) if (o.trace.outcome === "error") check("INFO", `R8x (${id}) the recorded calls reach a refusal the live run did not meet, so the replay ends there (needs a live run): ${String((o.trace.toolCalls ?? []).find((c: any) => c.name === "final_answer" && !c.ok)?.error ?? "").slice(0, 160)}`, false);
    check("GUARD", "R8 (K6a, K6c, the turns that completed) S$350,000 is dated and never presented as what will be paid", done.length > 0 && done.every((o) => /S\$350,000/.test(o.v) && /6 October 2022/.test(o.v) && !/will (?:pay|receive)[^.]*S\$350,000/i.test(o.v)), done.map((o) => o.v).join("\n--\n"));
    const k6c = out.K6c[0].v;
    check("AC", "R9 (K6c) no definition is implied where none was shown ('meets the policy definition')", !/(?:meets?|satisf\w*|under|within|fall\w* within) (?:the|its|a|her) (?:policy(?:.s)? )?definition/i.test(k6c), k6c);
    check("GUARD", "R10 (K6b) the dental answer cites no passage (whether the absence is said over the fixture's partial documents is M5)", (out.K6b[0].answer.citations ?? []).length === 0, JSON.stringify(out.K6b[0].answer.citations ?? []).slice(0, 400));
    check("GUARD", "R11 every replayed turn: returned = saved = reopened", Object.values(out).flat().every(same), Object.values(out).flat().filter((o) => !same(o)).map((o) => `${o.shown}\n--\n${o.reopened}`).join("\n====\n"));
  }

  // ================================================================================================ H1: "too" with a correction-like cue
  if (only("H1")) {
    const too = (msg: string) => play([fractureTurn(G, "broke her arm", "fell down", QG), { steps: [
      () => [call("resolve_person", { mention: "Daniel" })],
      () => [call("note_facts", { facts: [{ key: "injury", value: "broke his arm", words: "broke his arm" }], subject_id: DAN })],
      () => [call("final_answer", { subject_id: G, sentences: [{ kind: "suggestion", text: "You can ask me to go on with the question about Grace." }] })],
    ] }], async () => { const a1 = await turn("H1 turn 1", "grace fell down and broke her arm"); const a2 = await turn(`H1 ${msg}`, msg, a1.conv); return { a2, s2: await stateOf(a2) }; });
    const msgs = ["Daniel broke his arm too. It was not serious.", "Daniel broke his arm too. I mean, he fell off his bike.", "Daniel broke his arm too, he slipped rather than fell.", "Daniel broke his arm too, but it wasn't Grace's fault."];
    for (const [i, msg] of msgs.entries()) {
      const r = await too(msg);
      const gc = claimOf(r.s2, G);
      check(i === 3 ? "GUARD" : "AC", `H1.${[1, 2, 3, 6][i]} "${msg}" is another person's scenario, not a correction: Grace keeps 'broke her arm' and 'fell down', her two illustrations stay live, her question stays open, no correction notice`, gc?.facts?.injury?.value === "broke her arm" && gc.facts.how_it_happened?.value === "fell down" && live(gc).length === 2 && r.s2.pending?.subjectId === G && !/Updated: this is about/.test(r.a2.v), JSON.stringify({ grace: gc?.facts, live: live(gc).length, pending: r.s2.pending?.subjectId, v: r.a2.v }));
    }
    const plain = await too("Daniel broke his arm too.");
    const gp = claimOf(plain.s2, G);
    check("GUARD", "H1.4 (control) plain \"Daniel broke his arm too.\" carries nothing and moves nothing", gp?.facts?.injury?.value === "broke her arm" && live(gp).length === 2 && !/Updated: this is about/.test(plain.a2.v), JSON.stringify(gp?.facts));
    const fix = await play([fractureTurn(G, "broke her arm", "fell down", QG), { steps: [
      () => [call("resolve_person", { mention: "Daniel" })],
      () => [call("note_facts", { facts: [{ key: "injury", value: "broke his arm", words: "broke his arm" }], subject_id: DAN })],
      () => [call("final_answer", { subject_id: DAN, sentences: [{ kind: "suggestion", text: "You can ask me to go through Daniel's fracture figures." }] })],
    ] }], async () => { const a1 = await turn("H1.5 turn 1", "grace fell down and broke her arm"); const a2 = await turn("H1.5 correction", "Actually it was Daniel who broke his arm, not Grace.", a1.conv); return { a2, s2: await stateOf(a2) }; });
    check("GUARD", "H1.5 (control) a real correction (\"Actually it was Daniel who broke his arm, not Grace.\") is still made, once", (fix.a2.v.match(/Updated: this is about [^.]*\./g) ?? []).length === 1 && /this is about Daniel, not Grace/.test(fix.a2.v), fix.a2.v);
  }

  // ================================================================================================ H2: sickness word + injury
  if (only("H2")) {
    const ask = recordedTerminal("A/K2").arguments as any;
    const hosp = (how: string, msg: string) => play([{ steps: [
      () => [call("resolve_person", { mention: "Grace" })],
      () => [call("note_facts", { subject_id: G, facts: [{ key: "how_it_happened", value: how, words: how }, { key: "hospital_stay_duration", value: "3 days", words: "in hospital for three days" }] }), call("person_benefits", { subject_id: G, topic: "accident cover and hospitalisation" })],
      () => [call("evaluate_benefit", { benefit_id: (ask.statements[0] as any).benefit_id, subject_id: G, purpose: "claim", assumption_words: `in hospital for three days after she ${how}` })],
      () => [call("final_answer", { subject_id: G, sentences: ask.statements, next_steps: ["contact:" + CERT] })],
    ] }], () => turn(`H2 ${how}`, msg));
    const h2 = await hosp("felt sick and fainted, hitting her head", "Grace felt sick and fainted, hitting her head, and was in hospital for three days. Does her accident cover pay anything?");
    check("AC", "H2.1 an injury reported with a sickness word ('felt sick and fainted, hitting her head'): the server does not decide the accident condition is unmet, and the benefit's terms (S$250) stay with the printed accident condition", !/not met/i.test(h2.v) && /250/.test(h2.v) && /Accident/.test(h2.v), h2.v);
    const h2b = await hosp("fell down the stairs", "Grace fell down the stairs and was in hospital for three days. Does her accident cover pay anything?");
    check("GUARD", "H2.2 (control) a plain accident keeps the terms (S$250) and no 'not met'", /250/.test(h2b.v) && !/not met/i.test(h2b.v), h2b.v);
    check("GUARD", "H2.3 returned = saved = reopened", same(h2) && same(h2b));
  }

  // ================================================================================================ M1: the row's own footnote excludes the reported part
  if (only("M1")) {
    const evals: string[] = [];
    const toe = (words: string) => play([{ steps: [
      () => [call("resolve_person", { mention: "grace" })],
      () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: words, words }], subject_id: G }), call("person_benefits", { topic: "fracture after a fall", subject_id: G })],
      (v) => [call("evaluate_benefit", { case: "Leg, Ankle or Knee", purpose: "claim", fact_keys: ["injury"], benefit_id: benefitIdOf(v, /^Simple Fracture$/i), subject_id: G, assumption_words: words })],
      (v) => { evals.push(JSON.stringify(v.find("evaluate_benefit")?.result ?? null)); const r = resultIds(v); return [call("final_answer", { subject_id: G, sentences: r.length ? r.map((x) => ({ kind: "calculation", text: "-", result_id: x, subject_id: G })) : [{ kind: "uncertainty", text: "The documents do not give an amount for this injury on that row." }] })]; },
    ] }], () => turn(`M1 ${words}`, `grace fell down and ${words}`));
    const t = await toe("broke her toe");
    const line = t.v.split("\n").find((x) => /S\$2,500/.test(x)) ?? "";
    check("GUARD", "M1.0 (setup, the test can fail) the toe turn completes with a final answer", t.trace.outcome === "final_answer", `${t.trace.outcome}\n${t.v}`);
    check("GUARD", "M1.1 (Critic M1, not reproduced on C0: the server reads the reported 'toe' and returns unlisted_case) 'broke her toe' mapped by the model to the 'Leg, Ankle or Knee^' row: no S$2,500 is given beside that row's own 'toe and foot are not covered' footnote", t.trace.outcome === "final_answer" && !(/S\$2,500/.test(line) && NOTE_TOE.test(line)), `${t.v}\nevaluate_benefit: ${evals[0]?.slice(0, 600)}`);
    const l = await toe("broke her ankle");
    check("GUARD", "M1.2 (control) 'broke her ankle' on the same row still gets S$2,500 (the footnote names toe and foot, not ankle)", /S\$2,500/.test(l.v), l.v);
  }

  // ================================================================================================ M2-M4: absence scope
  // The fracture fixture's Product Summary and Benefit Summary are partial copies (4 of 37 pages; 6 pages of an unknown total), so an
  // absence over them must be refused (M5). M0-M4 run on a library whose documents are all stored in full: those two are set aside
  // (soft-deleted) for the group and a two-page "Hospital Plan" for Grace (page_count 2, both pages stored) joins the certificate (1 of 1).
  const PSUM = FX.doc("PRODUCT_SUMMARY").id, BSUM = FX.doc("BENEFIT_SUMMARY").id;
  const HOSP = "7d000000-0000-4000-8000-000000000198", NEW = "7d000000-0000-4000-8000-000000000199";
  const addDoc = async (id: string, product: string, pages: string[], pageCount: number | null, hash: string) => {
    await h.db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date,document_date,page_count)
      VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,'ready',$10,$10,'scan_clean','active',NULL,$11,NULL,NULL,NULL,$12)`, [id, FX.ACCOUNT, G, "Example Insurer", product, "H-1", "Hospital insurance", "policy_wording", false, product + ".pdf", hash, pageCount]);
    await h.db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,NULL)", [id, G, FX.ACCOUNT]);
    for (const [i, t] of pages.entries()) await h.db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [FX.ACCOUNT, id, i + 1, t]);
  };
  const HOSP_PAGES = ["Hospital Plan: Schedule of Benefits\nHospital Cash: S$100 per day of confinement, up to 30 days per policy year.", "General Exclusions\nWe will not pay for cosmetic surgery or any treatment received outside Singapore."];
  const dentalAbsence = (terms: string[]) => play([{ steps: [
    () => [call("resolve_person", { mention: "Grace" })],
    () => [call("person_benefits", { subject_id: G, topic: "dental treatment" })],
    () => [call("final_answer", { subject_id: G, sentences: [{ kind: "not_found", text: "-", claim: "benefit_not_found", topic: "dental treatment", terms }], next_steps: ["contact:" + CERT] })],
    () => [call("final_answer", { subject_id: G, sentences: [{ kind: "uncertainty", text: "I could not confirm this from the documents." }] })],
  ] }], () => turn(`absence ${terms.join(",")}`, "Does Grace's cover pay for dental treatment?"));
  const ABSENT = /do not describe a benefit for dental/;
  if (only("M2") || only("M3") || only("M4")) {
    const m5 = await dentalAbsence(["dental", "dentist", "tooth"]);
    check("AC", "M5 over the fixture's own library (Product Summary 4 of 37 pages stored; Benefit Summary of unknown length) no absence of dental is said", !ABSENT.test(m5.v), m5.v);
    await h.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id = ANY($1::uuid[])", [[PSUM, BSUM]]);
    await addDoc(HOSP, "Hospital Plan", HOSP_PAGES, 2, "sha256:pr57-hospital-plan");
    try {
      const base = await dentalAbsence(["dental", "dentist", "tooth"]);
      check("GUARD", "M0 (setup) over documents stored in full (certificate 1 of 1, Hospital Plan 2 of 2) the dental absence is said", ABSENT.test(base.v), base.v);
      if (only("M2")) {
        await h.db.query("UPDATE policy_pages SET text='' WHERE policy_id=$1 AND page_number=2", [HOSP]);
        let m2: Out;
        try { m2 = await dentalAbsence(["dental", "dentist", "tooth"]); } finally { await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=2", [HOSP, HOSP_PAGES[1]]); }
        check("AC", "M2 with one stored page of a scoped document empty (Hospital Plan page 2), 'do not describe a benefit for dental' is not said over a page that was never read", !ABSENT.test(m2.v), m2.v);
        await h.db.query("UPDATE policies SET page_count=3 WHERE id=$1", [HOSP]);
        let m2b: Out;
        try { m2b = await dentalAbsence(["dental", "dentist", "tooth"]); } finally { await h.db.query("UPDATE policies SET page_count=2 WHERE id=$1", [HOSP]); }
        check("AC", "M2b with a page of the Hospital Plan never stored (page_count 3, pages 1-2 stored), no absence is said", !ABSENT.test(m2b.v), m2b.v);
        await h.db.query("UPDATE policy_pages SET page_number=3 WHERE policy_id=$1 AND page_number=2", [HOSP]);
        let m2c: Out;
        try { m2c = await dentalAbsence(["dental", "dentist", "tooth"]); } finally { await h.db.query("UPDATE policy_pages SET page_number=2 WHERE policy_id=$1 AND page_number=3", [HOSP]); }
        check("AC", "M2c with page_count 2 but pages 1 and 3 stored (page 2 never stored), no absence is said: a count of stored pages is not a full read", !ABSENT.test(m2c.v), m2c.v);
      }
      if (only("M3")) {
        await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=2", [HOSP, HOSP_PAGES[1] + "\nDental Benefit: up to S$500 per policy year for dental treatment by a registered dental surgeon."]);
        let ctrl: Out, m3: Out;
        try {
          ctrl = await dentalAbsence(["dentist"]);
          await h.db.query("UPDATE policies SET product_name='Hospital and Dental Plan' WHERE id=$1", [HOSP]);
          m3 = await dentalAbsence(["dentist"]);
        } finally {
          await h.db.query("UPDATE policies SET product_name='Hospital Plan' WHERE id=$1", [HOSP]);
          await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=2", [HOSP, HOSP_PAGES[1]]);
        }
        check("GUARD", "M3.1 (control) a page that prints a dental benefit refuses the absence (terms ['dentist'], topic 'dental treatment')", !ABSENT.test(ctrl.v), ctrl.v);
        check("AC", "M3.2 the same page refuses it when the document's product name contains 'Dental' (the topic word is still searched)", !ABSENT.test(m3.v), m3.v);
      }
      if (only("M4")) {
        const m4 = await dentalAbsence(["dental", "dentist", "tooth"]);
        check("GUARD", "M4.0 (setup) the absence is said and saved before the new document arrives", ABSENT.test(m4.v), m4.v);
        await addDoc(NEW, "Smile Plan", ["Dental Benefit: up to S$500 per policy year for dental treatment."], 1, "sha256:pr57-new-dental");
        let after: string;
        try { after = visible((await reopen(m4.conv.id)).at(-1)); } finally { await h.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [NEW]); }
        check("AC", "M4 after a document for Grace that prints a dental benefit is added, the reopened answer no longer says her documents do not describe one", !ABSENT.test(after), after);
      }
    } finally {
      await h.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [HOSP]);
      await h.db.query("UPDATE policies SET lifecycle_state='active' WHERE id = ANY($1::uuid[])", [[PSUM, BSUM]]);
    }
  }

  // ================================================================================================ Q3: correction with different sums insured
  if (only("Q3")) {
    const page = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=1", [CERT])).rows[0] as { text: string };
    const DROW = "S****411A\tLee Wei Ming, Daniel\tS$600,000\tAs of 06/10/2022";
    const lines = page.text.split("\n"); const pa = lines.indexOf("GROUP PERSONAL ACCIDENT(POLICY NO. 3037850)");
    if (pa < 0 || lines[pa + 1] !== DROW) throw new Error("Q3: the certificate's Personal Accident row for Daniel is not where expected");
    lines[pa + 1] = DROW.replace("S$600,000", "S$400,000");
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [CERT, lines.join("\n")]);
    try {
      const q = await play([fractureTurn(G, "broke her arm", "fell down", null), fractureTurn(DAN, "broke his arm", null, null)], async () => {
        const a1 = await turn("Q3 turn 1 (Grace, S$600,000)", "grace fell down and broke her arm");
        const a2 = await turn("Q3 correction to Daniel (S$400,000)", "Actually it was Daniel who broke his arm, not Grace.", a1.conv);
        return { a1, a2, s2: await stateOf(a2) };
      });
      check("GUARD", "Q3.1 (setup) Grace's answer uses her own S$600,000: S$120,000", /S\$120,000/.test(q.a1.v) && /S\$600,000/.test(q.a1.v), q.a1.v);
      check("GUARD", "Q3.2 the corrected answer is recalculated from Daniel's own row: 20% of S$400,000 = S$80,000, and Grace's S$120,000 / S$600,000 is not carried", /S\$80,000/.test(q.a2.v) && /S\$400,000/.test(q.a2.v) && !/S\$120,000|S\$600,000/.test(q.a2.v.replace(/Updated:[^.]*\./g, "")), q.a2.v);
      check("GUARD", "Q3.3 Grace's illustrations are withdrawn and every live calculation is Daniel's", live(claimOf(q.s2, G)).length === 0 && live(claimOf(q.s2, DAN)).length >= 2, JSON.stringify({ g: live(claimOf(q.s2, G)).length, d: live(claimOf(q.s2, DAN)).length }));
      check("GUARD", "Q3.4 returned = saved = reopened", same(q.a1) && same(q.a2));
    } finally { await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [CERT, page.text]); }
  }

  // ================================================================================================ N: negative controls (project instructions, 20 Oct)
  // Wrong person, wrong product, wrong version, wrong percentage base, and supported information surviving verification.
  // A correction followed by a new scenario is reliable-chat:fx-repairs-test G6/G6b; not duplicated here.
  if (only("N")) {
    const finalFor = (stmtSubject: string, next: string[]): ScriptTurn => ({ steps: [
      ...fractureTurn(G, "broke her arm", "fell down", null).steps.slice(0, 3),
      (v) => [call("final_answer", { subject_id: stmtSubject, sentences: resultIds(v).map((r) => ({ kind: "calculation", text: "-", result_id: r, subject_id: stmtSubject })), next_steps: next })],
    ] });
    const ok = await play([finalFor(G, ["contact:" + CERT])], () => turn("N0 Grace fracture", "grace fell down and broke her arm"));
    check("GUARD", "N1 (percentage base) S$1,250 is 25% of the fixed S$5,000 limit and S$120,000 is 20% of Grace's S$600,000; neither base is swapped (no S$150,000, no S$1,000)", /25% of the Simple Fracture benefit limit of S\$5,000/.test(ok.v) && /20% of Grace's sum insured of S\$600,000/.test(ok.v) && !/S\$150,000|S\$1,000(?!,)/.test(ok.v), ok.v);
    check("GUARD", "N2 (supported information survives verification) the date, the '#' footnote and the insurer contact step all reach the saved and reopened answer", same(ok) && /6 October 2022/.test(ok.v) && /thumb, finger and palm are not covered/.test(ok.v) && /Contact Aldermoor Life Ltd/.test(ok.v), ok.v);
    const wrong = await play([finalFor(DAN, ["contact:" + CERT])], () => turn("N3 Grace's results stated as Daniel's", "grace fell down and broke her arm"));
    check("GUARD", "N3 (wrong person) Grace's calculations stated with Daniel as their subject are not shown as Daniel's", !/Daniel[^.\n]*S\$(?:1,250|120,000)|S\$(?:1,250|120,000)[^.\n]*Daniel/.test(wrong.v), wrong.v);
    const other = FX.DOCS.find((d) => d.account === FX.OTHER_ACCOUNT)?.id ?? "7d000000-0000-4000-8000-000000000998";
    const prod = await play([finalFor(G, ["contact:" + other])], () => turn("N4 contact step for a product that is not Grace's", "grace fell down and broke her arm"));
    check("GUARD", "N4 (wrong product) a contact step naming a document that is not in Grace's library names no insurer", !/Contact /.test(prod.v), prod.v);
    await h.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [FX.doc("BENEFIT_SUMMARY").id]);
    const gone = visible((await reopen(ok.conv.id)).at(-1));
    await h.db.query("UPDATE policies SET file_hash='sha256:fx-benefit-summary-v2', lifecycle_state='active' WHERE id=$1", [FX.doc("BENEFIT_SUMMARY").id]);
    const replaced = visible((await reopen(ok.conv.id)).at(-1));
    await h.db.query("UPDATE policies SET file_hash='sha256:fx-benefit-summary' WHERE id=$1", [FX.doc("BENEFIT_SUMMARY").id]);
    check("GUARD", "N5a (version) with the Benefit Summary deleted, the reopened answer no longer shows its S$120,000", !/S\$120,000/.test(gone), gone);
    check("AC", "N5b (version) with the Benefit Summary's stored file hash changed in place (another version of the file), the reopened calculation answer no longer shows its S$120,000 (on C0 only absence answers compare file hashes: lib/chat/stale-answers.ts)", !/S\$120,000/.test(replaced), replaced);
    const certLine = ok.v.split("\n").find((x) => /S\$120,000/.test(x)) ?? "";
    check("GUARD", "N7 the S$120,000 illustration carries nothing of the next benefit printed below its table (no 'Ambulance', no 'up to $500', no lettered heading)", /S\$120,000/.test(certLine) && !/Ambulance|up to \$\s?500|\bF\.\s/i.test(certLine), certLine);
    check("GUARD", "N6 and with the original version restored the reopened answer is whole again", visible((await reopen(ok.conv.id)).at(-1)) === ok.saved);
  }

  // ================================================================================================ GP: DC's live GP-bill failure (20 Oct)
  // RECONSTRUCTION on the anonymised household (Daniel stands in for the policyholder), scripted model: the three plausible model answers of
  // developer/GP-BILL.md (720f5f5). Ground truth for (a): Policy QC qc/GP-BILL.md (88c8953). Critic round 4 (5b59e01) conditions for G1/G2.
  // Run on a fully stored variant (missing pages added as pages that print no benefit wording), because an absence is only said over
  // documents read in full; GP.c1 makes the certificate partial on purpose.
  if (only("GP")) {
    const GP_MSG = "daniel tripped over the kerb and fell, his GP bill is $800, can he claim for this?";
    const contact = ["contact:" + CERT];
    const gpTurn = (final: (v: any) => ScriptCall[]): ScriptTurn => ({ steps: [
      () => [call("resolve_person", { mention: "daniel" })],
      () => [call("note_facts", { subject_id: DAN, facts: [{ key: "how_it_happened", value: "tripped over the kerb and fell", words: "tripped over the kerb and fell" }, { key: "bill_amount", value: "$800 GP bill", words: "his GP bill is $800" }] }), call("person_benefits", { subject_id: DAN, topic: "GP bill after an accident" })],
      () => [call("search_passages", { k: 8, query: "medical expenses outpatient GP clinic reimbursement accident", subject_id: DAN })],
      ...Array.from({ length: 6 }, () => final),
    ] });
    const GP_TERMS = ["outpatient", "GP", "clinic", "general practitioner"];
    const absence = { kind: "not_found", text: "-", claim: "benefit_not_found", topic: "GP or outpatient treatment", terms: GP_TERMS, subject_id: DAN };
    const V: Record<string, ScriptTurn> = {
      A: gpTurn(() => [call("final_answer", { subject_id: DAN, sentences: [absence], next_steps: contact })]),
      B: gpTurn((v) => [call("final_answer", { subject_id: DAN, sentences: [{ kind: "fact", text: "Daniel's Group Personal Accident cover reimburses ground ambulance costs after an accident up to $500.", evidence_ids: idsAny(v, /ambulance/i).slice(0, 1), subject_id: DAN }, absence], next_steps: contact })]),
      C: gpTurn(() => [call("final_answer", { subject_id: DAN, sentences: [{ kind: "fact", text: "Daniel's documents do not include a benefit that pays for a GP bill after a fall.", subject_id: DAN }], next_steps: contact })]),
    };
    const PSUM = FX.doc("PRODUCT_SUMMARY").id, BSUM = FX.doc("BENEFIT_SUMMARY").id;
    const full = async <T,>(f: () => Promise<T>, extra: Record<number, string> = {}): Promise<T> => {
      const ids = [PSUM, BSUM], counts = [37, 9], added: [string, number][] = [];
      for (const [k, id] of ids.entries()) {
        const have = new Set(((await h.db.query("SELECT page_number FROM policy_pages WHERE policy_id=$1", [id])).rows as { page_number: number }[]).map((r) => r.page_number));
        for (let p = 1; p <= counts[k]; p++) if (!have.has(p)) { await h.db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [FX.ACCOUNT, id, p, (id === BSUM && extra[p]) || `Test variant page ${p}: this page prints no benefit wording.`]); added.push([id, p]); }
        await h.db.query("UPDATE policies SET page_count=$2 WHERE id=$1", [id, counts[k]]);
      }
      try { return await f(); } finally {
        for (const [id, p] of added) await h.db.query("DELETE FROM policy_pages WHERE policy_id=$1 AND page_number=$2", [id, p]);
        await h.db.query("UPDATE policies SET page_count=37 WHERE id=$1", [PSUM]);
        await h.db.query("UPDATE policies SET page_count=NULL WHERE id=$1", [BSUM]);
      }
    };
    const run = (v: string, label = v) => play([V[v]], () => turn(`GP ${label}`, GP_MSG));
    const NONCOVER = /not covered|does not apply|is not insured|isn.t covered|no cover\b|not eligible/i;
    const CLAUSE = /specifically stated in Part 1|only applicable to you if|Not all Group Policies or Benefits/i;
    const G1SAYS = /(?:certificate|it) (?:does not|doesn.t) list/i;
    const all: Out[] = [];
    // (a) the journey, each model variant
    const outs = await full(async () => ({ A: await run("A"), B: await run("B"), C: await run("C") }));
    for (const [k, o] of Object.entries(outs)) {
      all.push(o);
      check("AC", `GP.a1 (variant ${k}) the answer does not end in "couldn't confirm" or the model-error reply`, !/couldn.t confirm|can.t confirm|returned an error/i.test(o.v), o.v);
      check("AC", `GP.a2 (variant ${k}) it does not say the documents were not looked up after the search ran`, !/haven.t (?:yet )?looked up|have not (?:yet )?looked up/i.test(o.v), o.v);
      check("GUARD", `GP.a3 (variant ${k}) the household's "$800" is kept as written (bare "$"), never turned into S$800 or an amount payable`, !/S\$\s?800/.test(o.v) && !/(?:pay|receive|claim)\w*[^.\n]*\$800/i.test(o.v.replace(/“[^”]*”/g, "")), o.v);
      check("GUARD", `GP.d (variant ${k}) no answer quotes the Part 1 applicability clause, and nothing says he is not covered`, !CLAUSE.test(o.v) && !NONCOVER.test(o.v.replace(/not the same as saying (?:it is excluded or not covered|there is no such cover)/gi, "")), o.v);
    }
    const a = outs.A;
    check("AC", "GP.a4 (variant A, QC ground truth) the answer says the uploaded documents show no GP or outpatient benefit, names Outpatient Medicare (OPMC) as on the scheme but not on his certificate (with its date), and suggests asking the insurer", /Outpatient Medicare|OPMC/.test(a.v) && G1SAYS.test(a.v) && /6 October 2022/.test(a.v) && /(?:GP|outpatient)/i.test(a.v) && /Contact Aldermoor Life Ltd/.test(a.v), a.v);
    check("AC", "GP.a5 (variant A, QC ground truth) the certificate's listed policies are named (Group Term Life, Group Personal Accident, Group Living Care)", /Group Term Life/.test(a.v) && /Group Personal Accident/.test(a.v) && /Group Living Care/.test(a.v), a.v);
    // (b) control: his accident benefit prints a medical-expense reimbursement
    const MED = "G. Medical Expenses due to Accident\nIf an Insured Person sustains bodily injury as a result of an Accident, we will reimburse the reasonable medical expenses incurred for treatment by a Registered Medical Practitioner within 52 weeks of the Accident, up to $2,000 per Accident.\nThis Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.";
    const med = await full(() => run("A", "b medical-expense control"), { 6: MED });
    all.push(med);
    check("AC", "GP.b1 (medical-expense control) the answer surfaces the accident benefit that reimburses medical expenses by a registered medical practitioner", /Medical Expenses/i.test(med.v) && /(?:registered )?medical practitioner/i.test(med.v), med.v);
    check("GUARD", "GP.b2 (medical-expense control) no absence is stated, and no amount is given for the $800", !/do not (?:describe|print) a benefit for|(?:certificate|it) (?:does not|doesn.t) list/i.test(med.v) && !/S\$\s?800/.test(med.v), med.v);
    // (c) G1 must not fire: certificate partial; only the abbreviation or only the full name on the certificate; a hit outside the policy list
    const certPage = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=1", [CERT])).rows[0] as { text: string };
    const withCert = async <T,>(text: string | null, count: number, f: () => Promise<T>) => {
      if (text != null) await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [CERT, text]);
      await h.db.query("UPDATE policies SET page_count=$2 WHERE id=$1", [CERT, count]);
      try { return await f(); } finally { await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [CERT, certPage.text]); await h.db.query("UPDATE policies SET page_count=1 WHERE id=$1", [CERT]); }
    };
    const addRow = (label: string) => certPage.text.replace("GROUP LIVING CARE PLUS(POLICY NO. 3037850)", `${label}(POLICY NO. 3037850)\nS****411A\tLee Wei Ming, Daniel\tPlan A\tAs of 06/10/2022\nGROUP LIVING CARE PLUS(POLICY NO. 3037850)`);
    const c1 = await full(() => withCert(null, 2, () => run("A", "c1 certificate partial")));
    const c2 = await full(() => withCert(addRow("GROUP OPMC"), 1, () => run("A", "c2 abbreviation only")));
    const c3 = await full(() => withCert(addRow("GROUP OUTPATIENT MEDICARE"), 1, () => run("A", "c3 full name only")));
    const c4 = await full(() => run("A", "c4 hit in a benefit's own wording"), { 4: "H. Accidental Medical Treatment\nOutpatient treatment at a clinic following an Accident is reimbursed under the Outpatient Medicare Policy only." });
    all.push(c1, c2, c3, c4);
    for (const [k, o] of [["c1 certificate not read in full", c1], ["c2 the certificate lists 'OPMC' (abbreviation only)", c2], ["c3 the certificate lists 'Outpatient Medicare' (full name only)", c3], ["c4 a hit inside a benefit's own wording, outside the scheme's policy list", c4]] as const)
      check("GUARD", `GP.${k}: G1 does not fire (no 'the certificate does not list ...'), and no absence is stated`, !G1SAYS.test(o.v) && !/do not (?:describe|print) a benefit for (?:GP|outpatient)/i.test(o.v), o.v);
    check("GUARD", "GP.d (all GP answers, including the controls) none quotes the Part 1 applicability clause", all.every((o) => !CLAUSE.test(o.v)), all.filter((o) => CLAUSE.test(o.v)).map((o) => o.v).join("\n====\n"));
    check("GUARD", "GP.r every GP answer: returned = saved = reopened", all.every(same), all.filter((o) => !same(o)).map((o) => `${o.shown}\n--\n${o.reopened}`).join("\n====\n"));
  }

  const t = tally;
  console.log(`\nAC ${t.AC.pass} passed, ${t.AC.fail} failed | GUARD ${t.GUARD.pass} passed, ${t.GUARD.fail} failed | INFO ${t.INFO.pass} same, ${t.INFO.fail} differ`);
  if (h.networkCalls.length) { console.log(`network calls attempted (all refused): ${h.networkCalls.length}`); }
  process.exit(t.AC.fail || t.GUARD.fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
