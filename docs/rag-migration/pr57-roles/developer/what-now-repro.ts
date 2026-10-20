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

const GRACE = FX.M.grace.id;
const final = (subject: string, text: string, steps: string[]) => rep(() => [call("final_answer", { subject_id: subject, sentences: [{ kind: "fact", text, subject_id: subject }], next_steps: steps })]);
// An answer about a GP bill: the model's raw steps include a figure and a stated requirement, which the composer leaves out (Critic R14-1).
const gp = (who: string, subject: string): ScriptTurn => ({ steps: [
  () => [call("resolve_person", { mention: who })],
  () => [call("note_facts", { subject_id: subject, facts: [{ key: "how_it_happened", value: "tripped on the kerb", words: "tripped on the kerb" }, { key: "bill_amount", value: "$800 GP bill", words: "the GP bill is $800" }] })],
  () => [call("search_passages", { k: 8, query: "GP outpatient clinic medical expenses", subject_id: subject })],
  ...final(subject, `${who}'s documents do not include a benefit that pays for a GP bill after a fall.`, ["contact:" + CERT, "Claim S$2,500 from the insurer.", "You must submit the claim form with receipts."]),
] });
const plain = (who: string, subject: string): ScriptTurn => ({ steps: [() => [call("resolve_person", { mention: who })], ...final(subject, `${who}'s documents do not include a benefit for this.`, [])] });
// "what do i do now": the model's general advice, which the composer cannot keep.
const whatNow: ScriptTurn = { steps: final(DAN, "You need to submit a claim form with the GP bill and receipts to the insurer.", ["You must submit the original receipts within 30 days."]) };
const CASES: [string, [string, ScriptTurn][]][] = [
  ["after a GP-bill answer: repeats only the step that answer showed", [["daniel tripped on the kerb and fell, his GP bill is $800, can he claim for this?", gp("daniel", DAN)], ["what do i do now", whatNow]]],
  ["Grace, then \"it was Daniel\": nothing from Grace's answer", [["grace tripped on the kerb and fell, her GP bill is $800, can she claim?", gp("grace", GRACE)], ["sorry, it was daniel not grace", plain("daniel", DAN)], ["what do i do now", whatNow]]],
  ["a death, then a fracture: nothing from the death answer", [["daniel died in an accident, what does the policy pay?", gp("daniel", DAN)], ["daniel broke his wrist, what can he claim?", plain("daniel", DAN)], ["what do i do now", whatNow]]],
];
async function main() {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  for (const [name, turns] of CASES) {
    setEnv(FX as any);
    const h = await startHarness(FX as any);
    process.env.DEARPOLICY_RAG_LOOP = "1";
    installLoopModel(new ScriptedLoopModel(turns.map(([, t]) => t)));
    try {
      let conv: { id?: string; rev?: number } = {}; let last: any = null;
      for (const [msg] of turns) { last = await h.send(msg, conv); const sv = await h.savedAnswer(last.conversationId!); conv = { id: last.conversationId!, rev: sv.state?.rev }; }
      const sv = await h.savedAnswer(conv.id!);
      const tr = sv.state.ragLoop.turns.at(-1);
      console.log(`\n=== ${name}\n${visible(last)}\n  saved = returned: ${visible(sv.answer) === visible(last)}\n  adjusted: ${JSON.stringify(tr.adjusted ?? [])}`);
    } finally { installLoopModel(null); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
