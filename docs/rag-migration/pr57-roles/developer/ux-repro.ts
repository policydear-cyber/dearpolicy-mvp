/**
 * Developer scratch reproduction of the UX agent's C2 regressions (FX-K4B turn 1 question card, FX-K6B "couldn't confirm"), through the
 * real chat route on the anonymised fracture household with the recorded fx-live-1 calls (scripted model, no spend). Not a registered test.
 *   node --import tsx docs/rag-migration/pr57-roles/developer/ux-repro.ts [FX-K4B,FX-K6B,...]
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as FX from "../../../../scripts/fixtures/reliable-chat/fracture-conversation";
import { FX_REPAIR_SCENARIOS } from "../../../../scripts/fixtures/reliable-chat/fx-repairs-scenarios";
import { ScriptedLoopModel } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const want = (process.argv[2] ?? "").split(",").filter(Boolean);
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => `[QUESTION] ${q.text ?? ""} ${q.why ?? q.reason ?? ""}`), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
async function main() {
  setEnv(FX as any);
  const h = await startHarness(FX as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  for (const sc of FX_REPAIR_SCENARIOS() as any[]) {
    if (want.length && !want.includes(sc.id)) continue;
    installLoopModel(new ScriptedLoopModel(sc.turns));
    let conv: { id?: string; rev?: number } = {};
    try {
      for (const [i, m] of sc.messages.entries()) {
        const a = await h.send(m, conv);
        conv = { id: a.conversationId!, rev: a.conversationRevision! };
        const s = await h.savedAnswer(a.conversationId!);
        const tr = s.state.ragLoop.turns.at(-1);
        if (process.env.EV) for (const id of process.env.EV.split(",")) console.log("EV", id, JSON.stringify(s.state.ragLoop.evidence?.[id]?.passage?.text?.slice(0, 300)), s.state.ragLoop.evidence?.[id]?.page);
        console.log(`\n=== ${sc.id} turn ${i + 1}: ${m}\n${visible(s.answer)}\n  questions: ${JSON.stringify(s.answer.questions ?? []).slice(0, 600)}\n  outcome: ${tr.outcome}  dropped: ${JSON.stringify((tr.dropped ?? []).map((d: any) => d.reason))}\n  calls: ${JSON.stringify((tr.toolCalls ?? []).map((c: any) => `${c.name}${c.ok ? "" : " ERR " + String(c.error ?? "").slice(0, 300)}`))}`);
      }
    } finally { installLoopModel(null); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
