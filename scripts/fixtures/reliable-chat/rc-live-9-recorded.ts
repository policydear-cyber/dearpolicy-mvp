/**
 * PR #54 (after rc-live-9): the model's RECORDED moves for rc-live-9 FL5a and FL5b (docs/rag-migration/live/
 * RUN-rc-live-9-booklet-cda-2026-10-17T12-15-21), as scripted turns over the recorded booklet fixture (BOOKLET_CDA=
 * recorded). Evidence ids are the ids the run assigned (the same calls on the same documents assign the same ids); the
 * next step is the model's "contact:<certificate>" request, which the saved transcript shows as the server wrote it.
 */
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import * as B from "./booklet";
export const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
export const D = B.M.daniel.id;
export const BOOKLET = B.doc("BOOKLET").id, SUMMARY = B.doc("SUMMARY")?.id ?? ""; // (the separate summary exists in the recorded fixture only)
export const STEP = "Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.";
export const FL5A_U = "If Daniel died in an accident, what would our booklet pay towards his funeral, and what documents would the insurer want from us?";
export const FL5B_U = "Say Daniel passed away after an accident. Would the booklet cover any of the funeral costs, and how much? What proof would the insurer ask us for?";
/** The booklet allowance's benefit_id as person_benefits offered it this turn. */
export const cdaId = (v: ScriptView) => { for (const o of v.turn) if (o.name === "person_benefits" && o.ok) for (const d of (o.result?.data?.documents ?? []) as any[]) if (d.policy_id === BOOKLET) for (const b of d.benefits ?? []) if (/^Compassionate Death Allowance Benefit$/.test(b.benefit)) return b.benefit_id as string; return "none"; };
export const terms = (v: ScriptView, ev: string[]) => ({ kind: "benefit_terms", text: "(server-written)", benefit: "Compassionate Death Allowance Benefit", value_ids: [], benefit_id: cdaId(v), subject_id: D, evidence_ids: ev });
// (the saved transcript shows the next step as the server wrote it: the model asked for "contact:<its certificate>")
const final = (sentences: (v: ScriptView) => Record<string, unknown>[]) => (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: sentences(v), next_steps: ["contact:" + B.doc("CERT").id] })];

/** rc-live-9 FL5a as recorded (evidence ids as the run assigned them: the same calls on the same documents). */
export function fl5aTurns(third = "The benefit can be claimed under either the Core Scheme or the Voluntary Scheme, but not both."): ScriptTurn[] {
  return [{ user: /funeral/i, steps: [
    () => [call("resolve_person", { mention: "Daniel" })],
    () => [call("note_facts", { subject_id: D, facts: [{ key: "event_scenario", value: "Daniel died in an accident", words: "If Daniel died in an accident" }] })],
    () => [call("person_benefits", { subject_id: D, topic: "accidental death and funeral expenses" })],
    () => [call("search_passages", { subject_id: D, k: 10, query: "Compassionate Death Allowance Benefit proof of death relevant documents prescribed form claim documents funeral expenses", policy_ids: [BOOKLET, SUMMARY] })],
    final((v) => [terms(v, ["e4", "e10"]),
      { kind: "fact", text: "The booklet does not list the specific documents or forms required beyond proof of death and relevant documents in the prescribed form.", evidence_ids: ["e10"] },
      { kind: "fact", text: third, evidence_ids: ["e10"] }]),
    final(() => []),
  ] }];
}
const FL5B_UNC = "The uploaded certificate does not show whether Daniel is enrolled in the Core or Voluntary Scheme, and the booklet says the certificate shows which products and amounts apply; so these documents do not establish that this funeral benefit applies to him.";
/** rc-live-9 FL5b as recorded: the first final_answer (sent back by the save-time check), then the second. */
/** The evidence id person_benefits gave the booklet allowance's record this turn (for a person whose turn assigns other ids). */
export const cdaEv = (v: ScriptView) => { for (const o of v.turn) if (o.name === "person_benefits" && o.ok) for (const d of (o.result?.data?.documents ?? []) as any[]) if (d.policy_id === BOOKLET) for (const b of d.benefits ?? []) if (/^Compassionate Death Allowance Benefit$/.test(b.benefit)) return b.evidence?.evidence_id as string; return "none"; };
export function fl5bTurns(unc = FL5B_UNC, subject = D, recordedIds = true): ScriptTurn[] {
  const rest = (v: ScriptView) => [{ kind: "uncertainty", text: unc, subject_id: subject, evidence_ids: recordedIds ? ["e1", "e14"] : [cdaEv(v)] },
    { kind: "fact", text: "The booklet specifies proof of death and relevant documents in the insurer’s prescribed form, but does not list the particular documents required.", subject_id: subject, evidence_ids: recordedIds ? ["e12"] : [cdaEv(v)] }];
  return [{ user: /funeral/i, steps: [
    () => [call("resolve_person", { mention: "Daniel" })],
    () => [call("note_facts", { subject_id: subject, facts: [{ key: "death", value: "passed away", words: "Daniel passed away" }, { key: "how_it_happened", value: "after an accident", words: "after an accident" }] })],
    () => [call("person_benefits", { subject_id: subject, topic: "death after an accident; funeral expenses or funeral benefit; proof or documents required for a claim" })],
    () => [call("policies_for", { subject_id: subject, topic: "death after an accident" })],
    () => [call("search_passages", { subject_id: subject, k: 10, query: "Compassionate Death Allowance Benefit funeral expenses proof of death relevant documents prescribed form Core Scheme Voluntary Scheme claim documents proof insurer requires", policy_ids: [BOOKLET, SUMMARY] })],
    final((v) => [terms(v, ["e4"]), { kind: "fact", text: "The booklet prints a bare “$” and does not specify the currency, while the separate Insurance Benefits Summary lists up to S$2,000 for this benefit.", benefit: "Compassionate Death Allowance Benefit", subject_id: subject, evidence_ids: ["e4", "e6"] }, ...rest(v)]),
    final((v) => [terms(v, ["e4"]), ...rest(v)]),
  ] }];
}
