/**
 * RECONSTRUCTION of the live "what do i do now" failure (LIVE-FINDINGS turn 7, 20 Oct 2026): after an answer with a next step, the
 * follow-up got only "I couldn't confirm an answer to that from your documents." Anonymised fixture household, scripted model, PGlite,
 * no spend. Developer-owned scratch, not a registered test.
 *
 *   node --import tsx docs/rag-migration/pr57-roles/developer/what-now-repro.ts
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as FX from "../../../../scripts/fixtures/reliable-chat/fracture-conversation";
import { ScriptedLoopModel, type ScriptCall, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { CERT, call } from "../../../../scripts/fixtures/reliable-chat/fracture-script";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const DAN = FX.M.daniel.id;
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => "Q: " + (q.text ?? "")), ...uniqueSteps(a?.nextSteps).map((s: string) => "STEP: " + s)].filter(Boolean).join("\n");
const rep = (f: () => ScriptCall[]) => Array.from({ length: 6 }, () => f);

// Turn 1: the GP-bill question, answered with the insurer contact step.
const T1: ScriptTurn = { steps: [
  () => [call("resolve_person", { mention: "daniel" })],
  () => [call("note_facts", { subject_id: DAN, facts: [{ key: "how_it_happened", value: "tripped on the kerb", words: "tripped on the kerb" }, { key: "bill_amount", value: "$800 GP bill", words: "his GP bill is $800" }] })],
  () => [call("search_passages", { k: 8, query: "GP outpatient clinic medical expenses", subject_id: DAN })],
  ...rep(() => [call("final_answer", { subject_id: DAN, sentences: [{ kind: "fact", text: "Daniel's documents do not include a benefit that pays for a GP bill after a fall.", subject_id: DAN }], next_steps: ["contact:" + CERT] })]),
] };
// Turn 2: "what do i do now" -- the model answers with general advice the composer cannot keep (uncited, a stated requirement).
const VARIANTS: Record<string, ScriptTurn> = {
  uncited_advice: { steps: rep(() => [call("final_answer", { subject_id: DAN, sentences: [{ kind: "fact", text: "You need to submit a claim form with the GP bill and receipts to the insurer.", subject_id: DAN }], next_steps: ["You must submit the original receipts within 30 days."] })]) },
};

async function main() {
  setEnv(FX as any);
  const h = await startHarness(FX as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  for (const [name, t2] of Object.entries(VARIANTS)) {
    installLoopModel(new ScriptedLoopModel([T1, t2]));
    try {
      const a1 = await h.send("daniel tripped on the kerb and fell, his GP bill is $800, can he claim for this?", {});
      const s1 = await h.savedAnswer(a1.conversationId!);
      const a2 = await h.send("what do i do now", { id: a1.conversationId!, rev: s1.state?.rev });
      const s2 = await h.savedAnswer(a1.conversationId!);
      const tr = s2.state.ragLoop.turns.at(-1);
      console.log(`\n=== ${name}\n--- turn 1\n${visible(a1)}\n--- turn 2 (returned)\n${visible(a2)}\n--- turn 2 (saved = returned: ${visible(s2.answer) === visible(a2)})\n  outcome: ${tr.outcome}\n  dropped: ${JSON.stringify((tr.dropped ?? []).map((d: any) => `${String(d.sentence).slice(0, 60)} -- ${d.reason}`))}\n  adjusted: ${JSON.stringify(tr.adjusted ?? [])}`);
    } finally { installLoopModel(null); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
