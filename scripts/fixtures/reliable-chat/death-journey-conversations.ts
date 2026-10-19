/**
 * Death-journey release: the household's words and the scripted model moves of the broad death question, over the
 * death-journey household (./death-journey.ts). The moves follow the structure the request states -- one person lookup, one
 * person_benefits, then seven searches with heavily overlapping hits -- because the recorded calls were not attached.
 */
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import * as DJ from "./death-journey";
import { sbbTurns, SBB_U1, SBB_U2, j1Turn, j2Turn, J1_U, J2_U } from "./actual-lib-conversations";

const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
export const D = DJ.M.daniel.id, G = DJ.M.grace.id;
export const DEATH_Q = "What happens if Daniel dies? What would the family receive from his insurance, and what should we do?";
export const DEATH_SEARCHES = [
  "death benefit payable", "accidental death sum insured", "funeral expenses compassionate death allowance", "claim documents proof of death",
  "Term Life death benefit sum assured", "death due to natural catastrophe", "Core Scheme or Voluntary Scheme claim death",
];
/** The model searches up to seven times (it stops when told retrieval is closed) and then answers with nothing (what is established is the server's to say). */
export const deathTurn = (searches = DEATH_SEARCHES): ScriptTurn => ({ user: DEATH_Q, steps: [
  () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death" })],
  // (a model told that retrieval is closed finishes; one that is not keeps searching)
  ...searches.map((q) => (v: ScriptView) => v.last.some((o) => /retrieval is closed|model-use budget is running low/.test(JSON.stringify(o.result))) ? [call("final_answer", { subject_id: D, sentences: [], next_steps: [] })] : [call("search_passages", { subject_id: D, query: q })]),
  () => [call("final_answer", { subject_id: D, sentences: [], next_steps: [] })],
] });

/** The browser scenarios over the death-journey household: DJ1 the broad death question (the model told retrieval is closed finishes;
 * `metered` = it reports token use like a hosted model, so the 80,000-token turn limit is exercised), DJ2 the SBb comparison replay,
 * DJ3 tibia -> hip. */
export type DeathScenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[]; metered?: number };
export const DEATH_SCENARIOS = (): DeathScenario[] => [
  { id: "DJ1", title: "broad death question", messages: [DEATH_Q], turns: [deathTurn()], metered: 1 },
  { id: "DJ2", title: "SBb replay over adjacent dismemberment wording", messages: [SBB_U1, SBB_U2], turns: sbbTurns() },
  { id: "DJ3", title: "tibia to hip over adjacent dismemberment wording", messages: [J1_U, J2_U], turns: [j1Turn(), j2Turn()] },
];
