/**
 * Stress-test structures (node --import tsx scripts/rag2-stress-regressions.ts; npm run rag2:stress-test).
 *
 * Eight conversations on the anonymised household of scripts/fixtures/rag2-stress/household.ts, played by a scripted
 * stand-in for the model through the REAL chat route, graded on the complete visible answer and the saved state
 * against expectations written from the rendered fixture pages (docs/rag-migration/v13/EXPECTED.md), plus controls
 * with nearby misleading alternatives. The scripted moves follow what a capable model does with the tools; they are
 * PLUMBING / CONTROL evidence, not model results.
 *   STRESS_TRANSCRIPT=1 prints every conversation.
 */
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness, type Harness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-stress/household";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

const { M, doc } = HH;
const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
const I = M.ivan.id, L = M.lena.id;

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 14).join("\n     ")); }
}
export const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => "[Q] " + q.text + ((q as { options?: string[] }).options?.length ? ` [options: ${(q as { options?: string[] }).options!.join(" | ")}]` : "")), ...(a.nextSteps ?? []).map((n) => "[next] " + n)].join("\n");
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const S = (text: string, o: Record<string, unknown> = {}) => ({ text, ...o });
const ids = (...xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const sel = (key: string, benefit: string, who: string, want = "amount") => call("select_table_value", { policy_id: doc(key).id, benefit, subject_id: who, want });
const vid = (v: ScriptView, key: string, benefit: RegExp, who: string) => { const o = v.find("select_table_value", (o) => o.args.policy_id === doc(key).id && benefit.test(String(o.args.benefit)) && o.args.subject_id === who); return o?.ok && o.result.data.valueId ? (o.result.data.valueId as string) : null; };
const hit = (v: ScriptView, text: RegExp, key?: string) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => text.test(`${x.text ?? ""} ${x.evidence?.excerpt ?? ""}`) && (!key || x.policyId === doc(key).id)); if (h) return h.evidence.evidence_id as string; } return null; };
const pfEv = (v: ScriptView, who: string, key: string) => { const o = v.find("policies_for", (o) => o.args.subject_id === who); const c = ((o?.result?.data?.covering ?? []) as any[]).find((x) => x.policyId === doc(key).id); return ((c?.evidence ?? []) as any[]).map((e) => e.evidence_id as string); };
const search = (query: string, who = I) => call("search_passages", { query, subject_id: who });
const docKey = (id: string) => HH.DOCS.find((d) => d.id === id)?.key ?? null;
const lit = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (/\d$/.test(s) ? "(?![\\d,]*\\d)" : ""), "i");

type Turn = { user: string; steps: ((v: ScriptView) => ScriptCall[])[] };
type Expect = { must?: (string | RegExp)[]; never?: (string | RegExp)[]; calc?: { calculator: string; value: number | null }; noCalc?: boolean; question?: RegExp | null; cites?: string[]; facts?: Record<string, RegExp>; factHistory?: Record<string, number> };
type Conv = { id: string; title: string; turns: Turn[]; expect: Expect[] };

// ---------------------------------------------------------------- the conversations (moves of a capable model)
const SAFETY_NEVER: RegExp[] = [/\b[evr]\d+\b/, /\byou will (?:get|receive)\b|\bwill be paid\b|\bapproved\b(?! payment)/i, /S\$700,000|S\$900,000/, /S\$0\b/];

