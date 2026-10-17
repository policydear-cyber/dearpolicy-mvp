/**
 * Reliable chat (actual-library findings after d549a27): the reported conversations as scripted model moves over the
 * anonymised booklet household (./booklet.ts). The moves follow the report: the ask_user call with a relevant question
 * but no fact_key and no subject_id; the Other Fracture lookup; a statement naming the Compassionate Death Allowance
 * Benefit. Values, evidence ids and benefit ids come from the real tools. No model call.
 */
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { M, doc } from "./booklet";
import { BKL1A, BKL1B, BKL3 as BKL3_RECORDED } from "./rc-live-5-recorded";

export type BkScenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[] };
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
export const D = M.daniel.id, G = M.grace.id;
export const schedOf = (v: ScriptView, re: RegExp) => [...v.turn].reverse().find((o) => o.name === "person_benefits")?.result?.data?.schedules?.find((s: any) => re.test(s.benefit));
export const evalOf = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "evaluate_benefit")?.result?.data ?? {};
export const hitOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const hit = ((o.result?.data?.hits ?? []) as any[]).find((x) => re.test(JSON.stringify(x))); if (hit) return hit.evidence.evidence_id as string; } return "none"; };

export const BK1_U1 = "Daniel fell off a ladder at home. The doctor says he fractured his hip, or possibly his tibia - they are not sure yet. It is a closed fracture. What can his accident cover pay?";
export const BK1_U2 = "The scan confirms it was his hip.";
/** BK1: an uncertain hip / tibia case. Turn 1 as recorded: the evaluation needs the case; the model asks a relevant
 * question with no fact_key and no subject_id. `fixed` (after the repair): the model passes the requirement_id the
 * evaluation returned instead. `stall`: after the ask, the model makes no further useful call (the budget runs out). */
export function bk1Turns(mode: "recorded" | "requirement" | "stall" = "recorded"): ScriptTurn[] {
  const ask = (v: ScriptView) => {
    const s = schedOf(v, /^Simple Fracture$/); const e = evalOf(v);
    const args: Record<string, unknown> = { kind: "fact", question: "Was it Daniel's hip or his tibia that was fractured?", statements: [{ kind: "benefit_terms", benefit_id: s?.benefit_id }] };
    if (mode === "requirement") args.requirement_id = e.requirement_id;
    return [call("ask_user", args)];
  };
  const t1: ScriptTurn = { user: BK1_U1, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "fractured his hip, or possibly his tibia", words: "fractured his hip, or possibly his tibia" }, { key: "how_it_happened", value: "fell off a ladder at home", words: "fell off a ladder at home" }] })],
    () => [call("person_benefits", { subject_id: D, topic: "simple fracture hip tibia accident" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: schedOf(v, /^Simple Fracture$/)?.benefit_id, purpose: "claim", case: "hip or possibly his tibia", fact_keys: ["injury"] })],
    // stall: the model never asks -- it keeps looking (the turn's model-use budget runs out with the requirement open)
    ...(mode === "stall" ? Array.from({ length: 14 }, () => () => [call("search_passages", { subject_id: D, query: "fracture hip tibia", k: 4 })]) : [ask]),
    // as recorded: the refusal sent the model round again (same question, still no fact_key); then the turn's budget
    ...(mode === "recorded" ? [ask, ask, ask, ask, ask, ask, ask, ask, ask, ask, ask, ask] : []),
  ] };
  const t2: ScriptTurn = { user: BK1_U2, steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "fracture_site", value: "hip", words: "The scan confirms it was his hip." }] }), call("person_benefits", { subject_id: D, topic: "simple fracture hip" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: schedOf(v, /^Simple Fracture$/)?.benefit_id, purpose: "claim", case: "his hip", fact_keys: ["fracture_site"] })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-" }], next_steps: ["contact:" + doc("CERT").id] })],
  ] };
  return mode === "stall" ? [t1] : [t1, t2];
}

export const BK2_U = "Daniel's hip fracture turned out to be a compound (open) fracture. What would the Other Fracture benefit pay?";
/** BK2: Other Fracture -- a percentage of the Sum Insured printed in a generic booklet holding several products. */
export function bk2Turns(subject = D): ScriptTurn[] {
  return [{ user: subject === D ? BK2_U : /Other Fracture/, steps: [
    () => [call("note_facts", { subject_id: subject, facts: [{ key: "injury", value: "compound hip fracture", words: subject === D ? "hip fracture turned out to be a compound (open) fracture" : "a compound fracture of the hip" }] }), call("person_benefits", { subject_id: subject, topic: "other fracture compound hip" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: subject, benefit_id: schedOf(v, /^Other Fracture$/)?.benefit_id, purpose: "claim", case: "hip", fact_keys: ["injury"] })],
    (v: ScriptView) => { const e = evalOf(v); const s = schedOf(v, /^Other Fracture$/);
      return [call("final_answer", { subject_id: subject, sentences: e.result_id ? [{ kind: "calculation", result_id: e.result_id, text: "-" }] : [{ kind: "benefit_terms", benefit_id: s?.benefit_id, text: "-" }], next_steps: ["contact:" + doc("CERT").id] })]; },
  ] }];
}
export const BK2G_U = "Grace had a compound fracture of the hip. What would Other Fracture pay for her?";

