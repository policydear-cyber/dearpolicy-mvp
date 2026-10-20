/**
 * Speed: where a turn's time goes on the scripted harness (no model latency: the scripted model answers at once), per phase and per tool,
 * for the fracture household's conversations. Developer-owned scratch, not a registered test. No spend.
 *   node --import tsx docs/rag-migration/pr57-roles/developer/speed-repro.ts [FR1,FX-K2,...]
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as FX from "../../../../scripts/fixtures/reliable-chat/fracture-conversation";
import { FRACTURE_SCENARIOS } from "../../../../scripts/fixtures/reliable-chat/fracture-scenarios";
import { FX_REPAIR_SCENARIOS } from "../../../../scripts/fixtures/reliable-chat/fx-repairs-scenarios";
import { ScriptedLoopModel } from "@/lib/rag2/loop/scripted-model";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const want = (process.argv[2] ?? "").split(",").filter(Boolean);
async function main() {
  setEnv(FX as any);
  const h = await startHarness(FX as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  for (const sc of [...FRACTURE_SCENARIOS(), ...FX_REPAIR_SCENARIOS()] as any[]) {
    if (want.length && !want.includes(sc.id)) continue;
    installLoopModel(new ScriptedLoopModel(sc.turns));
    let conv: { id?: string; rev?: number } = {};
    for (const [i, m] of sc.messages.entries()) {
      const t0 = Date.now();
      const a = await h.send(m, conv);
      const wall = Date.now() - t0;
      conv = { id: a.conversationId!, rev: a.conversationRevision! };
      const st = (await h.savedAnswer(a.conversationId!)).state?.ragLoop;
      const t = st?.turns?.at(-1);
      const tools = Object.entries(t?.timings?.toolMs ?? {}).map(([k, v]: any) => `${k} ${v.n}x ${v.ms}ms`).join(", ");
      console.log(`${sc.id} t${i + 1} wall ${wall}ms | steps ${t?.steps} model calls ${t?.calls?.length ?? "?"} | phases ${JSON.stringify(t?.phases)} | model ${t?.timings?.modelMs}ms other ${t?.timings?.otherMs}ms resolve ${JSON.stringify(t?.timings?.resolve)} | tools ${tools} | store ${JSON.stringify(t?.timings?.store)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
