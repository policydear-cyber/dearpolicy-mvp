/**
 * Speed (server makes the first resolve_person call): offline proof on the scripted harness. Every scripted conversation is run twice --
 * as today, and with DEARPOLICY_PREFETCH_PERSON=1 (the server's call replaces the model's first step when that step was that same call) --
 * and the answers (text, statements, bottom line, citations) and the turn's tool calls and results are compared. No spend.
 *   node --import tsx docs/rag-migration/pr57-roles/developer/prefetch-proof.ts
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as FX from "../../../../scripts/fixtures/reliable-chat/fracture-conversation";
import { FRACTURE_SCENARIOS } from "../../../../scripts/fixtures/reliable-chat/fracture-scenarios";
import { FX_REPAIR_SCENARIOS } from "../../../../scripts/fixtures/reliable-chat/fx-repairs-scenarios";
import { ScriptedLoopModel } from "@/lib/rag2/loop/scripted-model";

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
  for (const sc of [...FRACTURE_SCENARIOS(), ...FX_REPAIR_SCENARIOS()] as any[]) {
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
  process.exit(differ ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
