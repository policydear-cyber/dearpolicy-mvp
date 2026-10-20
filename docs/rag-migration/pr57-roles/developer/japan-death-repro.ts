/**
 * Developer scratch reproduction of the UX agent's L2 finding ("Adrian died in a car accident in Japan" shows only Term Life), through the
 * real chat route on the anonymised livelib household with the L2 scripted turns (no spend). Not a registered test.
 *   node --import tsx docs/rag-migration/pr57-roles/developer/japan-death-repro.ts            (benefits contract: what production runs)
 *   CONTRACT=legacy-operands node --import tsx ...                                             (what the UX test server forced for livelib)
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as LL from "../../../../scripts/fixtures/rag2-livelib/household";
import { LIVELIB_SCENARIOS } from "../../../../scripts/fixtures/rag2-livelib/conversations";
import { ScriptedLoopModel } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";

process.env.DEARPOLICY_CHAT_CONTRACT = process.env.CONTRACT ?? "benefits";
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
async function main() {
  setEnv(LL as any);
  const h = await startHarness(LL as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const sc = LIVELIB_SCENARIOS.find((s) => s.id === "L2")! as any;
  installLoopModel(new ScriptedLoopModel(sc.turns));
  try {
    const a = await h.send(sc.messages[0], {});
    const s = await h.savedAnswer(a.conversationId!);
    const tr = s.state.ragLoop.turns.at(-1);
    console.log(`=== ${process.env.DEARPOLICY_CHAT_CONTRACT}\n${visible(s.answer)}\n  outcome: ${tr.outcome}\n  adjusted: ${JSON.stringify(tr.adjusted ?? [])}\n  dropped: ${JSON.stringify((tr.dropped ?? []).map((d: any) => d.reason))}`);
  } finally { installLoopModel(null); }
}
main().catch((e) => { console.error(e); process.exit(1); });