export const BK3_U = "If Daniel died in an accident, is there anything to help with funeral costs?";
/** BK3: a statement naming the Compassionate Death Allowance Benefit, citing the page-9 passage (heading above it). */
export function bk3Turns(text = "The Group Insurance Benefits Booklet's Compassionate Death Allowance Benefit pays the funeral expenses incurred, up to $2,000, if Daniel dies as a result of an Accident within 365 days, on receipt of proof of death and the original receipts.", subject = D): ScriptTurn[] {
  return [{ user: /funeral|died|death/i, steps: [
    () => [call("person_benefits", { subject_id: subject, topic: "death accident funeral" }), call("search_passages", { subject_id: subject, query: "Compassionate Death Allowance funeral expenses proof of death", policy_ids: [doc("BOOKLET").id], k: 4 })],
    (v: ScriptView) => [call("final_answer", { subject_id: subject, sentences: [{ kind: "fact", text, evidence_ids: [hitOf(v, /funeral/)], benefit: "Compassionate Death Allowance Benefit" }], next_steps: ["contact:" + doc("CERT").id] })],
  ] }];
}

/** Controls for the server-owned requirement: `wrong` -- the model's ask_user names another person, an unknown or a
 * stale requirement, or another fact; each is refused, then the real requirement is asked. */
export function bk1Controls(kind: "person" | "unknown" | "fact"): ScriptTurn[] {
  const base = bk1Turns("requirement")[0];
  const bad = (v: ScriptView) => { const e = evalOf(v); const s = schedOf(v, /^Simple Fracture$/);
    const args: Record<string, unknown> = { kind: "fact", question: "Was it Daniel's hip or his tibia that was fractured?", statements: [{ kind: "benefit_terms", benefit_id: s?.benefit_id }], requirement_id: e.requirement_id };
    if (kind === "person") args.subject_id = G; if (kind === "unknown") args.requirement_id = "q9_9"; if (kind === "fact") args.fact_key = "admission_datetime";
    return [call("ask_user", args)]; };
  return [{ user: base.user, steps: [...base.steps.slice(0, 3), bad, base.steps[3]] }];
}
/** A stale requirement: turn 2 asks with the requirement id turn 1's evaluation created (no evaluation this turn). */
export function bk1Stale(): ScriptTurn[] {
  let first = "";
  const t1 = bk1Turns("requirement")[0];
  const s3 = t1.steps[3];
  return [{ user: t1.user, steps: [...t1.steps.slice(0, 3), (v: ScriptView) => { first = evalOf(v).requirement_id; return s3(v); }] },
    { user: "I'm not sure yet.", steps: [
      () => [call("ask_user", { kind: "fact", question: "Was it Daniel's hip or his tibia that was fractured?", requirement_id: first })],
      () => [call("final_answer", { subject_id: D, sentences: [{ kind: "fact", text: "No problem." }] })],
    ] }];
}
/** Adjacent section, another product and an unsupported currency, stated for the Compassionate Death Allowance. */
export const BK3_ADJACENT = "The Group Insurance Benefits Booklet's Compassionate Death Allowance Benefit pays up to $5,000 for bringing Daniel's body home if death occurs overseas.";
export const BK3_SGD = "The Group Insurance Benefits Booklet's Compassionate Death Allowance Benefit pays the funeral expenses incurred, up to S$2,000, if Daniel dies as a result of an Accident within 365 days, on receipt of proof of death.";
/** BK4: a fact question citing the page-9 clause (the reason quoted must be a complete sentence). */
export function bk4Turns(): ScriptTurn[] {
  return [{ user: /funeral|died|death/i, steps: [
    () => [call("search_passages", { subject_id: D, query: "Compassionate Death Allowance bodily injury Accident death within 365 days", policy_ids: [doc("BOOKLET").id], k: 4 })],
    (v: ScriptView) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "how_it_happened", question: "How did Daniel's death come about?", because_evidence_ids: [hitOf(v, /bodily injury/)] })],
  ] }];
}

/** The browser replay (e2e/tests/reliable-chat-booklet.spec.ts, E2E_RAG2_HOUSEHOLD=booklet): the reported calls. */
export const BOOKLET_SCENARIOS = (): BkScenario[] => [
  { id: "BK1", title: "uncertain hip / tibia: the recorded ask_user (no fact_key, no subject_id) -> one question -> the clarified illustration", messages: [BK1_U1, BK1_U2], turns: bk1Turns("recorded") },
  { id: "BK2", title: "Other Fracture: the Personal Accident sum insured, bound by the booklet's product section", messages: [BK2_U], turns: bk2Turns() },
  { id: "BK3", title: "the Compassionate Death Allowance Benefit: heading + wrapped paragraph, bare $", messages: [BK3_U], turns: bk3Turns() },
  // PR #54 follow-up: the rc-live-5 failures, with the model's recorded calls (./rc-live-5-recorded.ts)
  ...([["RL1a", BKL1A], ["RL1b", BKL1B]] as const).map(([id, turns]) => ({ id, title: `rc-live-5 ${id === "RL1a" ? "BKL1a" : "BKL1b"} as recorded: closed hip / tibia -> one case question -> S$3,750, no Other Fracture question`, messages: turns.map((t) => t.user as string), turns: [...turns] })),
  { id: "RL3", title: "rc-live-5 BKL3 as recorded: the allowance, and the dated certificate listing instead of a false enrolment caveat", messages: [BKL3_RECORDED[0].user as string], turns: BKL3_RECORDED },
];
