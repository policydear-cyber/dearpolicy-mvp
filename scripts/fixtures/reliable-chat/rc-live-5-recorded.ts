/**
 * PR #54 follow-up: the model's tool calls in the real-model run rc-live-5 (docs/rag-migration/reliable-chat/live/
 * RUN-rc-live-5-booklet-2026-10-16T16-56-18, conv-BKL1a/BKL1b/BKL3.json), grouped into model steps as the relay log
 * recorded them, for replay through the real chat route without a model call. Synthetic household (./booklet.ts).
 * Only ids that are issued per run are substituted at replay time: a calculation's result_id (the same benefit's result
 * in the replay) and the evidence ids a statement cites (the same passage in the replay). Benefit ids, case words, fact
 * keys, questions and requirement ids are as recorded.
 */
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

const D = "7b000000-0000-4000-8000-000000000001";
const BOOKLET = "7b000000-0000-4000-8000-000000000102";
export const SIMPLE = "b552ce93447", OTHER = "b20810a4efc";
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
/** This turn's result_id of a benefit's evaluation (what a recorded result_id stood for). */
const resultOf = (v: ScriptView, bid: string) => [...v.turn].reverse().find((o) => o.name === "evaluate_benefit" && o.args.benefit_id === bid && o.result?.data?.result_id)?.result?.data?.result_id as string | undefined;
const hit = (v: ScriptView, re: RegExp): string | null => { for (const o of [...v.turn].reverse()) if ((o.name === "search_passages" || o.name === "policies_for" || o.name === "person_benefits") && o.ok) { const m = JSON.stringify(o.result?.data ?? {}).match(new RegExp(`"evidence_id":"(e\\d+)"[^{}]*?${re.source}|${re.source}[^{}]*?"evidence_id":"(e\\d+)"`, "i")); if (m) return m[1] ?? m[2]; } return null; };
/** benefit_terms statements are written by the server from the benefit id (the recorded text and ids are not needed). */
const terms = (bid: string) => ({ kind: "benefit_terms", benefit_id: bid, subject_id: D });
const calcStmt = (v: ScriptView, bid: string, text: string) => ({ kind: "calculation", text, result_id: resultOf(v, bid) ?? "missing", subject_id: D });

const T1_USER = "Daniel slipped in the bathroom and broke a bone. The doctor thinks it is his hip but it could be his tibia; they are still checking. It is a closed fracture. What could his accident cover pay?";
const T2_USER = "Update: the X-ray confirms it is his hip.";
const evalBoth = (fk: string, keys: string[], words: string) => [SIMPLE, OTHER].map((bid) => call("evaluate_benefit", { case: "hip or tibia; they are still checking", purpose: "claim", fact_keys: keys, benefit_id: bid, subject_id: D, assumption_words: words }));

/** BKL1a as recorded: turn 1 [resolve, note, person_benefits] [evaluate x2, search] [ask_user q1_1]; turn 2 [note,
 * evaluate x2] [ask_user q2_1 -- the Other Fracture question for the insurer]. */
export const BKL1A: ScriptTurn[] = [
  { user: T1_USER, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { facts: [{ key: "how_it_happened", value: "slipped in the bathroom", words: "Daniel slipped in the bathroom" }, { key: "injury", value: "broke a bone", words: "broke a bone" }, { key: "possible_bone", value: "hip or tibia; they are still checking", words: "The doctor thinks it is his hip but it could be his tibia; they are still checking." }, { key: "fracture_type", value: "closed fracture", words: "It is a closed fracture." }], subject_id: D }), call("person_benefits", { topic: "accident cover fracture", subject_id: D })],
    () => [...evalBoth("possible_bone", ["possible_bone", "fracture_type"], "The doctor thinks it is his hip but it could be his tibia; they are still checking."), call("search_passages", { k: 10, query: "Simple Fracture Other Fracture closed fracture conditions X-ray registered medical practitioner", subject_id: D })],
    () => [call("ask_user", { kind: "fact", question: "Which listed fracture case is Daniel’s: Hip or Jaw, Pelvis, Leg, Ankle or Knee?", statements: [terms(SIMPLE), terms(OTHER)], requirement_id: "q1_1" })],
  ] },
  { user: T2_USER, steps: [
    () => [call("note_facts", { facts: [{ key: "fracture_confirmation", value: "X-ray confirms it is his hip", words: "the X-ray confirms it is his hip." }], subject_id: D }),
      ...[SIMPLE, OTHER].map((bid) => call("evaluate_benefit", { case: "hip", purpose: "claim", fact_keys: ["fracture_confirmation", "injury", "fracture_type", "how_it_happened"], benefit_id: bid, subject_id: D, assumption_words: "the X-ray confirms it is his hip." }))],
    (v: ScriptView) => [call("ask_user", { kind: "fact", question: "Does Daniel’s diagnosis meet the booklet’s definition of “Hip” for the Other Fracture benefit, as determined by the insurer’s medical assessment?",
      statements: [calcStmt(v, SIMPLE, "If the Simple Fracture benefit applies to Daniel Lee Wei Ming (Daniel)'s case “Hip” (as you described: “the X-ray confirms it is his hip.”), the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision."), terms(OTHER)], requirement_id: "q2_1" })],
  ] },
];

