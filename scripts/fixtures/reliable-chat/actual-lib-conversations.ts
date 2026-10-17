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
/** J3b (sa-live-2 SBp, the real model): the uncertain report is recorded under one fact key and NO question is pending when the
 * household clarifies; the clarification is recorded under ANOTHER key. It still settles the case. */
export const J3B_U1 = "Daniel hurt himself in a fall at home last night. The hospital thinks he broke either his hip or the lower leg bone, they are still waiting on scans, and it looks like a closed fracture. What would his accident insurance give him?";
export const J3B_U2 = "Update: it is definitely the lower leg, the tibia.";
export const j3bTurns = (): ScriptTurn[] => [
  { user: J3B_U1, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "fell at home", words: "hurt himself in a fall at home last night" }, { key: "fracture_site_uncertain", value: "hip or lower leg bone", words: "The hospital thinks he broke either his hip or the lower leg bone" }] })],
    () => [call("person_benefits", { subject_id: D, topic: "accident fracture" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "either his hip or the lower leg bone", fact_keys: ["fracture_site_uncertain", "how_it_happened"] })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: sfOf(v)?.benefit_id }, { kind: "uncertainty", text: "The scans have not yet established which listed fracture case applies, so the documents do not yet establish which percentage applies or what the benefit would work out to.", evidence_ids: [] }] })],
  ] },
  { user: J3B_U2, steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "fracture_site_detail", value: "tibia (lower leg)", words: "it is definitely the lower leg, the tibia" }] })],
    () => [call("person_benefits", { subject_id: D, topic: "closed tibia fracture" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "the tibia (lower leg)", assumption_words: "it is definitely the lower leg, the tibia", fact_keys: ["fracture_site_detail", "how_it_happened"] })],
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
/** J5s (PR #54 report: the product summary's footnote quote stopped at "Core Scheme or Voluntary"): the same death question stated from the PRODUCT SUMMARY's Compassionate Death Allowance row, whose footnote wraps onto the next line. */
const cdaOfSummary = (v: ScriptView) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") for (const d of o.result?.data?.documents ?? []) if (d.policy_id === A.doc("PRODUCT_SUMMARY").id) for (const b of d.benefits ?? []) if (/Compassionate Death/.test(b.benefit)) return b.benefit_id; return null; };
export const j5sTurn = (): ScriptTurn => ({ user: J5_U, steps: [
  () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death after an accident; funeral expenses" })],
  (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: cdaOfSummary(v) }], next_steps: ["contact:" + CERT] })],
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
  { id: "SA7", title: "SBa replay: the model never asked the question", messages: [SBA_U1, SBA_U2], turns: sbaTurns() },
];

/** Round 3 (PR #55 follow-up): sa-live-3 SBa replayed from its recorded tool calls (docs/rag-migration/live/RUN-sa-live-3-<timestamp>/conv-SBa.json,
 * turn 1, saved trace): the model identified the ambiguity, called ask_user for the requirement (refused by the server: the cause
 * "how it happened" had not been recorded -- the model's first note_facts quoted the message with an ellipsis), retried with a second
 * refused note_facts, and ended with final_answer and NO question. The recorded evidence ids are replaced by the fixture's own;
 * everything else is the recorded arguments. */
