/**
 * Structured-answers release: the household's words and the scripted model moves of the seven journeys over the
 * faithful actual-library fixture (./actual-lib.ts). Shared by the offline script and the browser harness.
 */
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import * as A from "./actual-lib";

const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
export const D = A.M.daniel.id, G = A.M.grace.id, CERT = A.doc("CERT").id;
export const SF = /^Simple Fracture/, PA = (s: any) => s.policy_id === A.doc("PA_SUMMARY").id || s.evidence?.policy_id === A.doc("PA_SUMMARY").id;
const scheds = (v: ScriptView) => ([...v.turn].reverse().find((o) => o.name === "person_benefits")?.result?.data?.schedules ?? []) as any[];
const sfOf = (v: ScriptView) => scheds(v).find((s) => s.evidence?.policy_id === A.doc("PRODUCT_SUMMARY").id && SF.test(s.benefit));
const paOf = (v: ScriptView) => scheds(v).find(PA);
const evals = (v: ScriptView) => v.turn.filter((o) => o.name === "evaluate_benefit").map((o) => o.result?.data ?? {});
const lastEval = (v: ScriptView) => evals(v).at(-1) ?? {};
const calcs = (v: ScriptView) => evals(v).filter((e: any) => e.result_id).map((e: any) => ({ kind: "calculation", result_id: e.result_id, text: "-" }));
const cdaOf = (v: ScriptView) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") for (const d of o.result?.data?.documents ?? []) if (d.policy_id === A.doc("BOOKLET").id) for (const b of d.benefits ?? []) if (/Compassionate Death/.test(b.benefit)) return b.benefit_id; return null; };

// ---- the household's words
export const J1_U = "Daniel fractured his tibia in an accident. It's a closed fracture. What would his accident cover pay?";
export const J2_U = "Correction: it was his hip, not his tibia. Keep this as a hypothetical closed fracture.";
export const J3_U1 = "Daniel fell off a ladder at home in an accident. The doctor says he fractured his hip, or possibly his tibia - they're not sure yet. It's a closed fracture. What would his accident cover pay?";
export const J3_U2 = "The scan shows it's the tibia.";
export const J4_U = "Can you compare what the Simple Fracture and the Other Fracture benefits would pay if Daniel broke his leg?";
export const J5_U = "If Daniel died in an accident, what would our booklet pay towards his funeral, and what documents would the insurer want from us?";
export const J6_U = "And if Grace fractured her hip, what would the Simple Fracture benefit pay for her?";

/** J1 as the report describes the app's moves: both fracture tables evaluated for the closed tibia, both calculations stated. */
export const j1Turn = (): ScriptTurn => ({ user: J1_U, steps: [
  () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "closed tibia fracture", words: "fractured his tibia in an accident. It's a closed fracture" }] })],
  () => [call("person_benefits", { subject_id: D, topic: "closed tibia fracture accident" })],
  (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "tibia", fact_keys: ["injury"] }), call("evaluate_benefit", { subject_id: D, benefit_id: paOf(v)?.benefit_id, purpose: "claim", case: "tibia", fact_keys: ["injury"] })],
  (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: calcs(v), next_steps: ["contact:" + CERT] })],
] });
/** J2: the correction, with the model passing the household's whole message as the illustration's assumption (as the
 * report's composed sentence shows). */
export const j2Turn = (): ScriptTurn => ({ user: J2_U, steps: [
  () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "closed hip fracture", words: "it was his hip, not his tibia" }] }), call("person_benefits", { subject_id: D, topic: "closed hip fracture" })],
  (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "what_if", case: "hip", assumption_words: J2_U, fact_keys: ["injury"] })],
  (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: calcs(v), next_steps: ["contact:" + CERT] })],
] });
export const j3Turns = (): ScriptTurn[] => [
  { user: J3_U1, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "fell off a ladder at home in an accident", words: "fell off a ladder at home in an accident" }, { key: "injury", value: "closed fracture of the hip or possibly the tibia", words: "fractured his hip, or possibly his tibia - they're not sure yet. It's a closed fracture" }] })],
    () => [call("person_benefits", { subject_id: D, topic: "closed fracture hip tibia" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "hip or possibly his tibia", fact_keys: ["injury"] })],
    (v: ScriptView) => [call("ask_user", { kind: "fact", subject_id: D, requirement_id: lastEval(v).requirement_id, question: lastEval(v).ask ?? "Was it Daniel's hip or his tibia?", statements: [{ kind: "benefit_terms", benefit_id: sfOf(v)?.benefit_id }] })],
  ] },
  { user: J3_U2, steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "closed tibia fracture", words: "it's the tibia" }] }), call("person_benefits", { subject_id: D, topic: "closed tibia fracture" })],
    // as the report describes: the illustration's assumption is the EARLIER uncertain report
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "tibia", assumption_words: "fractured his hip, or possibly his tibia - they're not sure yet", fact_keys: ["injury"] })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: calcs(v), next_steps: ["contact:" + CERT] })],
  ] },
];
export const j4Turn = (): ScriptTurn => ({ user: J4_U, steps: [
  () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "simple fracture other fracture leg" })],
  (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "what_if", case: "leg" }), call("evaluate_benefit", { subject_id: D, benefit_id: paOf(v)?.benefit_id, purpose: "what_if", case: "leg (Other Fracture)" })],
  (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: calcs(v).length ? calcs(v) : [{ kind: "benefit_terms", benefit_id: sfOf(v)?.benefit_id }, { kind: "benefit_terms", benefit_id: paOf(v)?.benefit_id }] })],
] });
export const j5Turn = (): ScriptTurn => ({ user: J5_U, steps: [
  () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death after an accident; funeral expenses" })],
  (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: cdaOf(v) }, { kind: "uncertainty", text: "The booklet does not list the specific documents required beyond proof of death and the relevant documents in the insurer's prescribed form.", evidence_ids: [] }], next_steps: ["contact:" + CERT] })],
] });
export const j6Turn = (): ScriptTurn => ({ user: J6_U, steps: [
  () => [call("resolve_person", { mention: "Grace" }), call("person_benefits", { subject_id: G, topic: "hip fracture personal accident" })],
  (v: ScriptView) => [call("evaluate_benefit", { subject_id: G, benefit_id: sfOf(v)?.benefit_id, purpose: "what_if", case: "hip" })],
  (v: ScriptView) => { const pa = [...v.turn].reverse().find((o) => o.name === "person_benefits")?.result?.data?.documents?.find((d: any) => d.policy_id === CERT)?.benefits?.find((b: any) => /Personal Accident/.test(b.benefit));
    return [call("final_answer", { subject_id: G, sentences: [...calcs(v), ...(pa ? [{ kind: "benefit_terms", benefit_id: pa.benefit_id }] : [])], next_steps: ["contact:" + CERT] })]; },
] });


export type ActualScenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[] };
export const ACTUAL_SCENARIOS = (): ActualScenario[] => [
  { id: "SA1", title: "closed tibia", messages: [J1_U], turns: [j1Turn()] },
  { id: "SA2", title: "correction tibia to hip", messages: [J1_U, J2_U], turns: [j1Turn(), j2Turn()] },
  { id: "SA3", title: "uncertain hip or tibia, then clarified", messages: [J3_U1, J3_U2], turns: j3Turns() },
  { id: "SA4", title: "Simple versus Other comparison", messages: [J4_U], turns: [j4Turn()] },
  { id: "SA5", title: "death allowance", messages: [J5_U], turns: [j5Turn()] },
  { id: "SA6", title: "person switch to Grace", messages: [J1_U, J6_U], turns: [j1Turn(), j6Turn()] },
];