/** BKL1b as recorded (the same shape; other fact keys and wording). */
export const BKL1B: ScriptTurn[] = [
  { user: T1_USER, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { facts: [{ key: "how_it_happened", value: "slipped in the bathroom", words: "slipped in the bathroom" }, { key: "injury", value: "broke a bone", words: "broke a bone" }, { key: "possible_injury_site", value: "hip or tibia; they are still checking", words: "The doctor thinks it is his hip but it could be his tibia; they are still checking." }, { key: "fracture_type", value: "closed fracture", words: "It is a closed fracture." }], subject_id: D }), call("person_benefits", { topic: "accident cover fracture", subject_id: D })],
    () => [...evalBoth("possible_injury_site", ["possible_injury_site", "fracture_type"], "The doctor thinks it is his hip but it could be his tibia; they are still checking."), call("search_passages", { k: 10, query: "Simple Fracture Other Fracture closed fracture definition conditions X-ray registered medical practitioner", policy_ids: [BOOKLET], subject_id: D })],
    () => [call("ask_user", { kind: "fact", question: "Which fracture site was confirmed: hip or leg (including the tibia)?", statements: [terms(SIMPLE), terms(OTHER)], subject_id: D, requirement_id: "q1_1" })],
  ] },
  { user: T2_USER, steps: [
    () => [call("note_facts", { facts: [{ key: "fracture_site", value: "hip", words: "the X-ray confirms it is his hip" }], subject_id: D }),
      ...[SIMPLE, OTHER].map((bid) => call("evaluate_benefit", { case: "hip", purpose: "claim", fact_keys: ["fracture_site", "fracture_type", "how_it_happened", "injury"], benefit_id: bid, subject_id: D, assumption_words: "the X-ray confirms it is his hip" }))],
    (v: ScriptView) => [call("ask_user", { kind: "fact", preface: "Thanks for the update.", question: "For Daniel’s Other Fracture benefit, does the confirmed diagnosis meet the booklet’s definition of “Hip” or “Leg”?",
      statements: [calcStmt(v, SIMPLE, "If the Simple Fracture benefit applies to Daniel Lee Wei Ming (Daniel)'s case “Hip” (as you described: “the X-ray confirms it is his hip”), the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision."), terms(OTHER)], requirement_id: "q2_1" })],
  ] },
];

/** BKL3 as recorded: [resolve, note] [person_benefits, policies_for, search] [final_answer: the allowance (fact) and the
 * false enrolment caveat (uncertainty)]. */
export const BKL3: ScriptTurn[] = [
  { user: "If Daniel died in an accident, is there an allowance for funeral expenses in our booklet, and what does it need?", steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { facts: [{ key: "event_scenario", value: "died in an accident", words: "If Daniel died in an accident" }], subject_id: D })],
    () => [call("person_benefits", { topic: "funeral expenses after accidental death", subject_id: D }), call("policies_for", { topic: "funeral expenses accidental death", subject_id: D }), call("search_passages", { k: 10, query: "funeral expenses allowance accidental death funeral benefit requirements", subject_id: D })],
    (v: ScriptView) => { const cda = hit(v, /funeral/) ?? "e8"; const cert = hit(v, /CERTIFICATE OF GROUP INSURANCE|Lee Wei Ming/) ?? cda;
      return [call("final_answer", { sentences: [
        { kind: "fact", text: "The booklet’s Compassionate Death Allowance Benefit says funeral expenses incurred are payable up to $2,000 if bodily injury from an Accident independently results in death within 365 days of the Accident, on receipt of proof of death and the original receipts; it is not payable for death caused by illness.", benefit: "Compassionate Death Allowance Benefit", subject_id: D, evidence_ids: [cda] },
        { kind: "uncertainty", text: "The booklet is reference wording, and the uploaded documents do not confirm Daniel’s enrolment in the group scheme, so they do not establish that this benefit applies to him.", subject_id: D, evidence_ids: [cert] }],
        next_steps: ["Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim."], subject_id: D })]; },
  ] },
];
