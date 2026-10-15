/**
 * Reliable chat: the two failures of the real-model batch rc-live-1 (docs/rag-migration/reliable-chat/LIVE-RESULT-rc-live-1.md),
 * replayed with the model's EXACT recorded tool calls (benefit ids, case words, fact keys, invented ids) through the real
 * chat route. Model moves scripted from the recorded run; graded by the same pre-registered grader.
 *   RCT1a turn 2 -- "The doctor said it was the shin bone." -> evaluate_benefit case "shin bone" found no row of
 *     "Leg - below the knee (tibia or fibula)" (needs_facts, the bone asked again). Now: S$10,000.
 *   RCW1b -- evaluate_benefit case "closed fracture of his leg" (the model's paraphrase) became the illustration's stated
 *     assumption; the save-time gate refused the S$2,500 as not the household's what-if. Now: the household's recorded
 *     words are the assumption and the S$2,500 is shown.
 *   HH=tan (default) | wong      node --import tsx scripts/reliable-chat-live-regressions.ts
 */
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
const evalOf = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "evaluate_benefit" && o.ok)?.result?.data ?? {};
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "\n     " + detail.split("\n").slice(0, 20).join("\n     ")}`); };

async function main() {
  const h = await startHarness(HH as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const run = async (turns: any[]) => {
    installLoopModel(new ScriptedLoopModel(turns));
    const out: any[] = []; let c: { id?: string; rev?: number } = {};
    try { for (const t of turns) { const a = await h.send(t.user, c); c = { id: a.conversationId, rev: a.conversationRevision }; const s = await h.savedAnswer(c.id!); out.push({ v: visibleOf(s.answer), answer: s.answer, state: s.state, trace: s.state.ragLoop.turns.at(-1) }); } } finally { installLoopModel(null); }
    return out;
  };
  const { gradeRCT1, gradeRCW1 } = await import("./rag2-live/reliable-chat-check");
  if (HH === T) {
    const J = T.M.jun.id, SCHED = "bcf3fd4916c";
    const turns = [
      { user: "My son Jun fractured his leg at football training. What could his personal accident policy pay?", steps: [
        () => [call("resolve_person", { mention: "my son Jun" })],
        () => [call("note_facts", { facts: [{ key: "injury", value: "fractured his leg", words: "fractured his leg" }, { key: "how_it_happened", value: "at football training", words: "at football training" }], subject_id: J })],
        () => [call("policies_for", { topic: "personal accident", subject_id: J })],
        () => [call("person_benefits", { topic: "fracture after football training / personal accident", subject_id: J })],
        () => [call("search_passages", { k: 10, query: "Fracture Benefit conditions proof fracture X-ray registered medical practitioner accident definition exclusions football training", policy_ids: [T.doc("WORDING").id], subject_id: J })],
        () => [call("evaluate_benefit", { case: "fractured his leg", purpose: "claim", fact_keys: ["injury"], benefit_id: SCHED, subject_id: J })],
        (v: ScriptView) => { const ev = ([...v.turn].reverse().find((o) => o.name === "evaluate_benefit")?.result?.data?.evidence_ids ?? []) as string[]; const pbv = v.find("person_benefits")?.result?.data; const sev = ((pbv?.schedules ?? []) as any[]).find((x) => x.benefit_id === SCHED)?.evidence?.evidence_id; const because = [...new Set([sev, ...ev].filter(Boolean))];
          return [call("ask_user", { kind: "fact", fact_key: "fracture_bone", question: "Which bone was fractured: Jun’s thigh bone (femur), or a bone below the knee (tibia or fibula)?", statements: [{ kind: "benefit_terms", benefit_id: SCHED, subject_id: J }], subject_id: J, because_evidence_ids: because })]; },
      ] },
      { user: "The doctor said it was the shin bone.", steps: [
        () => [call("note_facts", { facts: [{ key: "fracture_bone", value: "shin bone", words: "The doctor said it was the shin bone." }], subject_id: J })],
        () => [call("evaluate_benefit", { case: "shin bone", purpose: "claim", fact_keys: ["fracture_bone", "injury", "how_it_happened"], benefit_id: "b1", subject_id: J })],
        () => [call("evaluate_benefit", { case: "shin bone", purpose: "claim", fact_keys: ["fracture_bone", "injury", "how_it_happened"], benefit_id: SCHED, subject_id: J })],
        (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-" }] })],
      ] },
      { user: "Sorry, I got that wrong - the X-ray shows it was his thigh bone.", steps: [
        () => [call("note_facts", { facts: [{ key: "fracture_bone", value: "thigh bone", words: "the X-ray shows it was his thigh bone" }], subject_id: J })],
        () => [call("evaluate_benefit", { case: "his thigh bone", purpose: "claim", fact_keys: ["fracture_bone"], benefit_id: SCHED, subject_id: J })],
        // the recorded closing question (RCT1a turn 3), then the answer the refusal points to
        () => [call("ask_user", { kind: "fact", fact_key: "insurer_medical_definition_decision", question: "Has the insurer made a reviewed medical decision that Jun’s diagnosis meets the policy’s definition of “Leg - thigh bone (femur)”?", subject_id: J, because_evidence_ids: [] })],
        (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-" }] })],
      ] },
    ];
    const out = await run(turns);
    const e2 = (out[1].trace.toolCalls ?? []).filter((c: any) => c.name === "evaluate_benefit");
    check("RCT1a recorded calls: the invented id b1 is refused with the person's benefit ids; case \"shin bone\" now resolves to \"Leg - below the knee (tibia or fibula)\" -> S$10,000", e2[0]?.ok === false && /bcf3fd4916c/.test(e2[0]?.error ?? "") && /S\$10,000/.test(out[1].v) && /below the knee/.test(out[1].v), out[1].v + "\n" + JSON.stringify(e2.map((c: any) => [c.ok, (c.error ?? "").slice(0, 200)])));
    const a3 = (out[2].trace.toolCalls ?? []).find((c: any) => c.name === "ask_user");
    check("RCT1a turn 3 recorded question about the insurer's review is refused; the turn ends with the corrected S$20,000 and no question", a3?.ok === false && /not a fact the household can give/.test(a3?.error ?? "") && !(out[2].answer.questions ?? []).length && /S\$20,000/.test(out[2].v), out[2].v + "\n" + JSON.stringify(a3));
    const g = gradeRCT1("RCT1a", { turns: [{}, {}, {}], loaded: { turns: out.map((x) => ({ answer: x.answer })), state: out[2].state }, saved: { traces: out.map((x) => x.trace) } });
    check("RCT1a: the pre-registered grader passes the replayed conversation", g.verdict === "PASS", JSON.stringify(g.checks.filter((c) => !c.ok)));
  } else {
    const A = W.M.adrian.id;
    const U = "Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.";
    const out = await run([{ user: U, steps: [
      () => [call("resolve_person", { mention: "Adrian" })],
      () => [call("note_facts", { facts: [{ key: "injury", value: "broke his leg", words: "Adrian broke his leg" }, { key: "how_it_happened", value: "in a fall", words: "in a fall" }, { key: "fracture_type", value: "closed fracture", words: "a closed fracture" }, { key: "surgery", value: "no surgery", words: "no surgery" }], subject_id: A })],
      () => [call("person_benefits", { subject_id: A, topic: "simple fracture leg" })],
      () => [call("evaluate_benefit", { case: "closed fracture of his leg", purpose: "claim", fact_keys: ["injury", "fracture_type"], benefit_id: "b167f5dfe35", subject_id: A })],
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-" }] })],
    ] }]);
    const x = out[0];
    check("RCW1b recorded calls: the assumption is the household's recorded words (\"Adrian broke his leg\"), not the paraphrase; the gate accepts the S$2,500", /S\$2,500/.test(x.v) && !(x.trace.gate ?? []).length && !/closed fracture of his leg/.test(x.v) && /Adrian broke his leg/.test(x.v), x.v + "\n" + JSON.stringify(x.trace.gate));
    let note3 = "";
    const w3 = await run([{ user: "Which of my uploaded policies should I claim under for Adrian's broken wrist from a cycling accident?", steps: [
      () => [call("resolve_person", { mention: "Adrian" })],
      () => [call("note_facts", { facts: [{ key: "injury", value: "broken wrist", words: "broken wrist" }, { key: "how_it_happened", value: "cycling accident", words: "cycling accident" }], subject_id: A })],
      () => [call("person_benefits", { topic: "broken wrist from cycling accident", subject_id: A })],
      () => [call("evaluate_benefit", { case: "broken wrist", purpose: "claim", fact_keys: ["injury", "how_it_happened"], benefit_id: "b167f5dfe35", subject_id: A })],
      (v: ScriptView) => { note3 = String(v.find("evaluate_benefit")?.result?.data?.note ?? ""); return [call("final_answer", { subject_id: A, sentences: [{ kind: "benefit_terms", benefit_id: "b167f5dfe35", text: "-" }] })]; },
    ] }]);
    const ev3 = (w3[0].trace.toolCalls ?? []).find((c: any) => c.name === "evaluate_benefit");
    const r3 = JSON.stringify(ev3?.summary ?? ev3 ?? {});
    check("RCW3 recorded call: \"broken wrist\" names none of the Simple Fracture cases -> the result says not to ask the household to choose one of them", ev3?.ok === true && /do not ask them to choose one of these cases/.test(note3) && !(w3[0].answer.questions ?? []).length, w3[0].v + "\n" + note3 + "\n" + r3.slice(0, 400));
    // P50A (an unplanned extra of the same run): the model's contact steps for the certificate, the PA wording and the
    // travel wording filed under Adrian but linked to nobody.
    const doc = (k: string) => W.DOCS.find((d) => d.key === k)!.id;
    const ad = await run([{ user: "Hypothetical test: Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026. Based on my uploaded documents, explain which death benefits may apply and what I should do next.", steps: [
      () => [call("resolve_person", { mention: "Adrian" })],
      () => [call("person_benefits", { topic: "death after an accident", subject_id: A })],
      () => [call("final_answer", { subject_id: A, sentences: [{ kind: "uncertainty", text: "The uploaded documents do not establish whether Adrian's cover was in force on 3 October 2026." }], next_steps: [`contact:${doc("CERT")}`, `contact:${doc("WORDING")}`, `contact:${doc("TRAVEL_WORDING")}`] })],
      () => [call("final_answer", { subject_id: A, sentences: [{ kind: "uncertainty", text: "The uploaded documents do not establish whether Adrian's cover was in force on 3 October 2026." }], next_steps: [`contact:${doc("CERT")}`, `contact:${doc("WORDING")}`] })],
    ] }]);
    const fa = (ad[0].trace.toolCalls ?? []).filter((c: any) => c.name === "final_answer");
    check("P50A recorded steps: a contact step for the travel wording linked to nobody is refused; one Kestrel step for its two documents; no Harbourline", fa[0]?.ok === false && /contact:<policy_id>/.test(fa[0]?.error ?? "") && !/Harbourline/.test(ad[0].v) && (ad[0].v.match(/Contact Kestrel/g) ?? []).length === 1, ad[0].v + "\n" + JSON.stringify(fa.map((c: any) => [c.ok, (c.error ?? "").slice(0, 200)])));
    const g = gradeRCW1("RCW1b", { turns: [{}], loaded: { turns: [{ answer: x.answer }], state: x.state }, saved: { traces: [x.trace] } });
    check("RCW1b: the pre-registered grader passes the replayed answer", g.verdict === "PASS", JSON.stringify(g.checks.filter((c) => !c.ok)));
  }
  console.log(`\nreliable-chat live regressions [${HH === T ? "tan" : "wong"}] ${failed ? "FAILED" : "passed"}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