const C1: Conv = { id: "C1", title: "household inventory", turns: [
  { user: "What policies does my family have?", steps: [
    () => [call("household_documents", {})],
    (v) => { const r = v.find("household_documents"); return [call("final_answer", { sentences: [S("Here are the documents on file for your household.")] })]; void r; },
  ] },
], expect: [{ must: [/Ivan/, /Arbor Civil Service Group Scheme - Certificate/, /Lena/, /SecureLife Term Plan/, /Harbourline Life/, /Policy Wording/, /reference/i, /Annual Travel Plan/, /not linked|isn['’]t linked|no one|nobody/i, /lena-hospital-plan\.pdf/, /password/i, /IMG_2231\.jpg/, /Noah/], never: [/S\$\d/, /\(2025\)/, /ACS-779999|Tan, Ivan/, ...SAFETY_NEVER], noCalc: true, question: null }] };

const C1b: Conv = { id: "C1b", title: "household inventory, the model lists policies per person and adds figures", turns: [
  { user: "What policies does my family have?", steps: [
    () => [call("policies_for", { subject_id: I }), call("policies_for", { subject_id: L }), call("policies_for", { subject_id: M.noah.id })],
    (v) => [call("final_answer", { sentences: [
      S("Ivan is insured under the Arbor Civil Service Group Scheme certificate from Arbor Assurance, with Term Life of S$400,000 and Personal Accident of S$250,000 as of 1 April 2026.", { evidence_ids: pfEv(v, I, "ROSTER"), subject_id: I }),
      S("Lena is also on the Arbor Civil Service Group Scheme certificate, and has her own Harbourline Life SecureLife Term Plan.", { evidence_ids: [...pfEv(v, L, "ROSTER"), ...pfEv(v, L, "LENA_TERM")], subject_id: L }),
      S("Noah has no policy documents on file."),
    ] })],
  ] },
], expect: [{ must: [/Ivan/, /Arbor Civil Service Group Scheme/, /Lena/, /SecureLife Term Plan/], never: [/S\$250,000/, ...SAFETY_NEVER] }] };

const C2: Conv = { id: "C2", title: "direct Personal Accident amount", turns: [
  { user: "How much is my personal accident cover?", steps: [
    () => [call("resolve_person", { mention: "me" })],
    () => [search("Group Personal Accident sum assured certificate"), call("policies_for", { subject_id: I })],
    (v) => [call("final_answer", { subject_id: I, sentences: [
      S("Your Personal Accident cover on the Arbor Civil Service Group Scheme certificate is S$200,000 as of 1 April 2026.", { evidence_ids: ids(hit(v, /GROUP PERSONAL ACCIDENT/, "ROSTER")), benefit: "Personal Accident cover", subject_id: I }),
    ] })],
  ] },
], expect: [{ must: [/S\$200,000/, /1 April 2026|01\/04\/2026/], never: [/S\$400,000/, ...SAFETY_NEVER], cites: ["ROSTER:1"] }] };

const C3: Conv = { id: "C3", title: "correction from one person to another", turns: [
  { user: "What is Lena's life cover?", steps: [
    () => [call("resolve_person", { mention: "Lena" })],
    () => [sel("LENA_TERM", "Basic sum assured (death or terminal illness)", L), sel("ROSTER", "Group Term Life", L)],
    (v) => [call("final_answer", { subject_id: L, sentences: [
      S("Lena's SecureLife Term Plan lists a basic sum assured of S$250,000; the Arbor certificate lists her Term Life cover at S$150,000 as of 1 April 2026.", { value_ids: ids(vid(v, "LENA_TERM", /Basic/, L), vid(v, "ROSTER", /Term Life/, L)), subject_id: L }),
    ] })],
  ] },
  { user: "Sorry, I meant Ivan, not Lena.", steps: [
    () => [call("resolve_person", { mention: "Ivan" })],
    () => [sel("ROSTER", "Group Term Life", I)],
    (v) => [call("final_answer", { subject_id: I, sentences: [S("Ivan's Group Term Life cover on the Arbor certificate is S$400,000 as of 1 April 2026.", { value_ids: ids(vid(v, "ROSTER", /Term Life/, I)), subject_id: I })] })],
  ] },
], expect: [
  { must: [/S\$250,000/, /S\$150,000/], never: [/S\$400,000/, ...SAFETY_NEVER] },
  { must: [/Ivan/, /S\$400,000/], never: [/S\$150,000|S\$250,000/, ...SAFETY_NEVER] },
] };

const C4: Conv = { id: "C4", title: "the household gives a wrong amount and gets the documented one", turns: [
  { user: "My personal accident cover is S$400,000, right?", steps: [
    () => [call("resolve_person", { mention: "my" })],
    () => [search("Group Personal Accident Group Term Life sum assured certificate")],
    (v) => [call("final_answer", { subject_id: I, sentences: [
      S("Not quite: the Arbor certificate lists your Personal Accident sum assured as S$200,000 as of 1 April 2026; the S$400,000 is your Term Life sum assured.", { evidence_ids: ids(hit(v, /GROUP PERSONAL ACCIDENT/, "ROSTER"), hit(v, /GROUP TERM LIFE/, "ROSTER")), subject_id: I }),
    ] })],
  ] },
], expect: [{ must: [/S\$200,000/, /Personal Accident/, /S\$400,000[^.]*Term Life|Term Life[^.]*S\$400,000/], never: [/Personal Accident[^.;]*S\$400,000 (?:is|as)/i, ...SAFETY_NEVER] }] };

const FRACTURE_WORDS = "I fractured my leg, the tibia, when I fell down the stairs. It's a simple fracture and the X-ray confirmed it. How much can I claim?";
const C5: Conv = { id: "C5", title: "Simple Fracture percentage of its fixed benefit limit (not of the Sum Insured), Other Fracture not used", turns: [
  { user: FRACTURE_WORDS, steps: [
    () => [call("resolve_person", { mention: "I" })],
    () => [call("note_facts", { subject_id: I, facts: [{ key: "how_it_happened", value: "fell down the stairs", words: "I fell down the stairs" }, { key: "bone_fractured", value: "tibia", words: "I fractured my leg, the tibia" }, { key: "fracture_type", value: "simple", words: "It's a simple fracture" }, { key: "xray_confirmed", value: "yes", words: "the X-ray confirmed it" }] }),
      search("simple fracture leg tibia percentage benefit limit"), search("other fracture compound sum insured"), sel("GPA_WORD", "Leg (tibia or fibula)", I, "percent"), sel("ROSTER", "Group Personal Accident", I)],
    (v) => [call("calculate", { calculator: "lump_sum", purpose: "claim", subject_id: I, policy_id: doc("GPA_WORD").id, benefit: "Simple Fracture - Leg (tibia or fibula)", condition: "a simple fracture of the leg (tibia) confirmed by X-ray", assumption_words: "I fractured my leg, the tibia", percent_value_id: vid(v, "GPA_WORD", /Leg/, I), sum_insured_value_id: vid(v, "ROSTER", /Personal Accident/, I) })],
    (v) => { const c = v.find("calculate"); return [call("final_answer", { subject_id: I, sentences: [
      ...(c?.ok && c.result.data.amount != null ? [S(`If the Simple Fracture benefit applies to your simple tibia fracture, the indicative illustration is S$${Number(c.result.data.amount).toLocaleString("en-SG")}; it is not an approved payment.`, { result_id: c.result.data.calc_id, subject_id: I })] : []),
      S("The Other Fracture provision is for a compound fracture or a bone not listed under Simple Fracture.", { evidence_ids: ids(hit(v, /Other Fracture/, "GPA_WORD")), subject_id: I }),
    ] })]; },
  ] },
], expect: [{ must: [/S\$2,500/, /\bif\b/i, /Simple Fracture/], never: [/S\$100,000|S\$10,000|S\$5,000 (?:is|will)/, ...SAFETY_NEVER], calc: { calculator: "lump_sum", value: 2500 } }] };

const C6: Conv = { id: "C6", title: "an invalid date, then a valid correction (and the same time given again with its zone is not a correction)", turns: [
  { user: "I was in hospital after a fall. I was admitted on 31 September 2026 at 9am and discharged on 2 October 2026 at 9am.", steps: [
    () => [call("resolve_person", { mention: "I" })],
    () => [call("note_facts", { subject_id: I, facts: [{ key: "how_it_happened", value: "a fall", words: "after a fall" }, { key: "admission_datetime", value: "2026-09-31T09:00", words: "admitted on 31 September 2026 at 9am" }, { key: "discharge_datetime", value: "2026-10-02T09:00", words: "discharged on 2 October 2026 at 9am" }] }), search("Daily Hospital Income confinement day")],
    (v) => [call("ask_user", { kind: "fact", subject_id: I, fact_key: "admission_datetime", question: "31 September isn't a calendar date, so on what date were you admitted?", because_evidence_ids: ids(hit(v, /Daily Hospital Income/, "GPA_WORD")) })],
  ] },
  { user: "Sorry, I meant 30 September 2026 at 9am.", steps: [
    () => [call("note_facts", { subject_id: I, facts: [{ key: "admission_datetime", value: "2026-09-30T09:00+08:00", words: "I meant 30 September 2026 at 9am" }, { key: "discharge_datetime", value: "2026-10-02T09:00+08:00", words: "discharged on 2 October 2026 at 9am" }] }), search("Daily Hospital Income confinement day")],
    (v) => [call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: I, policy_id: doc("GPA_WORD").id, benefit: "Daily Hospital Income", rate_evidence_id: hit(v, /Daily Hospital Income/, "GPA_WORD"), admission: { at: "2026-09-30T09:00+08:00", words: "I meant 30 September 2026 at 9am" }, discharge: { at: "2026-10-02T09:00+08:00", words: "discharged on 2 October 2026 at 9am" } })],
    (v) => { const c = v.find("calculate"); return [call("final_answer", { subject_id: I, sentences: [S("Daily Hospital Income is payable from the 11th day of continuous confinement, so your stay from 30 September to 2 October does not reach it.", { evidence_ids: ids(hit(v, /Daily Hospital Income/, "GPA_WORD")), ...(c?.ok ? { result_id: c.result.data.calc_id } : {}), subject_id: I })] })]; },
  ] },
], expect: [
  { must: [/31 September/], never: [/S\$150 (?:for|is payable)[^.]*31 September/, ...SAFETY_NEVER], noCalc: true, question: /admitted|admission/i, facts: {} },
  { must: [/11th day/, /does not reach|doesn['’]t reach|not reach/], never: [/S\$0\b|S\$300|S\$450/, ...SAFETY_NEVER], noCalc: true, facts: { admission_datetime: /^2026-09-30T09:00/, discharge_datetime: /^2026-10-02T09:00/ }, factHistory: { discharge_datetime: 0 } },
] };

const C7: Conv = { id: "C7", title: "waiting period: a 48-hour stay and a benefit from the 11th day, with the rate not bound", turns: [
  { user: "I was hospitalised for 48 hours after a road accident: admitted 5 October 2026 at 10am, discharged 7 October 2026 at 10am. What does the Daily Hospital Income pay?", steps: [
    () => [call("resolve_person", { mention: "I" })],
    () => [call("note_facts", { subject_id: I, facts: [{ key: "how_it_happened", value: "road accident", words: "after a road accident" }, { key: "admission_datetime", value: "2026-10-05T10:00+08:00", words: "admitted 5 October 2026 at 10am" }, { key: "discharge_datetime", value: "2026-10-07T10:00+08:00", words: "discharged 7 October 2026 at 10am" }] }), search("Daily Hospital Income from the 11th day")],
    (v) => [call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: I, policy_id: doc("GPA_WORD").id, benefit: "Daily Hospital Income", rate_passage: { page: 2, quote: "Daily Hospital Income is S$150 a day from day 11", amount: 150, currency: "SGD" }, admission: { at: "2026-10-05T10:00+08:00", words: "admitted 5 October 2026 at 10am" }, discharge: { at: "2026-10-07T10:00+08:00", words: "discharged 7 October 2026 at 10am" } })],
    (v) => { const c = [...v.turn].reverse().find((o) => o.name === "calculate"); return [call("final_answer", { subject_id: I, sentences: [
      S("The Daily Hospital Income benefit is payable from the 11th day of continuous confinement.", { evidence_ids: ids(hit(v, /Daily Hospital Income/, "GPA_WORD")), subject_id: I }),
      ...(c?.ok ? [S("Your 48-hour stay does not reach the 11th day, so this benefit does not pay for it.", { result_id: c.result.data.calc_id, subject_id: I })] : [S("Your 48-hour stay does not reach the 11th day, so this benefit does not pay for it.", { evidence_ids: ids(hit(v, /Daily Hospital Income/, "GPA_WORD")), subject_id: I })]),
    ] })]; },
  ] },
], expect: [{ must: [/11th day/, /48[- ]hour|2 days|two days/i, /does not reach|doesn['’]t reach/i], never: [/S\$0\b|S\$300|S\$150 (?:for|×|x) ?2/, ...SAFETY_NEVER], noCalc: true }] };

const C8: Conv = { id: "C8", title: "unknown household member", turns: [
  { user: "What cover does Bob have?", steps: [
    () => [call("resolve_person", { mention: "Bob" })],
    (v) => { const r = v.find("resolve_person"); const o = (r?.result?.data?.options ?? []) as any[]; return [call("ask_user", { kind: "person", question: r?.result?.data?.question ?? "Which family member do you mean?", options: o.length ? o.map((x) => x.id) : [I, L, M.noah.id] })]; },
  ] },
], expect: [{ must: [/Bob/, /Ivan/, /Lena/, /Noah/], never: [/S\$\d/, ...SAFETY_NEVER], question: /which|who/i }] };

export const CONVS: Conv[] = [C1, C1b, C2, C3, C4, C5, C6, C7, C8];

function grade(t: Expect, a: ChatAnswer, state: any): string[] {
  const v = visible(a), f: string[] = [];
  for (const m of t.must ?? []) if (!(typeof m === "string" ? lit(m) : m).test(v)) f.push(`missing ${m}`);
  for (const n of t.never ?? []) if ((typeof n === "string" ? lit(n) : n).test(v)) f.push(`shows forbidden ${n}`);
  const calcs = ((a as any).calculations ?? []) as any[];
  if (t.calc) { const r = calcs.find((x) => x.calculator === t.calc!.calculator); if (!r) f.push(`no saved ${t.calc.calculator} record`); else if (t.calc.value != null && r.result?.value !== t.calc.value) f.push(`saved ${t.calc.calculator} is ${r.result?.value}, expected ${t.calc.value}`); }
  if (t.noCalc && calcs.some((x) => x.result?.value != null && x.kind !== "unresolved")) f.push(`a calculation amount was saved: ${JSON.stringify(calcs.map((x) => [x.calculator, x.result?.value]))}`);
  if (t.question === null && (a.questions ?? []).length) f.push(`asks a question: ${a.questions![0].text}`);
  if (t.question && !(a.questions ?? []).some((q) => t.question!.test(q.text))) f.push(`does not ask ${t.question}`);
  for (const c of t.cites ?? []) if (!(a.citations ?? []).some((x) => `${docKey(x.policyId)}:${x.pageStart}` === c)) f.push(`no citation ${c}`);
  const facts = state?.ragLoop?.claim?.facts ?? {};
  for (const [k, re] of Object.entries(t.facts ?? {})) if (!re.test(String(facts[k]?.value ?? ""))) f.push(`fact ${k} = ${facts[k]?.value ?? "(none)"}`);
  for (const [k, n] of Object.entries(t.factHistory ?? {})) if ((facts[k]?.previous?.length ?? 0) !== n) f.push(`fact ${k} has ${facts[k]?.previous?.length ?? 0} earlier values (expected ${n})`);
  if ((state?.ragLoop?.turns?.at(-1)?.gate ?? []).length) f.push(`save-time gate: ${JSON.stringify(state.ragLoop.turns.at(-1).gate).slice(0, 200)}`);
  return f;
}

async function play(h: Harness, conv: Conv) {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  installLoopModel(new ScriptedLoopModel(conv.turns.map((t) => ({ user: t.user, steps: t.steps })) as ScriptTurn[]));
  let c: { id?: string; rev?: number } = {};
  const out: { user: string; answer: ChatAnswer; state: any; failures: string[] }[] = [];
  for (const [i, t] of conv.turns.entries()) {
    const a = await h.send(t.user, c);
    c = { id: a.conversationId, rev: a.conversationRevision };
    const s = await h.savedAnswer(c.id!);
    out.push({ user: t.user, answer: s.answer, state: s.state, failures: grade(conv.expect[i], s.answer, s.state) });
  }
  installLoopModel(null);
  return out;
}

async function main() {
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const transcript: string[] = [];
  for (const conv of CONVS) {
    let turns: Awaited<ReturnType<typeof play>> = [];
    try { turns = await play(h, conv); } catch (e) { await check(`${conv.id} ${conv.title}`, () => { throw e; }); continue; }
    transcript.push(`### ${conv.id} ${conv.title}`);
    for (const t of turns) {
      const tr = t.state?.ragLoop?.turns?.at(-1);
      if (process.env.STRESS_DEBUG) console.log("DEBUG", conv.id, JSON.stringify((tr?.toolCalls ?? []).filter((x: any) => /select_table_value|final_answer/.test(x.name)).map((x: any) => [x.name, x.ok, x.args?.by ?? "", x.args?.benefit ?? "", x.summary ?? "", String(x.error ?? "").slice(0, 300)])));
      transcript.push(`USER: ${t.user}\nAPP:  ${visible(t.answer).replace(/\n/g, "\n      ")}\n      cites=${(t.answer.citations ?? []).map((x) => `${docKey(x.policyId)}:${x.pageStart}`).join(",")} calcs=${JSON.stringify(((t.answer as any).calculations ?? []).map((r: any) => [r.calculator, r.result?.value]))} dropped=${JSON.stringify((tr?.dropped ?? []).map((d: any) => d.reason.slice(0, 90)))}\n      refused=${JSON.stringify((tr?.toolCalls ?? []).filter((x: any) => !x.ok).map((x: any) => [x.name, String(x.error ?? "").slice(0, 110)]))}${t.failures.length ? "\n      FAILURES: " + t.failures.join(" | ") : ""}`);
    }
    await check(`${conv.id} ${conv.title}`, () => assert.deepEqual(turns.map((t, i) => t.failures.map((f) => `turn ${i + 1}: ${f}`)).flat(), []));
  }
  if (process.env.STRESS_TRANSCRIPT) console.log("\n" + transcript.join("\n\n"));
  // The first actual-model sample on these structures (s48-live-1), replayed without any model call: its recorded
  // tool calls, with this run's evidence / value ids.
  const { recordedTurns, replayScript, runDir } = await import("./fixtures/rag2-live-replay");
  const dir = (() => { try { return runDir("RUN-s48-live-1-"); } catch { return null; } })();
  if (dir) {
    const turns = recordedTurns(dir, "S48");
    const { installLoopModel } = await import("@/lib/rag2/loop/model");
    const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
    installLoopModel(new ScriptedLoopModel(replayScript(turns)));
    let c: { id?: string; rev?: number } = {};
    const out: { answer: ChatAnswer; state: any }[] = [];
    for (const t of turns) { const a = await h.send(t.user, c); c = { id: a.conversationId, rev: a.conversationRevision }; const s2 = await h.savedAnswer(c.id!); out.push({ answer: s2.answer, state: s2.state }); }
    installLoopModel(null);
    transcript.push("### s48-live-1 replayed (recorded model output, no model call)", ...out.map((o, i) => `USER: ${turns[i].user}\nAPP:  ${visible(o.answer).replace(/\n/g, "\n      ")}\n      calcs=${JSON.stringify(((o.answer as any).calculations ?? []).map((r: any) => [r.calculator, r.result?.value]))}`));
    if (process.env.STRESS_TRANSCRIPT) console.log("\n" + transcript.slice(-out.length - 1).join("\n\n"));
    const V = (i: number) => visible(out[i].answer);
    await check("s48-live-1 replay: inventory, PA amount and the waiting period still hold; no save-time gate rejection", () => {
      assert.match(V(0), /Ivan:[\s\S]*Lena:[\s\S]*Noah:[\s\S]*Not linked/); assert.ok(!/S\$\d/.test(V(0)));
      assert.match(V(1), /S\$200,000/); assert.match(V(4), /11th day/); assert.ok(!((out[4].answer as any).calculations ?? []).some((r: any) => r.result?.value != null));
      for (const [i, o] of out.entries()) assert.deepEqual(o.state.ragLoop.turns.at(-1).gate ?? [], [], `turn ${i + 1}`);
    });
    await check("s48-live-1 replay turn 3: the model's own correction (\"S$200,000, not S$400,000\") is shown -- the household's figure is denied, not presented as cover", () => {
      assert.match(V(2), /S\$200,000/); assert.match(V(2), /not S\$400,000/); assert.match(V(2), /^No\b|\bNo\b/);
    });
    await check("s48-live-1 replay turn 4: the leg row the model quoted as a share is read as the row's percentage of the S$5,000 Simple Fracture limit -- S$2,500, conditional, saved", () => {
      const r = ((out[3].answer as any).calculations ?? []).find((x: any) => x.calculator === "lump_sum");
      assert.ok(r, V(3)); assert.equal(r.result.value, 2500); assert.ok(r.operands.some((o: any) => o.id === "benefit_limit" && o.value === 5000));
      assert.match(V(3), /S\$2,500/); assert.ok(!/S\$100,000|S\$10,000/.test(V(3)), V(3));
    });
    await check("s48-live-1 replay turn 6 (unchanged by design): an unknown name is said to match nobody linked to the account, with no figure -- the household's member list is not offered (the same reply is used for another household's member, whose name must not prompt a choice)", () => {
      assert.match(V(5), /couldn['’]t identify “Bob”/); assert.ok(!/S\$\d/.test(V(5)));
    });
  }
  if (process.env.STRESS_TRANSCRIPT_FILE) (await import("node:fs")).writeFileSync(process.env.STRESS_TRANSCRIPT_FILE, transcript.join("\n\n") + "\n");
  await controls(h);
  const failed = results.filter((r) => !r.ok);
  console.log(`\nstress structures ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

/** Controls: nearby misleading alternatives. */
async function controls(h: Harness) {
  const { createToolContext, runTool } = await import("@/lib/rag2/tools");
  const { recomputeCalculation } = await import("@/lib/claims/calc-record");
  const { sameFactValue } = await import("@/lib/rag2/loop/facts");
  const env = { ...process.env, DEARPOLICY_RAG_TOOLS: "1" };
  const fresh = () => createToolContext({ accountId: HH.ACCOUNT, speakerId: I, lastSubjectId: I });
  const val = async (ctx: any, key: string, benefit: string, want = "amount", who = I) => { const r: any = await runTool(ctx, "select_table_value", { policy_id: doc(key).id, benefit, subject_id: who, want }, env); return r.ok && r.data.status === "ok" ? (r.data.valueId as string) : null; };
  const lump = (ctx: any, extra: Record<string, unknown>) => runTool(ctx, "calculate", { calculator: "lump_sum", purpose: "claim", subject_id: I, policy_id: doc("GPA_WORD").id, condition: "the event reported", assumption_words: "I fractured my leg", benefit: "Simple Fracture - Leg (tibia or fibula)", ...extra }, env) as Promise<any>;
  const recordOf = async (ctx: any, r: any) => { const { calcOutcomes } = await import("@/lib/rag2/calc/tool"); return r.ok ? calcOutcomes(ctx).get(r.data.calc_id)?.record ?? null : null; };

  await check("CONTROL percentage base: a Simple Fracture percentage is of its fixed benefit limit (S$5,000), even when the Sum Insured is passed; the record says so and re-runs", async () => {
    const ctx = fresh();
    const leg = await val(ctx, "GPA_WORD", "Leg (tibia or fibula)", "percent"), gpa = await val(ctx, "ROSTER", "Group Personal Accident");
    const a = await lump(ctx, { percent_value_id: leg, sum_insured_value_id: gpa });
    assert.ok(a.ok, a.error); assert.equal(a.data.amount, 2500);
    const rec = await recordOf(ctx, a); assert.ok(rec); assert.ok(recomputeCalculation(rec as any).ok);
    const base = rec!.operands.find((o: any) => o.id === "benefit_limit") as any; assert.ok(base, JSON.stringify(rec!.operands.map((o: any) => o.id)));
    assert.equal(base.value, 5000); assert.match(base.label, /Simple Fracture benefit limit/); assert.ok(!rec!.operands.some((o: any) => o.id === "sum_insured"));
    assert.match(JSON.stringify(a.data.notes ?? []), /not the sum insured/);
    const ctx2 = fresh(); const b2 = await lump(ctx2, { percent_value_id: await val(ctx2, "GPA_WORD", "Leg (tibia or fibula)", "percent") });
    assert.ok(b2.ok, b2.error); assert.equal(b2.data.amount, 2500);
  });
  await check("CONTROL percentage applied once: a table row quoted as a \"share\" is the row's percentage -- never applied twice (not S$1,250); another row's percentage quoted as a share is refused", async () => {
    const row = { page: 1, quote: "Leg (tibia or fibula)", percent: 50, applies_when: "a simple fracture" };
    const ctx = fresh(); const leg = await val(ctx, "GPA_WORD", "Leg (tibia or fibula)", "percent");
    const a = await lump(ctx, { percent_value_id: leg, proportion: { ...row, quote: String(doc("GPA_WORD").pages[1]).split("\n").find((l) => l.startsWith("Leg (tibia")) } });
    assert.ok(a.ok, a.error); assert.equal(a.data.amount, 2500);
    const ctx2 = fresh(); const thigh = await val(ctx2, "GPA_WORD", "Thigh (femur)", "percent");
    const b = await lump(ctx2, { percent_value_id: thigh, proportion: { ...row, quote: String(doc("GPA_WORD").pages[1]).split("\n").find((l) => l.startsWith("Leg (tibia")) } });
    assert.ok(!b.ok && /not a share/.test(b.error), JSON.stringify(b).slice(0, 300));
  });
  await check("CONTROL percentage base: a percentage of the Sum Insured (Schedule of Compensation) uses the person's own sum insured -- never the Simple Fracture limit -- and without it is not worked out", async () => {
    const ctx = fresh();
    const eye = await val(ctx, "GPA_WORD", "Total and permanent loss of sight of one eye", "percent"), gpa = await val(ctx, "ROSTER", "Group Personal Accident");
    const a = await lump(ctx, { benefit: "Total and permanent loss of sight of one eye", percent_value_id: eye, sum_insured_value_id: gpa });
    assert.ok(a.ok, a.error); assert.equal(a.data.amount, 100000);
    const rec = await recordOf(ctx, a); assert.ok(rec!.operands.some((o: any) => o.id === "sum_insured" && o.value === 200000)); assert.ok(!rec!.operands.some((o: any) => o.id === "benefit_limit"));
    const ctx2 = fresh();
    const b = await lump(ctx2, { benefit: "Total and permanent loss of sight of one eye", percent_value_id: await val(ctx2, "GPA_WORD", "Total and permanent loss of sight of one eye", "percent") });
    assert.ok(!b.ok && /sum_insured_value_id/.test(b.error), JSON.stringify(b).slice(0, 300));
  });
  await check("CONTROL percentage base: two different Simple Fracture limits in the wording -- the conflict is named, no amount; no limit printed -- not worked out", async () => {
    await h.db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,4,$3)", [HH.ACCOUNT, doc("GPA_WORD").id, "Endnote: The Simple Fracture benefit limit is S$3,000 for each Insured Person per Accident."]);
    try {
      const ctx = fresh(); const r = await lump(ctx, { percent_value_id: await val(ctx, "GPA_WORD", "Leg (tibia or fibula)", "percent") });
      assert.ok(!r.ok && /different amounts/.test(r.error) && /S\$5,000/.test(r.error) && /S\$3,000/.test(r.error), JSON.stringify(r).slice(0, 400));
    } finally { await h.db.query("DELETE FROM policy_pages WHERE policy_id=$1 AND page_number=4", [doc("GPA_WORD").id]); }
    const p1 = String(doc("GPA_WORD").pages[1]);
    await h.db.query("UPDATE policy_pages SET text=$3 WHERE account_id=$1 AND policy_id=$2 AND page_number=1", [HH.ACCOUNT, doc("GPA_WORD").id, p1.replace(/The Simple Fracture benefit limit is S\$5,000 for each Insured Person per Accident\. /, "")]);
    try {
      const ctx = fresh(); const r = await lump(ctx, { percent_value_id: await val(ctx, "GPA_WORD", "Leg (tibia or fibula)", "percent"), sum_insured_value_id: await val(ctx, "ROSTER", "Group Personal Accident") });
      assert.ok(!r.ok && /does not print an amount/.test(r.error), JSON.stringify(r).slice(0, 400));
    } finally { await h.db.query("UPDATE policy_pages SET text=$3 WHERE account_id=$1 AND policy_id=$2 AND page_number=1", [HH.ACCOUNT, doc("GPA_WORD").id, p1]); }
  });
  await check("CONTROL waiting period: a stay that can reach the 11th day is not refused by it; an invalid date decides nothing; a 48-hour stay is decided without any rate", async () => {
    const hc = (adm: string, dis: string, extra: Record<string, unknown> = {}) => runTool(fresh(), "calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: I, policy_id: doc("GPA_WORD").id, benefit: "Daily Hospital Income", admission: { at: adm, words: "admitted" }, discharge: { at: dis, words: "discharged" }, ...extra }, env) as Promise<any>;
    const long = await hc("2026-10-05T10:00+08:00", "2026-10-17T10:00+08:00", { rate_passage: { page: 2, quote: "Daily Hospital Income: S$150 for each day of confinement in a hospital as an in-patient as a direct result of an Accident", amount: 150, currency: "SGD" } });
    assert.ok(long.ok, long.error); assert.notEqual(long.data.kind, "not_payable", JSON.stringify(long.data).slice(0, 300));
    const bad = await hc("2026-09-31T10:00+08:00", "2026-10-02T10:00+08:00");
    assert.ok(!bad.ok || bad.data.kind !== "not_payable", JSON.stringify(bad).slice(0, 300));
    const short = await hc("2026-10-05T10:00+08:00", "2026-10-07T10:00+08:00");
    assert.ok(short.ok && short.data.kind === "not_payable" && short.data.amount == null && /11th day/.test(short.data.reason), JSON.stringify(short).slice(0, 400));
  });
  await check("CONTROL timestamps: the same time with a time zone added is the same fact; a different time or instant is a change", () => {
    assert.ok(sameFactValue("2026-10-02T09:00", "2026-10-02T09:00+08:00"));
    assert.ok(sameFactValue("2026-10-02T09:00+08:00", "2026-10-02T01:00Z"));
    assert.ok(!sameFactValue("2026-10-02T09:00", "2026-10-02T10:00+08:00"));
    assert.ok(!sameFactValue("2026-10-02T09:00+08:00", "2026-10-02T09:00Z"));
    assert.ok(!sameFactValue("2026-10-02", "2026-10-03"));
  });
  // Loop-level: figures bound by identity stay strict about person, product, currency, version and support.
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const sentences = (v: ScriptView) => { const ev = ids(hit(v, /GROUP PERSONAL ACCIDENT/, "ROSTER"), hit(v, /GROUP TERM LIFE/, "ROSTER")); return [
    S("Your Personal Accident cover on the Arbor certificate is S$200,000 as of 1 April 2026.", { evidence_ids: ev, subject_id: I }),
    S("Your Personal Accident cover is S$400,000.", { evidence_ids: ev, subject_id: I }),
    S("Lena's Personal Accident cover is S$200,000.", { evidence_ids: ev, subject_id: L }),
    S("Your Personal Accident cover is US$200,000.", { evidence_ids: ev, subject_id: I }),
    S("Your Personal Accident cover was S$150,000 as of 1 April 2025.", { evidence_ids: ev, subject_id: I }),
    S("Ivan is on the Arbor Civil Service Group Scheme certificate, with Personal Accident of S$999,000.", { evidence_ids: ev, subject_id: I }),
  ]; };
  installLoopModel(new ScriptedLoopModel([{ user: "cover", steps: [() => [call("resolve_person", { mention: "me" })], () => [search("Group Personal Accident Group Term Life sum assured certificate")], (v) => [call("final_answer", { subject_id: I, sentences: sentences(v) })], (v) => [call("final_answer", { subject_id: I, sentences: sentences(v) })]] }] as ScriptTurn[]));
  const a = await h.send("What is my cover?", {}); const sv = await h.savedAnswer(a.conversationId!); installLoopModel(null);
  const v = visible(sv.answer);
  await check("CONTROL identity binding stays strict: the right figure is kept; another product's figure, another person's, another currency, a superseded version and an unsupported figure are not stated; the supported document fact is kept without the unsupported figure", () => {
    assert.match(v, /S\$200,000 as of 1 April 2026/, v);
    assert.ok(!/S\$400,000|US\$|S\$150,000|S\$999,000|Lena's Personal Accident/.test(v), v);
    assert.match(v, /Ivan is on the Arbor Civil Service Group Scheme certificate\./, v);
    assert.deepEqual(sv.state.ragLoop.turns.at(-1).gate ?? [], []);
  });
  installLoopModel(new ScriptedLoopModel([
    { user: "discharged", steps: [() => [call("resolve_person", { mention: "I" })], () => [call("note_facts", { subject_id: I, facts: [{ key: "discharge_datetime", value: "2026-10-02T09:00", words: "discharged on 2 October 2026 at 9am" }] })], () => [call("final_answer", { subject_id: I, sentences: [S("You told me you were discharged on 2 October 2026 at 9am.")] })]] },
    { user: "Actually", steps: [() => [call("note_facts", { subject_id: I, facts: [{ key: "discharge_datetime", value: "2026-10-02T10:00+08:00", words: "Actually I was discharged at 10am" }] })], () => [call("final_answer", { subject_id: I, sentences: [S("You told me you were discharged at 10am.")] })]] },
  ] as ScriptTurn[]));
  const t1 = await h.send("I was discharged on 2 October 2026 at 9am.", {});
  await h.send("Actually I was discharged at 10am.", { id: t1.conversationId, rev: t1.conversationRevision });
  const st = await h.savedAnswer(t1.conversationId!); installLoopModel(null);
  await check("CONTROL a real change of time is still a correction", () => {
    const f = st.state.ragLoop.claim.facts.discharge_datetime; assert.match(String(f.value), /T10:00/); assert.equal(f.previous?.length ?? 0, 1);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
