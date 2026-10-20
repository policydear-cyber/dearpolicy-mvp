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
 *   M4  Critic M4: a saved "not described" answer is withdrawn when a document is added to its scope
 *   Q3  Policy QC Q3: a person correction where the two people's sums insured differ recalculates from the new person's own row
 *
 *   node --import tsx scripts/pr57-acceptance-test.ts                 (--show prints every answer; an argument, not an environment variable)
 *   node --import tsx scripts/pr57-acceptance-test.ts --only=R,H1      (named groups only)
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
    check("GUARD", "R6 (K2) no amount is given for the accident hospital benefit, nothing promises payment, no question is asked", !/S\$\s?250|\$\s?250/.test(k2) && !/will (?:be )?pa(?:y|id)/i.test(k2) && !(out.K2[0].answer.questions ?? []).length, k2);
    const k6a = out.K6a[0].v;
    const amountSentence = sentences(k6a).find((s) => /S\$350,000/.test(s)) ?? "";
    check("AC", "R7 (K6a) the S$350,000 sentence itself carries the limitation that the documents do not show what Living Care pays for cancer", /cancer/i.test(amountSentence) && /(?:do(?:es)? not|doesn.t) (?:state|show|say|describe|establish)/i.test(amountSentence), amountSentence);
    check("GUARD", "R8 (K6a, K6c) S$350,000 is dated and never presented as what will be paid", [k6a, out.K6c[0].v].every((x) => /S\$350,000/.test(x) && /6 October 2022/.test(x) && !/will (?:pay|receive)[^.]*S\$350,000/i.test(x)), k6a + "\n--\n" + out.K6c[0].v);
    const k6c = out.K6c[0].v;
    check("AC", "R9 (K6c) no definition is implied where none was shown ('meets the policy definition')", !/(?:meets?|satisf\w*|under|within|fall\w* within) (?:the|its|a|her) (?:policy(?:.s)? )?definition/i.test(k6c), k6c);
    check("GUARD", "R10 (K6b) the dental absence answer cites no passage", (out.K6b[0].answer.citations ?? []).length === 0 && /dental/i.test(out.K6b[0].v), JSON.stringify(out.K6b[0].answer.citations ?? []).slice(0, 400));
    check("GUARD", "R11 every replayed turn: returned = saved = reopened", Object.values(out).flat().every(same), Object.values(out).flat().filter((o) => !same(o)).map((o) => `${o.shown}\n--\n${o.reopened}`).join("\n====\n"));
  }

  // ================================================================================================ H1: "too" with a correction-like cue
  if (only("H1")) {
    const too = (msg: string) => play([fractureTurn(G, "broke her arm", "fell down", QG), { steps: [
      () => [call("resolve_person", { mention: "Daniel" })],
      () => [call("note_facts", { facts: [{ key: "injury", value: "broke his arm", words: "broke his arm" }], subject_id: DAN })],
      () => [call("final_answer", { subject_id: G, sentences: [{ kind: "suggestion", text: "You can ask me to go on with the question about Grace." }] })],
    ] }], async () => { const a1 = await turn("H1 turn 1", "grace fell down and broke her arm"); const a2 = await turn(`H1 ${msg}`, msg, a1.conv); return { a2, s2: await stateOf(a2) }; });
    const msgs = ["Daniel broke his arm too. It was not serious.", "Daniel broke his arm too. I mean, he fell off his bike.", "Daniel broke his arm too, he slipped rather than fell."];
    for (const [i, msg] of msgs.entries()) {
      const r = await too(msg);
      const gc = claimOf(r.s2, G);
      check("AC", `H1.${i + 1} "${msg}" is another person's scenario, not a correction: Grace keeps 'broke her arm' and 'fell down', her two illustrations stay live, her question stays open, no correction notice`, gc?.facts?.injury?.value === "broke her arm" && gc.facts.how_it_happened?.value === "fell down" && live(gc).length === 2 && r.s2.pending?.subjectId === G && !/Updated: this is about/.test(r.a2.v), JSON.stringify({ grace: gc?.facts, live: live(gc).length, pending: r.s2.pending?.subjectId, v: r.a2.v }));
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
    const toe = (words: string) => play([{ steps: [
      () => [call("resolve_person", { mention: "grace" })],
      () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: words, words }], subject_id: G }), call("person_benefits", { topic: "fracture after a fall", subject_id: G })],
      (v) => [call("evaluate_benefit", { case: "Leg, Ankle or Knee", purpose: "claim", fact_keys: ["injury"], benefit_id: benefitIdOf(v, /^Simple Fracture$/i), subject_id: G, assumption_words: words })],
      (v) => [call("final_answer", { subject_id: G, sentences: resultIds(v).map((r) => ({ kind: "calculation", text: "-", result_id: r, subject_id: G })) })],
    ] }], () => turn(`M1 ${words}`, `grace fell down and ${words}`));
    const t = await toe("broke her toe");
    const line = t.v.split("\n").find((x) => /S\$2,500/.test(x)) ?? "";
    check("AC", "M1.1 'broke her toe' mapped by the model to the 'Leg, Ankle or Knee^' row: no S$2,500 is given beside that row's own 'toe and foot are not covered' footnote", !(/S\$2,500/.test(line) && NOTE_TOE.test(line)), t.v);
    const l = await toe("broke her ankle");
    check("GUARD", "M1.2 (control) 'broke her ankle' on the same row still gets S$2,500 (the footnote names toe and foot, not ankle)", /S\$2,500/.test(l.v), l.v);
  }

  // ================================================================================================ M2-M4: absence scope
  const BSUM = FX.doc("BENEFIT_SUMMARY").id;
  const dentalAbsence = (terms: string[]) => play([{ steps: [
    () => [call("resolve_person", { mention: "Grace" })],
    () => [call("person_benefits", { subject_id: G, topic: "dental treatment" })],
    () => [call("final_answer", { subject_id: G, sentences: [{ kind: "not_found", text: "-", claim: "benefit_not_found", topic: "dental treatment", terms }], next_steps: ["contact:" + CERT] })],
    () => [call("final_answer", { subject_id: G, sentences: [{ kind: "uncertainty", text: "I could not confirm this from the documents." }] })],
  ] }], () => turn(`absence ${terms.join(",")}`, "Does Grace's cover pay for dental treatment?"));
  const ABSENT = /do not describe a benefit for dental/;
  if (only("M2") || only("M3") || only("M4")) {
    const base = await dentalAbsence(["dental", "dentist", "tooth"]);
    check("GUARD", "M0 (setup) the dental absence is said over the three documents as stored", ABSENT.test(base.v), base.v);
  }
  if (only("M2")) {
    const p = (await h.db.query("SELECT page_number, text FROM policy_pages WHERE policy_id=$1 ORDER BY page_number LIMIT 1", [BSUM])).rows[0] as { page_number: number; text: string };
    await h.db.query("UPDATE policy_pages SET text='' WHERE policy_id=$1 AND page_number=$2", [BSUM, p.page_number]);
    let m2: Out;
    try { m2 = await dentalAbsence(["dental", "dentist", "tooth"]); } finally { await h.db.query("UPDATE policy_pages SET text=$3 WHERE policy_id=$1 AND page_number=$2", [BSUM, p.page_number, p.text]); }
    check("AC", `M2 with one stored page of a scoped document empty (Benefit Summary page ${p.page_number}), 'do not describe a benefit for dental' is not said over pages that were never read`, !ABSENT.test(m2.v), m2.v);
  }
  if (only("M3")) {
    const p9 = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=9", [BSUM])).rows[0] as { text: string };
    const prod = (await h.db.query("SELECT product_name FROM policies WHERE id=$1", [BSUM])).rows[0] as { product_name: string };
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=9", [BSUM, p9.text + "\nDental Benefit: up to S$500 per policy year for dental treatment by a registered dental surgeon."]);
    let ctrl: Out, m3: Out;
    try {
      ctrl = await dentalAbsence(["dentist"]);
      await h.db.query("UPDATE policies SET product_name=$2 WHERE id=$1", [BSUM, "Scheme X Dental Plan"]);
      m3 = await dentalAbsence(["dentist"]);
    } finally {
      await h.db.query("UPDATE policies SET product_name=$2 WHERE id=$1", [BSUM, prod.product_name]);
      await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=9", [BSUM, p9.text]);
    }
    check("GUARD", "M3.1 (control) a page that prints a dental benefit refuses the absence (terms ['dentist'], topic 'dental treatment')", !ABSENT.test(ctrl.v), ctrl.v);
    check("AC", "M3.2 the same page refuses it when the document's product name contains 'Dental' (the topic word is still searched)", !ABSENT.test(m3.v), m3.v);
  }
  if (only("M4")) {
    const m4 = await dentalAbsence(["dental", "dentist", "tooth"]);
    const NEW = "7d000000-0000-4000-8000-000000000199";
    await h.db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date,document_date)
      VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,'ready',$10,$10,'scan_clean','active',NULL,$11,NULL,NULL,NULL)`, [NEW, FX.ACCOUNT, G, "Example Dental Insurer", "Smile Plan", "D-1", "Dental insurance", "policy_wording", false, "Smile Plan.pdf", "sha256:pr57-new-dental"]);
    await h.db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,NULL)", [NEW, G, FX.ACCOUNT]);
    await h.db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [FX.ACCOUNT, NEW, "Dental Benefit: up to S$500 per policy year for dental treatment."]);
    let after: string;
    try { after = visible((await reopen(m4.conv.id)).at(-1)); } finally { await h.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [NEW]); }
    check("AC", "M4 after a document for Grace that prints a dental benefit is added, the reopened answer no longer says her documents do not describe one", !ABSENT.test(after), after);
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

  const t = tally;
  console.log(`\nAC ${t.AC.pass} passed, ${t.AC.fail} failed | GUARD ${t.GUARD.pass} passed, ${t.GUARD.fail} failed | INFO ${t.INFO.pass} same, ${t.INFO.fail} differ`);
  if (h.networkCalls.length) { console.log(`network calls attempted (all refused): ${h.networkCalls.length}`); }
  process.exit(t.AC.fail || t.GUARD.fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
