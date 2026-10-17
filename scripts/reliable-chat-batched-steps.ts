/**
 * Actual-library findings (latency): the prompt lets the model call resolve_person, note_facts and person_benefits in
 * ONE step. That is safe only if an ambiguous mention stops the lookups that follow it in the same step: "my son" in a
 * household with a son and a stepson -> resolve_person is ambiguous -> person_benefits / evaluate_benefit for a guessed
 * child are refused, and the household is asked who is meant. A clear name runs all three in one step.
 */
import assert from "node:assert/strict";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as L from "./fixtures/rag2-loop/household";
process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(L as any);
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
async function main() {
  const h = await startHarness(L as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const son = (L.M as any).junhao.id;
  let n = 0;
  try {
    const U = "My son broke his arm at school. What can we claim?";
    installLoopModel(new ScriptedLoopModel([{ user: U, steps: [
      () => [call("resolve_person", { mention: "my son" }), call("note_facts", { subject_id: son, facts: [{ key: "injury", value: "broke his arm", words: "broke his arm" }] }), call("person_benefits", { subject_id: son, topic: "fracture arm" })],
      (v) => { const r = v.find("resolve_person")?.result?.data; return [call("ask_user", { kind: "person", question: "Which of your sons do you mean?", options: (r?.options ?? []).map((o: any) => o.id), mention: "my son" })]; },
    ] }]));
    const a = await h.send(U);
    const s = await h.savedAnswer(a.conversationId!);
    const calls = s.state.ragLoop.turns.at(-1).toolCalls ?? [];
    const pb = calls.find((c: any) => c.name === "person_benefits");
    assert.equal(calls.find((c: any) => c.name === "resolve_person")?.summary?.includes("ambiguous"), true, JSON.stringify(calls));
    assert.ok(pb && !pb.ok && /not settled/.test(pb.error ?? ""), "a lookup batched after an ambiguous mention is refused: " + JSON.stringify(pb));
    assert.equal((s.answer.questions ?? []).length, 1);
    console.log("PASS ambiguous 'my son' batched with person_benefits: the lookup is refused and who is meant is asked"); n++;
    const U2 = "Jun Hao broke his arm at school. What can we claim?";
    installLoopModel(new ScriptedLoopModel([{ user: U2, steps: [
      () => [call("resolve_person", { mention: "Jun Hao" }), call("note_facts", { subject_id: son, facts: [{ key: "injury", value: "broke his arm", words: "broke his arm" }] }), call("person_benefits", { subject_id: son, topic: "fracture arm" })],
      () => [call("final_answer", { subject_id: son, sentences: [{ kind: "fact", text: "I have looked at Jun Hao's documents." }] })],
    ] }]));
    const b = await h.send(U2);
    const s2 = await h.savedAnswer(b.conversationId!);
    const c2 = s2.state.ragLoop.turns.at(-1).toolCalls ?? [];
    assert.ok(["resolve_person", "note_facts", "person_benefits"].every((k) => c2.find((c: any) => c.name === k)?.ok), JSON.stringify(c2.map((c: any) => [c.name, c.ok, c.error])));
    assert.equal(s2.state.ragLoop.turns.at(-1).steps, 2);
    console.log("PASS a named member: resolve_person, note_facts and person_benefits run in one step (2 model steps for the turn)"); n++;
  } finally { installLoopModel(null); await h.db.close(); }
  console.log(`reliable-chat batched steps: ${n}/2 passed`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
