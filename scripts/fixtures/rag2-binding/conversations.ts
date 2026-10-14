/**
 * V1.4: scripted conversations on the binding household (./household.ts) for the browser spec
 * e2e/tests/rag2-binding.spec.ts (through e2e/support/rag2-loop-server.ts, E2E_RAG2_HOUSEHOLD=binding). The scripted
 * moves are what a capable model does with the tools -- PLUMBING / CONTROL evidence, never a model result.
 */
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { M } from "./household";

const D = M.darren.id, MI = M.michelle.id;
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const pb = (v: ScriptView, who: string) => { const o = [...v.turn].reverse().find((x) => x.name === "person_benefits" && x.args.subject_id === who); return ((o?.result?.data?.documents ?? []) as any[]).flatMap((d) => d.benefits as any[]); };
const vidOf = (v: ScriptView, who: string, re: RegExp) => pb(v, who).find((b) => re.test(b.benefit) && b.value_id)?.value_id as string | undefined;
const evOf = (v: ScriptView, who: string, re: RegExp) => pb(v, who).filter((b) => re.test(b.benefit)).map((b) => b.evidence?.evidence_id as string).filter(Boolean);
export type BindingScenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[] };

const DEATH = "Darren died in a car accident in Japan, what can I do?";
const B1: BindingScenario = { id: "B1", title: "death after a reported accident, the model asking nothing", messages: [DEATH], turns: [
  { user: "died in a car accident", steps: [
    () => [call("resolve_person", { mention: "Darren" })],
    () => [call("person_benefits", { subject_id: D })],
    (v) => [call("final_answer", { subject_id: D, next_steps: ["Keep a copy of the death certificate and the police report from Japan.", "Contact both Meridian Life Ltd and Lumen General to start the claims."], sentences: [
      { text: "Darren's certificate lists his Group Term Life sum assured as S$1,000,000 as of 6 October 2022.", value_ids: [vidOf(v, D, /Term Life/)].filter(Boolean), subject_id: D },
      { text: "The same certificate lists his Group Personal Accident sum insured as S$600,000 as of 6 October 2022.", value_ids: [vidOf(v, D, /^Group Personal Accident$/)].filter(Boolean), subject_id: D },
      { text: "The Group Personal Accident product summary pays Accidental Death at 100% of the Sum Insured if the Insured Person dies as a result of an Accident within 365 days of that Accident.", evidence_ids: evOf(v, D, /Accidental Death/), subject_id: D },
    ] })],
  ] },
] };
const B2: BindingScenario = { id: "B2", title: "switching people and correcting back", messages: ["What is Michelle's personal accident cover?", "Sorry, I meant Darren"], turns: [
  { user: "Michelle's personal accident", steps: [
    () => [call("resolve_person", { mention: "Michelle" })],
    () => [call("person_benefits", { subject_id: MI })],
    (v) => [call("final_answer", { subject_id: MI, sentences: [{ text: "Michelle's certificate lists her Group Personal Accident sum insured as S$300,000 as of 6 October 2022, and Endorsement No. 3 amends her Group Personal Accident Sum Insured to S$400,000 with effect from 1 January 2024; which of the two applies now is not established from the documents.", evidence_ids: evOf(v, MI, /^Group Personal Accident$/), subject_id: MI }] })],
  ] },
  { user: "I meant Darren", steps: [
    () => [call("resolve_person", { mention: "Darren" })],
    () => [call("person_benefits", { subject_id: D })],
    (v) => [call("final_answer", { subject_id: D, sentences: [{ text: "Darren's certificate lists his Group Personal Accident sum insured as S$600,000 as of 6 October 2022.", value_ids: [vidOf(v, D, /^Group Personal Accident$/)].filter(Boolean), subject_id: D }] })],
  ] },
] };
export const BINDING_SCENARIOS: BindingScenario[] = [B1, B2];
