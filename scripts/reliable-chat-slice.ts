/**
 * Reliable chat, stage 2: the FIRST COMPLETE SLICE through the real chat route (harness: PGlite, the chat API, the
 * composer, the save-time gate, the output guard, the saved answer) with the migrated contracts -- person_benefits
 * benefit ids, evaluate_benefit on the server, server-written statements, atomic statement checks. Model moves are
 * SCRIPTED (plumbing evidence, not a model result). Graded per case on four dimensions: C correctness, K completeness,
 * S source support, U usefulness of the complete visible answer.
 *   HH=tan (default) | wong       node --import tsx scripts/reliable-chat-slice.ts
 */
import assert from "node:assert/strict";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as T from "./fixtures/reliable-chat/tan";
import * as W from "./fixtures/rag2-pr50/household";
import type { ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const HH = process.env.HH === "wong" ? W : T;
setEnv(HH as any);
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const visibleOf = (a: any) => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...uniqueSteps(a.nextSteps)].filter(Boolean).join("\n");
type Grade = { C: boolean; K: boolean; S: boolean; U: boolean; note?: string };
const results: { id: string; g: Grade; why: string }[] = [];
async function grade(id: string, fn: () => Promise<Grade> | Grade) {
  let g: Grade; try { g = await fn(); } catch (e) { g = { C: false, K: false, S: false, U: false, note: e instanceof Error ? e.message : String(e) }; }
  const ok = g.C && g.K && g.S && g.U;
  results.push({ id, g, why: g.note ?? "" });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  C=${+g.C} K=${+g.K} S=${+g.S} U=${+g.U}${!ok && g.note ? "\n     " + g.note.split("\n").slice(0, 16).join("\n     ") : ""}`);
}
const pb = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "person_benefits")?.result?.data ?? {};
const scheduleOf = (v: ScriptView, re: RegExp) => ((pb(v).schedules ?? []) as any[]).find((s) => re.test(s.benefit));
const optionOf = (v: ScriptView, re: RegExp) => [...v.turn].reverse().flatMap((o) => [...((o.result?.data?.options ?? []) as any[]), ...(((o.result?.data?.schedules ?? []) as any[]).flatMap((s) => s.schedule?.cases ?? []))]).find((c: any) => re.test(c.case))?.option_id as string;
const evalOf = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "evaluate_benefit")?.result?.data ?? {};
const evidOf = (s: any) => s?.evidence?.evidence_id as string;
const benefitIdOf = (v: ScriptView, re: RegExp) => ((pb(v).documents ?? []) as any[]).flatMap((d) => d.benefits).find((b: any) => re.test(b.benefit))?.benefit_id as string;

async function main() {
  const h = await startHarness(HH as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { recomputeCalculation } = await import("@/lib/claims/calc-record");
  const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
  const run = async (turns: { user: string; steps: ((v: ScriptView) => any[])[] }[]) => {
    installLoopModel(new ScriptedLoopModel(turns as any));
    const out: { v: string; returned: string; answer: any; trace: any; state: any; ms: number }[] = [];
    try {
      let c: { id?: string; rev?: number } = {};
      for (const t of turns) { const t0 = Date.now(); const a = await h.send(t.user, c); const ms = Date.now() - t0; c = { id: a.conversationId, rev: a.conversationRevision }; const s = await h.savedAnswer(c.id!); out.push({ v: visibleOf(s.answer), returned: visibleOf(a), answer: s.answer, trace: s.state.ragLoop.turns.at(-1), state: s.state, ms }); if (process.env.SHOW) console.log(`\n=== [${t.user}]\n${visibleOf(s.answer)}\n--- dropped ${JSON.stringify(s.state.ragLoop.turns.at(-1)?.dropped ?? [])}\n--- calls ${JSON.stringify((s.state.ragLoop.turns.at(-1)?.toolCalls ?? []).map((x: any) => [x.name, x.ok, (x.error ?? "").slice(0, 1500)]))}\n--- gate ${JSON.stringify(s.state.ragLoop.turns.at(-1)?.gate ?? null)}`); }
    } finally { installLoopModel(null); }
    return out;
  };
  const why = (x: any) => `${x.v}\n--- dropped: ${JSON.stringify(x.trace?.dropped ?? [])}\n--- calls: ${JSON.stringify((x.trace?.toolCalls ?? []).map((c: any) => [c.name, c.ok, (c.error ?? "").slice(0, 200)]))}`;

  if (HH === T) {
    const J = T.M.jun.id, ML = T.M.meiling.id;
    const U1 = "Jun broke his leg playing football. What could his accident policy pay?";
    const U2 = "It was the shin bone.";
    const U3 = "Sorry, I was wrong - it was his thigh bone, not the shin.";
    let sched = "";
    const turn1 = { user: U1, steps: [
      () => [call("resolve_person", { mention: "Jun" })],
      () => [call("person_benefits", { subject_id: J, topic: "fracture leg" })],
      (v: ScriptView) => { sched = scheduleOf(v, /Fracture/)?.benefit_id; return [call("note_facts", { subject_id: J, facts: [{ key: "injury", value: "broke his leg", words: "Jun broke his leg playing football" }, { key: "how_it_happened", value: "playing football", words: "Jun broke his leg playing football" }] }), call("evaluate_benefit", { benefit_id: sched, subject_id: J, purpose: "claim", case: "leg", assumption_words: "Jun broke his leg playing football" })]; },
      (v: ScriptView) => { const s = scheduleOf(v, /Fracture/) ?? { evidence: {} }; return [call("ask_user", { kind: "fact", subject_id: J, fact_key: "bone",
        statements: [{ kind: "benefit_terms", benefit_id: sched }, { kind: "fact", text: "The Fracture Benefit is for a Fracture caused by an Accident and confirmed by X-ray.", evidence_ids: [evidOf(s)], subject_id: J }],
        question: "Which leg bone was it — the thigh bone (femur), or below the knee (tibia or fibula)?", because_evidence_ids: [evidOf(s)] })]; },
    ] };
    const turn2 = { user: U2, steps: [
      () => [call("note_facts", { subject_id: J, facts: [{ key: "bone", value: "shin bone", words: "It was the shin bone." }] }), call("person_benefits", { subject_id: J, topic: "fracture" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: scheduleOf(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "claim", option_id: optionOf(v, /below the knee/), assumption_words: "Jun broke his leg playing football", fact_keys: ["bone"] })],
      (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-", subject_id: J }], next_steps: [`contact:${T.doc("SCHEDULE").id}`] })],
    ] };
    const turn3 = { user: U3, steps: [
      () => [call("note_facts", { subject_id: J, facts: [{ key: "bone", value: "thigh bone", words: "it was his thigh bone, not the shin" }] }), call("person_benefits", { subject_id: J, topic: "fracture" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: scheduleOf(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "claim", option_id: optionOf(v, /thigh/), assumption_words: "Jun broke his leg playing football", fact_keys: ["bone"] })],
      (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-", subject_id: J }] })],
    ] };
    const [v1, v2, v3] = await run([turn1, turn2, turn3]);
    await grade("V1 benefit found, terms explained, one necessary question (which leg bone), no amount yet", () => {
      const v = v1.v;
      return { C: /Fracture Benefit/.test(v) && /S\$100,000/.test(v) && !/S\$10,000|S\$20,000/.test(v), K: /20%/.test(v) && /10%/.test(v) && /X-ray/.test(v), S: (v1.answer.citations ?? []).some((c: any) => c.policyId === T.doc("WORDING").id),
        U: (v1.answer.questions ?? []).length === 1 && /thigh|below the knee/.test(v1.answer.questions[0].text), note: why(v1) };
    });
    await grade("V2 server evaluation: 10% x Jun's S$100,000 = S$10,000, conditional, source-bound, re-verifies", async () => {
      const rec = (v2.answer.calculations ?? [])[0];
      const ops = (rec?.operands ?? []).filter((o: any) => o.source === "document");
      const re = rec ? recomputeCalculation(rec) : { ok: false } as any;
      const gate = await verifyAnswerFigures(JSON.parse(JSON.stringify(v2.answer)), { accountId: T.ACCOUNT, userText: U2 });
      return { C: /S\$10,000/.test(v2.v) && !/S\$20,000/.test(v2.v) && /illustration/i.test(v2.v), K: /below the knee/.test(v2.v) && /10%/.test(v2.v) && /S\$100,000/.test(v2.v) && /Aurora Assurance/.test(v2.v),
        S: re.ok && re.resultMinor === 1_000_000 && ops.some((o: any) => o.value === 10 && o.binding?.policyId === T.doc("WORDING").id) && ops.some((o: any) => o.value === 100000 && o.binding?.policyId === T.doc("SCHEDULE").id) && gate.length === 0,
        U: !/couldn['’]t|left out/i.test(v2.v), note: why(v2) + "\n" + JSON.stringify(gate) + "\nderived " + JSON.stringify(v2.state.ragLoop.claim?.derived) };
    });
    await grade("V3 correction: re-evaluated to 20% x S$100,000 = S$20,000; the S$10,000 is withdrawn and not shown as current", async () => {
      const re = (v3.answer.calculations ?? [])[0] ? recomputeCalculation(v3.answer.calculations[0]) : { ok: false } as any;
      const calcs = Object.values(v3.state.ragLoop.claim?.calcs ?? {}) as any[];
      return { C: /S\$20,000/.test(v3.v) && !/is S\$10,000/.test(v3.v), K: /thigh/.test(v3.v), S: re.ok && re.resultMinor === 2_000_000,
        U: calcs.some((c) => c.withdrawn) && /no longer applies/i.test(v3.v), note: why(v3) + "\nclaim calcs: " + JSON.stringify(calcs.map((c) => [c.amount ?? c.sentence, c.withdrawn])) };
    });
    // G1 person switch, G3 missing input, G4 isolation / lifecycle
    const [g1] = await run([{ user: "And what would Mei Ling's be for a broken wrist?", steps: [
      () => [call("resolve_person", { mention: "Mei Ling" })],
      () => [call("person_benefits", { subject_id: ML, topic: "fracture wrist" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: scheduleOf(v, /Fracture/)?.benefit_id, subject_id: ML, purpose: "what_if", case: "wrist" })],
      (v: ScriptView) => [call("final_answer", { subject_id: ML, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-", subject_id: ML }] })],
    ] }]);
    await grade("G1 person switch: 5% x Mei Ling's S$200,000 = S$10,000; Jun's figures not reused", () => ({ C: /S\$10,000/.test(g1.v) && /S\$200,000/.test(g1.v) && !/S\$100,000/.test(g1.v), K: /Wrist/.test(g1.v), S: (g1.answer.calculations ?? []).length === 1, U: !/couldn['’]t/i.test(g1.v), note: why(g1) }));
    const [g4] = await run([{ user: "What would Jun get for a broken leg below the knee?", steps: [
      () => [call("person_benefits", { subject_id: J, topic: "fracture" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: scheduleOf(v, /Fracture/)?.benefit_id, subject_id: T.M.otherJun.id, purpose: "what_if", case: "below the knee" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: scheduleOf(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "what_if", case: "below the knee" })],
      (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-", subject_id: J }] })],
    ] }]);
    await grade("G4 isolation / lifecycle: an unknown id and another household's person are refused; the superseded 15% and the other household's S$300,000 never appear", () => {
      const calls = (g4.trace.toolCalls ?? []).filter((c: any) => c.name === "evaluate_benefit");
      const scheds = ([] as any[]);
      return { C: /S\$10,000/.test(g4.v) && !/15%|S\$15,000|S\$300,000|S\$45,000/.test(g4.v), K: true, S: calls.length === 2 && calls[0].ok === false && calls[1].ok === true, U: !/couldn['’]t/i.test(g4.v), note: why(g4) + JSON.stringify(scheds) };
    });
  } else {
    // H1 (Wong): the fixed S$5,000 limit; the two recorded malformed call shapes
    const A = W.M.adrian.id, SUM = W.doc("SUMMARY").id;
    const D = "Hypothetical document-arithmetic test for Adrian: in the uploaded Summary of Benefits, Simple Fracture has a S$5,000 limit and a Leg row of 50%. If that provision applies, what is the illustration? Distinguish this from the separate Other Fracture provision and do not promise a payment.";
    const malformed = (shape: (v: ScriptView) => Record<string, unknown>) => ({ user: D, steps: [
      () => [call("person_benefits", { subject_id: A, topic: "simple fracture leg" })],
      (v: ScriptView) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: SUM, benefit: "Simple Fracture", condition: "Leg", assumption_words: "If that provision applies", ...shape(v) })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: scheduleOf(v, /Simple Fracture/)?.benefit_id, subject_id: A, purpose: "what_if", case: "Leg", assumption_words: "If that provision applies" })],
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-", subject_id: A }, { kind: "benefit_terms", benefit_id: scheduleOf(v, /Other Fracture/)?.benefit_id, text: "-" }] })],
    ] });
    const [v5] = await run([malformed((v) => ({ base_value_id: ((pb(v).documents ?? []) as any[]).flatMap((d) => d.benefits).find((b: any) => /Term Life/.test(b.benefit))?.value_id, percent_value_id: ((pb(v).documents ?? []) as any[]).flatMap((d) => d.benefits).find((b: any) => /^Group Personal Accident$/.test(b.benefit))?.value_id }))]);
    const [v6] = await run([malformed(() => ({ proportion: { page: 13, quote: "Jaw, Pelvis, Leg^, Ankle or Knee\t50%", percent: 50, applies_when: "Leg" } }))]);
    for (const [id, x] of [["V5 recorded malformed call 1 (Term Life money as base, PA money as percentage)", v5], ["V6 recorded malformed call 2 (the leg row as proportion)", v6]] as const) {
      await grade(`${id}: refused toward evaluate_benefit with the benefit ids, then S$2,500 = 50% x the fixed S$5,000 limit`, () => {
        const c0 = (x.trace.toolCalls ?? []).find((c: any) => c.name === "calculate");
        const rec = (x.answer.calculations ?? [])[0];
        const re = rec ? recomputeCalculation(rec) : { ok: false } as any;
        return { C: /S\$2,500/.test(x.v) && !/S\$1,000,000|S\$600,000 x|300,000/.test(x.v), K: /Other Fracture/.test(x.v) && /Sum Insured|sum insured/.test(x.v),
          S: c0?.ok === false && /evaluate_benefit/.test(c0.error ?? "") && /Simple Fracture/.test(c0.error ?? "") && re.ok && re.resultMinor === 250000 && (rec.operands ?? []).every((o: any) => o.value !== 1000000),
          U: !/sum insured.*pass|couldn['’]t confirm/i.test(x.v), note: why(x) };
      });
    }
  }
  const failed = results.filter((r) => !(r.g.C && r.g.K && r.g.S && r.g.U));
  console.log(`\nreliable-chat slice [${HH === T ? "tan" : "wong"}] ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
