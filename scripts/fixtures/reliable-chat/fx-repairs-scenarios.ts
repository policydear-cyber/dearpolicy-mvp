/**
 * Browser journeys of the fx-live-1 repairs (PR #57), over the anonymised fracture household (./fracture-conversation.ts).
 *
 * Each scenario plays the model's RECORDED tool calls of the fx-live-1 run (./fx-live-1-model-calls.json, ./recorded-model.ts) through the
 * real chat page and /api/chat; where the repaired pipeline gives the model one repair round, the continuation is what a model that follows
 * the repair message would send (the same continuations as scripts/reliable-chat-fx-repairs-test.ts, groups A, B, C and D).
 * Scripted model: plumbing evidence for the page, the API, the save and the reload -- never a model result.
 *
 *   FX-K6B  "Does Grace's cover pay for dental treatment?"                       (supported absence over a named scope)
 *   FX-K6A  "What does Grace's Group Living Care pay if she is diagnosed with cancer?"   (the amount stays with its limitation)
 *   FX-K2   the hospital stay because she was sick                                (the reported cause is used, not asked again)
 *   FX-K4B  "grace fell down and broke her arm", then the correction to Daniel    (one coherent correction notice)
 */
import type { ScriptCall, ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { CERT, call, G } from "./fracture-script";
import { recordedTerminal, recordedTurns } from "./recorded-model";
import type { FractureScenario } from "./fracture-scenarios";

export const K6B_MSG = "Does Grace's cover pay for dental treatment?";
export const K6A_MSG = "What does Grace's Group Living Care pay if she is diagnosed with cancer?";
export const K2_MSG = "Grace was hospitalised for three days last week because she was sick. Does her accident cover pay anything?";
export const K4B_MSG1 = "grace fell down and broke her arm";
export const K4B_MSG2 = "Actually it was Daniel who broke his arm, not Grace.";

const nextStepsOf = (tag: string) => ((recordedTerminal(tag).arguments as any).next_steps ?? []) as string[];
/** The recorded turns of `tag`, with continuation steps appended to the last recorded turn. */
const withContinuation = (tag: string, ...more: (() => ScriptCall[])[]): ScriptTurn[] => {
  const t = recordedTurns(tag);
  t[t.length - 1].steps.push(...(more as any));
  return t;
};

export const FX_REPAIR_SCENARIOS = (): FractureScenario[] => {
  const dental = (): ScriptCall[] => [call("final_answer", { subject_id: G, sentences: [{ kind: "not_found", text: "-", claim: "benefit_not_found", topic: "dental treatment", terms: ["dental", "dentist", "tooth"] }], next_steps: nextStepsOf("A/K6b") })];
  const fact = (recordedTerminal("A/K6a").arguments as any).sentences[0];
  const silent = { kind: "not_found", text: "-", claim: "document_silent", topic: "what Group Living Care pays for cancer", terms: ["cancer"], scope_policy_ids: [CERT] };
  const cancer = (): ScriptCall[] => [call("final_answer", { subject_id: G, sentences: [fact, silent], next_steps: nextStepsOf("A/K6a") })];
  return [
    { id: "FX-K6B", title: "dental: a supported absence over the named documents", messages: [K6B_MSG], turns: withContinuation("A/K6b", dental) },
    { id: "FX-K6A", title: "cancer: the dated Living Care sum insured stays with its limitation", messages: [K6A_MSG], turns: withContinuation("A/K6a", cancer) },
    { id: "FX-K2", title: "sick hospital stay: the reported cause is used, the accident question is not asked again", messages: [K2_MSG], turns: recordedTurns("A/K2") },
    { id: "FX-K4B", title: "person correction to Daniel: one coherent notice, Daniel's facts", messages: [K4B_MSG1, K4B_MSG2], turns: recordedTurns("A/K4b") },
  ];
};
