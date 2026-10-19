/**
 * dj-live-4 open-question layout control (browser): the death followed an ACCIDENT and the Accidental Death wording counts 365
 * days from it, no date given -> the question is genuinely useful and is asked, with the supported insurer-contact step shown
 * alongside it. Scripted model, no model call. Served as scenario `DIQ` over the deathvalues household.
 */
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { D } from "./death-journey-conversations";

const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
export const DIQ_USER = "Daniel was in a road accident and passed away. What would the family receive from his insurance, and what should we do?";
export const DIQ_QUESTION = "On what date did the accident happen?";
const idWhere = (v: ScriptView, re: RegExp): string[] => { const out: string[] = []; const walk = (x: any) => { if (!x || typeof x !== "object") return; if (typeof x.evidence_id === "string" && Object.values(x).some((f) => typeof f === "string" && re.test(f))) out.push(x.evidence_id); for (const k of Object.keys(x)) walk(x[k]); }; for (const o of v.turn) if (o.name === "search_passages") walk(o.result); return [...new Set(out)]; };
const benefitIdOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") for (const d of o.result?.data?.documents ?? []) for (const b of d.benefits ?? []) if (re.test(b.benefit) && b.benefit_id) return b.benefit_id as string; return ""; };
export const DIQ_TURN = (): ScriptTurn => ({ user: DIQ_USER, steps: [
  () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "road accident", words: "Daniel was in a road accident and passed away" }, { key: "death", value: "passed away", words: "passed away" }] }), call("person_benefits", { subject_id: D, topic: "accidental death" }), call("search_passages", { subject_id: D, query: "death within 365 days of the Accident" })],
  (vv: ScriptView) => [call("ask_user", { kind: "fact", fact_key: "accident_date", question: DIQ_QUESTION, subject_id: D, because_evidence_ids: idWhere(vv, /365 days/).slice(0, 1), statements: [{ kind: "benefit_terms", benefit_id: benefitIdOf(vv, /Accidental Death/i), subject_id: D }] })],
] });
export const DIQ_SCENARIO = () => ({ id: "DIQ", title: "open date question with the contact step", messages: [DIQ_USER], turns: [DIQ_TURN()] });
