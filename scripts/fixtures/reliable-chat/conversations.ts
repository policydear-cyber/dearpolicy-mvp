/**
 * Reliable chat: the first complete conversation (H2 Tan, a percentage of the person's own sum insured) as scripted
 * model moves for the BROWSER slice (e2e/tests/reliable-chat.spec.ts, E2E_RAG2_HOUSEHOLD=tan). The same moves as
 * scripts/reliable-chat-slice.ts V1-V3: find the benefit, explain its terms, ask which bone, evaluate on the server,
 * show the verified illustration, then a correction that withdraws it and re-evaluates. No model call.
 */
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { M, doc } from "./tan";

export type RcScenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[] };
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const pb = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "person_benefits")?.result?.data ?? {};
const scheduleOf = (v: ScriptView, re: RegExp) => ((pb(v).schedules ?? []) as any[]).find((s) => re.test(s.benefit));
const optionOf = (v: ScriptView, re: RegExp) => [...v.turn].reverse().flatMap((o) => [...((o.result?.data?.options ?? []) as any[]), ...(((o.result?.data?.schedules ?? []) as any[]).flatMap((s) => s.schedule?.cases ?? []))]).find((c: any) => re.test(c.case))?.option_id as string;
const evalOf = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "evaluate_benefit")?.result?.data ?? {};

export const TAN_U1 = "Jun broke his leg playing football. What could his accident policy pay?";
export const TAN_U2 = "It was the shin bone.";
export const TAN_U3 = "Sorry, I was wrong - it was his thigh bone, not the shin.";
const J = M.jun.id;

export function fractureTurns(): ScriptTurn[] {
  let sched = "";
  return [
    { user: TAN_U1, steps: [
      () => [call("resolve_person", { mention: "Jun" })],
      () => [call("person_benefits", { subject_id: J, topic: "fracture leg" })],
      (v: ScriptView) => { sched = scheduleOf(v, /Fracture/)?.benefit_id; return [call("note_facts", { subject_id: J, facts: [{ key: "injury", value: "broke his leg", words: "Jun broke his leg playing football" }, { key: "how_it_happened", value: "playing football", words: "Jun broke his leg playing football" }] }), call("evaluate_benefit", { benefit_id: sched, subject_id: J, purpose: "claim", case: "leg", assumption_words: "Jun broke his leg playing football" })]; },
      (v: ScriptView) => { const s = scheduleOf(v, /Fracture/) ?? { evidence: {} }; return [call("ask_user", { kind: "fact", subject_id: J, fact_key: "bone",
        statements: [{ kind: "benefit_terms", benefit_id: sched }, { kind: "fact", text: "The Fracture Benefit is for a Fracture caused by an Accident and confirmed by X-ray.", evidence_ids: [s.evidence?.evidence_id], subject_id: J }],
        question: "Which leg bone was it — the thigh bone (femur), or below the knee (tibia or fibula)?", because_evidence_ids: [s.evidence?.evidence_id] })]; },
    ] },
    { user: TAN_U2, steps: [
      () => [call("note_facts", { subject_id: J, facts: [{ key: "bone", value: "shin bone", words: "It was the shin bone." }] }), call("person_benefits", { subject_id: J, topic: "fracture" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: scheduleOf(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "claim", option_id: optionOf(v, /below the knee/), assumption_words: "Jun broke his leg playing football", fact_keys: ["bone"] })],
      (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-", subject_id: J }], next_steps: [`contact:${doc("SCHEDULE").id}`] })],
    ] },
    { user: TAN_U3, steps: [
      () => [call("note_facts", { subject_id: J, facts: [{ key: "bone", value: "thigh bone", words: "it was his thigh bone, not the shin" }] }), call("person_benefits", { subject_id: J, topic: "fracture" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: scheduleOf(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "claim", option_id: optionOf(v, /thigh/), assumption_words: "Jun broke his leg playing football", fact_keys: ["bone"] })],
      (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-", subject_id: J }] })],
    ] },
  ];
}

export const TAN_U_UNLISTED = "Jun broke his collarbone falling off his bike. What does his accident policy pay?";
/** RC2: a part no listed case covers -- said with the listed cases and a contact step; the question offering the
 * other cases (the live rc-live-1 RCW3 pattern) is refused by the server and never reaches the page. */
export function unlistedTurns(): ScriptTurn[] {
  let st: any = {};
  return [{ user: TAN_U_UNLISTED, steps: [
    () => [call("note_facts", { subject_id: J, facts: [{ key: "injury", value: "broke his collarbone", words: "Jun broke his collarbone" }, { key: "how_it_happened", value: "falling off his bike", words: "falling off his bike" }] }), call("person_benefits", { subject_id: J, topic: "fracture collarbone" })],
    (v: ScriptView) => [call("evaluate_benefit", { benefit_id: scheduleOf(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "claim", case: "collarbone", fact_keys: ["injury"] })],
    (v: ScriptView) => { st = evalOf(v); return [call("ask_user", { kind: "fact", subject_id: J, fact_key: "fracture_case", question: "Which listed fracture case applies to Jun: the thigh bone (femur), below the knee (tibia or fibula), wrist, or finger or toe?", statements: [{ kind: "benefit_terms", benefit_id: st.benefit_id }], because_evidence_ids: [] })]; },
    () => [call("final_answer", { subject_id: J, sentences: [{ kind: "benefit_terms", benefit_id: st.benefit_id, text: "-" }], next_steps: [`contact:${doc("SCHEDULE").id}`] })],
  ] }];
}

export const TAN_SCENARIOS = (): RcScenario[] => [
  { id: "RC1", title: "first complete conversation: benefit -> terms -> question -> server evaluation -> correction", messages: [TAN_U1, TAN_U2, TAN_U3], turns: fractureTurns() },
  { id: "RC2", title: "an unlisted case: said with the listed cases, no question", messages: [TAN_U_UNLISTED], turns: unlistedTurns() },
];