export const SBA_U1 = "Daniel fell and the doctor says he fractured his hip, or possibly his tibia - they are not sure yet. It is a closed fracture from an accident at home. What would his accident cover pay?";
export const SBA_U2 = "The scan shows it is the tibia.";
export const sbaTurns = (): ScriptTurn[] => [
  { user: SBA_U1, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "fell at home", words: "Daniel fell ... from an accident at home" }, { key: "injury", value: "fractured his hip, or possibly his tibia - they are not sure yet", words: "fractured his hip, or possibly his tibia - they are not sure yet" }, { key: "fracture_type", value: "closed fracture", words: "It is a closed fracture" }, { key: "cause_words", value: "from an accident at home", words: "from an accident at home" }] }), call("person_benefits", { subject_id: D, topic: "accident fracture" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: paOf(v)?.benefit_id, purpose: "claim", case: "hip or possibly tibia; they are not sure yet", assumption_words: "fractured his hip, or possibly his tibia - they are not sure yet", fact_keys: ["injury", "fracture_type", "cause_words"] }), call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "hip or possibly tibia; they are not sure yet", assumption_words: "fractured his hip, or possibly his tibia - they are not sure yet", fact_keys: ["injury", "fracture_type", "cause_words"] })],
    (v: ScriptView) => [call("ask_user", { kind: "fact", subject_id: D, requirement_id: evals(v)[0]?.requirement_id, question: "Has the doctor confirmed whether Daniel’s fracture is in his hip or his lower leg (shin/tibia)?", statements: [{ kind: "benefit_terms", benefit_id: paOf(v)?.benefit_id }, { kind: "benefit_terms", benefit_id: sfOf(v)?.benefit_id }] })],
    () => [call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "Daniel fell at home", words: "Daniel fell at home" }] })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: paOf(v)?.benefit_id }, { kind: "benefit_terms", benefit_id: sfOf(v)?.benefit_id }, { kind: "uncertainty", text: "The doctor has not yet settled which listed case applies, so the documents do not establish which percentage applies or an amount for Daniel; the certificate’s dated sum insured does not confirm cover on a later date.", evidence_ids: [] }], next_steps: [] })],
  ] },
  { user: SBA_U2, steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "injury_detail", value: "tibia", words: "it is the tibia" }] }), call("person_benefits", { subject_id: D, topic: "closed tibia fracture" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: paOf(v)?.benefit_id, purpose: "claim", case: "the tibia", assumption_words: "it is the tibia", fact_keys: ["injury_detail"] }), call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "the tibia", assumption_words: "it is the tibia", fact_keys: ["injury_detail"] })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: calcs(v), next_steps: ["contact:" + CERT] })],
  ] },
];

/** Round 3: clarification-provenance controls. Each keeps a relationship scoped to person, event and benefit. */
// (a) a SECOND injury reported after a first one: it is reported under its own key, evaluated for its own case
export const P_A_U2 = "He also hurt his wrist in the same fall - another closed fracture. What would the Simple Fracture benefit give for the wrist?";
export const pSecondInjuryTurn = (): ScriptTurn => ({ user: P_A_U2, steps: [
  () => [call("note_facts", { subject_id: D, facts: [{ key: "second_injury", value: "closed wrist fracture", words: "He also hurt his wrist in the same fall - another closed fracture" }] }), call("person_benefits", { subject_id: D, topic: "wrist fracture" })],
  (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "wrist", assumption_words: "He also hurt his wrist in the same fall - another closed fracture", fact_keys: ["second_injury"] })],
  (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [...calcs(v), { kind: "benefit_terms", benefit_id: sfOf(v)?.benefit_id }], next_steps: [] })],
] });
// (b) Daniel's hip/tibia question is pending; the household asks about GRACE's hip. Grace's hip must not settle Daniel's case.
export const P_B_U1 = J3_U1;
export const P_B_U2 = "And if Grace fractured her hip, what would the Simple Fracture benefit pay for her?";
export const P_B_U3 = "Back to Daniel - what would his Simple Fracture benefit give for the fracture? Same closed fracture.";
export const pSwitchTurns = (): ScriptTurn[] => [
  j3Turns()[0] && { user: P_B_U1, steps: j3Turns()[0].steps },
  { user: P_B_U2, steps: j6Turn().steps },
  { user: P_B_U3, steps: [
    () => [call("person_benefits", { subject_id: D, topic: "closed fracture" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "hip or possibly his tibia", fact_keys: ["injury"] })],
    // the model forgets the question: the server owes it (Daniel's case is still open; Grace's hip settled nothing of his)
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: sfOf(v)?.benefit_id }], next_steps: [] })],
  ] },
];
// (c) a side QUESTION mentioning a body part is not an injury correction
export const P_C_U2 = "Separately, does the Simple Fracture benefit cover a broken hip as well? I am only asking about the policy.";
export const P_C_U3 = "OK. So what would the Simple Fracture benefit work out to for his injury?";
export const pSideQuestionTurns = (): ScriptTurn[] => [
  j1Turn(),
  { user: P_C_U2, steps: [
    () => [call("person_benefits", { subject_id: D, topic: "hip fracture" })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: sfOf(v)?.benefit_id }], next_steps: [] })],
  ] },
  { user: P_C_U3, steps: [
    () => [call("person_benefits", { subject_id: D, topic: "closed tibia fracture" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: sfOf(v)?.benefit_id, purpose: "claim", case: "tibia", fact_keys: ["injury"] })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: calcs(v), next_steps: [] })],
  ] },
];
