/**
 * Speed (the server looks up the person a first message names): offline proof on the scripted harness. Every scripted conversation, and
 * one written here whose first message names Daniel with a capital, is run twice -- as today, and with DEARPOLICY_PREFETCH_PERSON=1 -- and
 * the answers (text, statements, bottom line, citations) and the turn's tool calls and results are compared. Then the names the server
 * must never take as a person (Critic R26-1). No spend.
 *   node --import tsx docs/rag-migration/pr57-roles/developer/prefetch-proof.ts
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as FX from "../../../../scripts/fixtures/reliable-chat/fracture-conversation";
import { FRACTURE_SCENARIOS } from "../../../../scripts/fixtures/reliable-chat/fracture-scenarios";
import { FX_REPAIR_SCENARIOS } from "../../../../scripts/fixtures/reliable-chat/fx-repairs-scenarios";
import { ScriptedLoopModel, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { prefetchMention } from "@/lib/rag2/loop/loop";
import { call, benefitIdOf, resultIds, CERT } from "../../../../scripts/fixtures/reliable-chat/fracture-script";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])])) : v;
const shape = (a: any) => JSON.stringify(canon({ summary: a.summary, details: a.details, nextSteps: a.nextSteps, questions: a.questions, bottomLine: a.bottomLine ?? null, statements: a.statements ?? null, citations: (a.citations ?? []).map((c: any) => [c.chunkId, c.excerpt]) }));
const tools = (t: any) => JSON.stringify((t?.toolCalls ?? []).map((c: any) => [c.name, canon(c.args), c.ok, c.summary ?? null, c.evidenceIds]));
async function run(h: any, sc: any, on: boolean) {
  if (on) process.env.DEARPOLICY_PREFETCH_PERSON = "1"; else delete process.env.DEARPOLICY_PREFETCH_PERSON;
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  installLoopModel(new ScriptedLoopModel(sc.turns));
  const out: { answer: string; tools: string; steps: number; prefetched: boolean }[] = [];
  let conv: { id?: string; rev?: number } = {};
  try {
    for (const m of sc.messages) {
      const a = await h.send(m, conv);
      conv = { id: a.conversationId!, rev: a.conversationRevision! };
      const t = (await h.savedAnswer(a.conversationId!)).state.ragLoop.turns.at(-1);
      out.push({ answer: shape(a), tools: tools(t), steps: t.steps, prefetched: (t.adjusted ?? []).some((x: string) => /made by the server before the first model call/.test(x)) });
    }
  } catch (e) { out.push({ answer: "ERROR " + String((e as Error).message).slice(0, 200), tools: "", steps: 0, prefetched: false }); }
  return out;
}
async function main() {
  setEnv(FX as any);
  const h = await startHarness(FX as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  let same = 0, differ = 0, used = 0;
  // (Daniel's arm, scripted as a model would play it: who, then his benefits, then the two schedules, then the answer)
  const DAN = FX.M.daniel.id;
  const ids: { sb?: string; so?: string } = {};
  const DANIEL: ScriptTurn = { user: /Daniel tripped/, steps: [
    () => [call("resolve_person", { mention: "Daniel" })],
    () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "tripped", words: "tripped" }, { key: "injury", value: "broke his arm", words: "broke his arm" }], subject_id: DAN }), call("person_benefits", { topic: "fracture after a fall", subject_id: DAN })],
    (v) => { ids.sb = benefitIdOf(v, /^Simple Fracture$/i); ids.so = benefitIdOf(v, /Simple Fracture or Other Fracture/i);
      const ev = (id: string) => call("evaluate_benefit", { case: "broke his arm", purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: DAN, assumption_words: "broke his arm" });
      return [ev(ids.sb!), ev(ids.so!)]; },
    (v) => [call("final_answer", { sentences: resultIds(v).map((r) => ({ kind: "calculation", text: "-", result_id: r })), next_steps: ["contact:" + CERT], subject_id: DAN })],
  ] };
  for (const sc of [{ id: "DANIEL-ARM", messages: ["Daniel tripped on the stairs and broke his arm."], turns: [DANIEL] }, ...FRACTURE_SCENARIOS(), ...FX_REPAIR_SCENARIOS()] as any[]) {
    // (the server's call replaces the model's first step only where that step is the same single call: a script that starts otherwise is
    // a model that chose otherwise, and runs as today -- shown as "not applicable")
    const first = sc.turns[0]?.steps[0];
    let firstCalls: any[] = [];
    try { firstCalls = first ? first({ user: sc.messages[0], last: [], turn: [], system: "", find: () => undefined } as any) : []; } catch { firstCalls = []; }
    const applicable = firstCalls.length === 1 && firstCalls[0].name === "resolve_person";
    const a = await run(h, sc, false);
    const b = applicable ? await run(h, sc, true) : null;
    // (the scripted model counts the server's call as the turn's first step -- it reads the conversation as a model would -- so its next
    // call plays the script's second step)
    if (!b) { console.log(`${sc.id}: not applicable (the script's first move is ${firstCalls.map((c) => c.name).join(" + ") || "none"})`); continue; }
    for (const [i, x] of a.entries()) {
      const y = b[i];
      const ok = !!y && x.answer === y.answer && x.tools === y.tools;
      if (y?.prefetched) used++;
      if (ok) same++; else differ++;
      console.log(`${sc.id} turn ${i + 1}: ${ok ? "IDENTICAL" : "DIFFERENT"} answer and lookups; server made the first call: ${!!y?.prefetched}; model calls ${x.steps} -> ${y?.steps ?? "?"}`);
      if (!ok) { console.log(`  today: ${x.answer.slice(0, 300)}\n  prefetch: ${y?.answer.slice(0, 300)}\n  tools today: ${x.tools.slice(0, 300)}\n  tools prefetch: ${y?.tools.slice(0, 300)}`); }
    }
  }
  console.log(`\n${same} identical, ${differ} different; the server's call was used on ${used} turn(s)`);
  // Critic R26-1: messages whose words are not the person the question is about -- the server must not take them as a name.
  const people = [{ id: "g", name: "Tan Hui Min Grace (Grace)" }, { id: "w", name: "Will Tan (Will)" }, { id: "m", name: "Lim Min (Min)" }, { id: "d", name: "Lee Wei Ming, Daniel (Daniel)" }, { id: "a", name: "Wong Jia Hui, Adrian (Adrian)" }];
  const never = ["What is the grace period for my premium?", "Will my policy cover dental?", "I waited 30 min at the clinic", "Sarah, Grace's colleague, broke her arm", "Grace period: when does it end?", "Daniel's GP bill is $800, can he claim?", "Hypothetically, Adrian died in a car accident in Japan.", "Daniel and Grace were both hurt.", "Min broke her wrist", "Sarah fell and Daniel took her to hospital", "Sarah, Daniel's colleague, fell."];
  let bad = 0;
  for (const m of never) { const got = prefetchMention(m, people); console.log(`${got ? "FAIL" : "PASS"} no person taken from ${JSON.stringify(m)}${got ? ` (took ${got})` : ""}`); if (got) bad++; }
  for (const [m, want] of [["Daniel tripped on the stairs and broke his arm.", "Daniel"], ["Adrian broke his leg yesterday.", "Adrian"], ["Yesterday Daniel fell down the stairs and broke his arm.", "Daniel"], ["What does Adrian's policy pay?", null]] as const) { const got = prefetchMention(m, people); console.log(`${got === want ? "PASS" : "FAIL"} ${JSON.stringify(m)} -> ${got}`); if (got !== want) bad++; }
  process.exit(differ || bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
