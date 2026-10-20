/**
 * Browser journey of the production fracture conversation (19 Oct 2026): the household's two messages and the recorded model moves
 * (./fracture-script.ts) over the anonymised household (./fracture-conversation.ts). Scripted model: plumbing evidence for the page,
 * the API, the save and the reload -- never a model result.
 */
import type { ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { MSG1, MSG2, T1, T2 } from "./fracture-script";

export type FractureScenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[] };
export const FRACTURE_SCENARIOS = (): FractureScenario[] => [
  { id: "FR1", title: "arm fracture, then the reply about X-ray / certification", messages: [MSG1, MSG2], turns: [T1, T2] },
];
