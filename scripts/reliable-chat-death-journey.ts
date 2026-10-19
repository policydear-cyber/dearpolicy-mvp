/**
 * Death-journey release: offline route checks (docs/rag-migration/reliable-chat/EXPECTED-death-journey.md, written first).
 *   E1-E7  broad death question completes inside the existing 80,000-token turn, every documented death benefit gets a
 *          disposition, retrieval is compact and admitted only while room for the answer remains, the gap is named
 *   E8-E10 a condition is cited from its own benefit's section; adjacent dismemberment / death wording is never borrowed
 *   E11-E13 an unrelated dismemberment schedule is neither evaluated nor attempted; both requested schedules stay complete
 * The documents are the faithful actual-library pages plus adjacent sections added as labelled controls (fixtures/death-journey).
 *   node --import tsx scripts/reliable-chat-death-journey.ts
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as DJ from "./fixtures/reliable-chat/death-journey";
import * as DJR from "./fixtures/reliable-chat/death-journey-actual-values";
import { MeteredScriptedModel } from "./fixtures/reliable-chat/metered-model";
import { deathTurn, DEATH_Q, DEATH_SEARCHES, D } from "./fixtures/reliable-chat/death-journey-conversations";
import { SBB_U1, SBB_U2, sbbTurns, j1Turn, j2Turn, J1_U, J2_U, J3_U1, J3_U2, j3Turns, J6_U, j6Turn } from "./fixtures/reliable-chat/actual-lib-conversations";
import { ScriptedLoopModel, type ScriptTurn, type ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const LIMIT = 80000;
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const visible = (a: any) => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text ?? q.question ?? ""), ...uniqueSteps(a.nextSteps)].filter(Boolean).join("\n");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "\n     " + detail.split("\n").slice(0, 24).join("\n     ")}`); };

async function withHousehold<T>(H: any, fn: (h: any, install: (m: any) => void) => Promise<T>): Promise<T> {
  setEnv(H);
  const h = await startHarness(H);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  try { return await fn(h, (m) => installLoopModel(m)); } finally { installLoopModel(null); await h.db.close(); }
}
const lastTrace = async (h: any, id: string) => (await h.savedAnswer(id)).state.ragLoop.turns.at(-1);
const used = (m: MeteredScriptedModel) => m.requests.reduce((n, r) => n + r.input, 0) + m.requests.length * 0;

async function death() {
  const VARIANTS = [
    { name: "control: Term Life S$500,000 as of 1 April 2024 (deliberately NOT the actual values)", H: DJ as any, tl: /Group Term Life of S\$500,000 as of 1 April 2024/, pa: /Group Personal Accident of S\$600,000 as of 1 April 2024/, tlAmt: /Group Term Life of S\$500,000/ },
    { name: "actual-report values: Term Life S$1,000,000, Personal Accident S$600,000, both 06/10/2022", H: DJR as any, tl: /Group Term Life of S\$1,000,000 as of (?:6 October 2022|06\/10\/2022)/, pa: /Group Personal Accident of S\$600,000 as of (?:6 October 2022|06\/10\/2022)/, tlAmt: /Group Term Life of S\$1,000,000/ },
  ];
  for (const V of VARIANTS) {
  // --- 1. the broad death question: a model that searches seven times unless it is told retrieval is closed
  await withHousehold(V.H, async (h, install) => {
    const m = new MeteredScriptedModel([deathTurn()], 1); install(m);
    const a = await h.send(DEATH_Q, {}); const v = visible(a); const tr = await lastTrace(h, a.conversationId);
    const searches = tr.toolCalls.filter((t: any) => t.name === "search_passages");
    check(`E1 broad death question ends with a final answer, not the limit text [${V.name}]`, tr.outcome === "final_answer" && !/couldn.t finish/i.test(v), `${tr.outcome}\n${v}`);
    check(`E1 inside the existing 80,000-token turn [${V.name}]`, used(m) + 120 * m.requests.length < LIMIT, String(used(m)));
    check(`E4 retrieval was refused once the room for the answer was reached, with its reason [${V.name}]`, searches.some((t: any) => !t.ok && /retrieval is closed/.test(String(t.error))) || searches.filter((t: any) => t.ok).length < DEATH_SEARCHES.length, JSON.stringify(searches.map((t: any) => [t.ok, String(t.error ?? "").slice(0, 80)])));
    check(`E6 Term Life with its certificate date [${V.name}]`, V.tl.test(v), v);
    check(`E6 Personal Accident with its certificate date [${V.name}]`, V.pa.test(v), v);
    check(`E6 Compassionate Death Allowance with the bare-$ currency uncertainty [${V.name}]`, /Compassionate Death Allowance/.test(v) && /bare “\$” sign/.test(v) && /does not say which currency/.test(v), v);
    check(`E6 the Core-or-Voluntary-Scheme condition and the proof-of-death requirement stay with the allowance [${V.name}]`, /Core Scheme or (?:the )?Voluntary Scheme/.test(v) && /proof of death/.test(v), v);
    check(`E6 next step: the certificate's own insurer [${V.name}]`, /Contact Aldermoor Life Ltd/.test(v), v);
    check(`E5/E7 the remaining gap is named specifically, with no invented procedure [${V.name}]`, /did not read a claims procedure/.test(v) && !/within \d+ days of (?:the )?death|death certificate must|notify .* within/i.test(v), v);
    const adjusted: string[] = tr.adjusted ?? [];
    check(`E2/E3 search results are compacted (new passages counted, repeats named) [${V.name}]`, adjusted.some((x) => /^search_passages: \d+ hit\(s\), \d+ new, \d+ already returned/.test(x)), JSON.stringify(adjusted));
  });
  // --- 2. a model that ignores the notice and keeps searching: the turn is finished by the server from validated information
  await withHousehold(V.H, async (h, install) => {
    const stubborn: ScriptTurn = { user: DEATH_Q, steps: [
      () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death" })],
      ...DEATH_SEARCHES.map((q) => () => [call("search_passages", { subject_id: D, query: q })]),
      () => [call("final_answer", { subject_id: D, sentences: [], next_steps: [] })],
    ] };
    const m = new MeteredScriptedModel([stubborn], 1.3); install(m);
    const a = await h.send(DEATH_Q, {}); const v = visible(a); const tr = await lastTrace(h, a.conversationId);
    check(`E5 a turn that cannot fit another call is finished from validated information (limit reached) [${V.name}]`, tr.outcome === "limit_reached" || tr.outcome === "final_answer", tr.outcome);
    check(`E5 …with every documented death benefit and the named gap, not only one figure and the limit text [${V.name}]`, V.tlAmt.test(v) && /Group Personal Accident of S\$600,000/.test(v) && /Compassionate Death Allowance/.test(v) && /did not read a claims procedure/.test(v), v);
    check(`E5 …and the next step [${V.name}]`, /Contact Aldermoor Life Ltd/.test(v), v);
    check(`E4 no model call was made that could not be followed by an answer (used within the limit) [${V.name}]`, used(m) + 120 * m.requests.length <= LIMIT, String(used(m)));
  });
  }
  // --- 3. the same search repeated returns nothing new; the third repeat is not admitted
  await withHousehold(DJ, async (h, install) => {
    const m = new MeteredScriptedModel([deathTurn(["death benefit payable", "benefit payable death", "payable benefit death", "death payable benefit", "benefit death payable"])], 0.3); install(m);
    const a = await h.send(DEATH_Q, {}); const tr = await lastTrace(h, a.conversationId); const v = visible(a);
    const s = tr.toolCalls.filter((t: any) => t.name === "search_passages");
    check("E2 an identical search adds no passage and is counted as no progress", (tr.adjusted ?? []).some((x: string) => /, 0 new, \d+ already returned/.test(x)), JSON.stringify(tr.adjusted));
    check("E2 after two searches that add nothing, another is not admitted", s.some((t: any) => !t.ok && /found nothing new/.test(String(t.error))), JSON.stringify(s.map((t: any) => [t.ok, String(t.error ?? "").slice(0, 60)])));
    check("E2 …and the answer is still complete", tr.outcome === "final_answer" && /Group Term Life/.test(v) && /Compassionate Death Allowance/.test(v), v);
  });
  // --- 4. insufficient evidence: a library with no death wording for him gives a specific gap and invents nothing
  const onlyPA = { ...DJ, DOCS: DJ.DOCS.filter((d: any) => d.key === "PA_SUMMARY") };
  await withHousehold(onlyPA, async (h, install) => {
    const m = new MeteredScriptedModel([deathTurn(DEATH_SEARCHES.slice(0, 2))], 1); install(m);
    const a = await h.send(DEATH_Q, {}); const v = visible(a);
    check("E7 insufficient evidence: no death benefit, requirement, deadline or amount is invented", !/S\$\s?\d|\$\s?\d/.test(v.replace(/Core Scheme|Voluntary Scheme/g, "")) || /Fracture|Other Fracture/.test(v) === false, v);
    check("E7 …and the gap is stated in words, not as the generic limit text", /did not read|do not|does not|not establish|no (?:death|documented)/i.test(v) && !/couldn.t finish/i.test(v), v);
  });
}

async function binding() {
  await withHousehold(DJ, async (h, install) => {
    const U = "Daniel fractured his tibia. What would his accident cover pay?";
    const hit = (v: ScriptView, re: RegExp) => { const o = [...v.turn].reverse().find((x) => x.name === "search_passages"); const hs = (o?.result?.data?.hits ?? []) as any[]; return hs.find((x) => re.test(`${x.evidence?.excerpt ?? ""} ${x.text ?? ""}`))?.evidence?.evidence_id as string | undefined; };
    const turn = (pick: RegExp): ScriptTurn => ({ user: U, steps: [
      () => [call("resolve_person", { mention: "Daniel" }), call("search_passages", { subject_id: D, query: "Simple Fracture due to Accident" })],
      (v) => [call("ask_user", { kind: "fact", fact_key: "how_it_happened", subject_id: D, question: "How did Daniel's tibia fracture happen — was it an accident?", because_evidence_ids: [hit(v, pick)] })],
    ] });
    install(new ScriptedLoopModel([turn(/Simple Fracture[^]*bodily injury|bodily injury[^]*Simple Fracture/i)]));
    let a = await h.send(U, {}); let v = visible(a);
    check("E8 the accident condition is quoted from the Simple Fracture section", /Simple Fracture/.test(v) && !/Dismemberment/i.test(v), v);
    check("E10 no window or clause of the dismemberment / death sections appears under the fracture", !/365 days|Loss of two limbs|Loss of one leg/i.test(v), v);
    install(new ScriptedLoopModel([turn(/Total and Permanent Dismemberment/i)]));
    a = await h.send(U, {}); v = visible(a); const tr = await lastTrace(h, a.conversationId);
    const asks = tr.toolCalls.filter((t: any) => t.name === "ask_user");
    check("E9 evidence printed under another benefit's section is refused as the reason for a fracture question", asks.some((t: any) => !t.ok && /different benefit's section/.test(String(t.error))) || !/Dismemberment|365 days/i.test(v), JSON.stringify(asks.map((t: any) => [t.ok, t.error])) + "\n" + v);
  });
}

async function schedules() {
  await withHousehold(DJ, async (h, install) => {
    install(new ScriptedLoopModel(sbbTurns()));
    let c: any = {}; const rows: any[] = []; const out: string[] = [];
    for (const u of [SBB_U1, SBB_U2]) { const a = await h.send(u, c); c = { id: a.conversationId, rev: a.conversationRevision }; out.push(visible(a)); const tr = await lastTrace(h, c.id); rows.push(...(tr.schedules ?? [])); }
    const dis = rows.find((r) => /Dismemberment/i.test(r.benefit));
    const evalCalls = (await lastTrace(h, c.id)).toolCalls.filter((t: any) => t.name === "evaluate_benefit");
    check("E11 the dismemberment schedule is excluded, with its reason", !!dis && dis.disposition === "excluded" && /dismemberment benefit, not the fracture/.test(dis.reason), JSON.stringify(rows));
    check("E13 zero evaluation calls for the dismemberment schedule", !evalCalls.some((t: any) => String(t.args?.benefit_id) === dis?.benefitId), JSON.stringify(evalCalls.map((t: any) => t.args)));
    check("E13 both requested fracture schedules stay complete (Simple Fracture S$2,500 and the PA summary's Other Fracture S$300,000)", /S\$2,500/.test(out[1]) && /S\$300,000/.test(out[1]), out[1]);
    check("E10 the fracture answer states no window printed under the dismemberment section", !/365 days/.test(out[1]), out[1]);
  });
  await withHousehold(DJ, async (h, install) => {
    install(new ScriptedLoopModel([j1Turn(), j2Turn()]));
    let c: any = {}; const out: string[] = [];
    for (const u of [J1_U, J2_U]) { const a = await h.send(u, c); c = { id: a.conversationId, rev: a.conversationRevision }; out.push(visible(a)); }
    check("tibia → hip: the tibia illustration first (S$2,500)", /S\$2,500/.test(out[0]), out[0]);
    check("tibia → hip: the correction shows S$3,750 and withdraws the tibia figure", /S\$3,750/.test(out[1]) && !/S\$2,500/.test(out[1]), out[1]);
  });
}

async function clarification() {
  await withHousehold(DJ, async (h, install) => {
    install(new ScriptedLoopModel(j3Turns()));
    let c: any = {}; const out: string[] = [];
    for (const u of [J3_U1, J3_U2]) { const a = await h.send(u, c); c = { id: a.conversationId, rev: a.conversationRevision }; out.push(visible(a)); }
    const asks = (out[0].match(/\?/g) ?? []).length;
    check("ambiguity: the first answer asks one question (hip or the leg) over adjacent dismemberment wording", asks >= 1 && /hip/i.test(out[0]) && /leg/i.test(out[0]) && !/365 days|Dismemberment/i.test(out[0]), out[0]);
    check("ambiguity: the clarification is calculated, not asked again", /S\$2,500/.test(out[1]) && !/\?\s*$/m.test(out[1].split("\n").filter((l) => /hip or/i.test(l)).join("\n")), out[1]);
  });
  await withHousehold(DJ, async (h, install) => {
    install(new ScriptedLoopModel([j1Turn(), j6Turn()]));
    let c: any = {}; const out: string[] = [];
    for (const u of [J1_U, J6_U]) { const a = await h.send(u, c); c = { id: a.conversationId, rev: a.conversationRevision }; out.push(visible(a)); }
    check("person switch: Grace's answer is hers, never Daniel's amount", !/Daniel/.test(out[1].replace(/Daniel/g, (m, o) => (o < 0 ? m : ""))) || /Grace/.test(out[1]), out[1]);
  });
}

(async () => { await death(); await binding(); await schedules(); await clarification(); console.log(failed ? `\n${failed} FAILED` : "\nall passed"); process.exitCode = failed ? 1 : 0; })().catch((e) => { console.error(e); process.exitCode = 1; });
