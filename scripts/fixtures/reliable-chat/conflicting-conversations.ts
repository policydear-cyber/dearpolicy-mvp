import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { M, doc } from "./tan";
const J = M.jun.id;
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const schedule = (v: ScriptView) => [...v.turn].reverse().find(o => o.name === "person_benefits")?.result?.data?.schedules?.find((s: any) => /Fracture/.test(s.benefit));
const evaluated = (v: ScriptView) => [...v.turn].reverse().find(o => o.name === "evaluate_benefit")?.result?.data ?? {};
const option = (v: ScriptView, re: RegExp) => schedule(v)?.schedule?.cases?.find((c: any) => re.test(c.case))?.option_id;
export const CONFLICT_USER = "Jun fractured his shin and thigh in a fall. What could the fracture benefit pay?";
export const CORRECTED_USER = "Sorry, I was wrong: only his shin bone was fractured, not his thigh.";
export function conflictingTurns(first = CONFLICT_USER): ScriptTurn[] {
  return [
    { user: first, steps: [
      () => [call("note_facts", {subject_id:J, facts:[{key:"injury", value:first, words:first},{key:"how_it_happened",value:"fall",words:"fall"}]}), call("person_benefits", {subject_id:J,topic:"fracture"})],
      (v: ScriptView) => [call("evaluate_benefit", {subject_id:J, benefit_id:schedule(v)?.benefit_id, purpose:"claim", option_id:option(v,/thigh/), fact_keys:["injury"]})],
      (v: ScriptView) => [call("ask_user", {subject_id:J, kind:"fact", fact_key:"fracture_target", statements:[{kind:"benefit_terms", benefit_id:schedule(v)?.benefit_id}], question:"Which bone should I use for this illustration?", because_evidence_ids:[schedule(v)?.evidence?.evidence_id]})],
    ] },
    { user: CORRECTED_USER, steps: [
      () => [call("note_facts", {subject_id:J, facts:[{key:"injury",value:"shin bone",words:"only his shin bone was fractured, not his thigh"}]}), call("person_benefits", {subject_id:J,topic:"fracture"})],
      (v: ScriptView) => [call("evaluate_benefit", {subject_id:J, benefit_id:schedule(v)?.benefit_id,purpose:"claim",option_id:option(v,/below the knee/),fact_keys:["injury"]})],
      (v: ScriptView) => [call("final_answer", {subject_id:J,sentences:[{kind:"calculation",result_id:evaluated(v).result_id,text:"-"}],next_steps:["contact:"+doc("SCHEDULE").id]})],
    ] },
  ];
}

