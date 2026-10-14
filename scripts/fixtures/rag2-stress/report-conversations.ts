/**
 * V1.3: scripted conversations on the report-layout household (./report-household.ts), shared by the model-free suite
 * (scripts/rag2-stress-report-regressions.ts) and the browser spec (e2e/tests/rag2-stress-report.spec.ts, through
 * e2e/support/rag2-loop-server.ts). The scripted moves are what a capable model does with the tools -- PLUMBING /
 * CONTROL evidence, never a model result. What is asserted is what DearPolicy shows and saves; the expectations are
 * written from the rendered fixture pages (docs/rag-migration/v13/EXPECTED-REPORT.md).
 */
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { doc, M } from "./report-household";

const MK = M.marcus.id, SE = M.serena.id;
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const S = (text: string, o: Record<string, unknown> = {}) => ({ text, ...o });
const ids = (...xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const sel = (key: string, benefit: string, who: string, want = "amount") => call("select_table_value", { policy_id: doc(key).id, benefit, subject_id: who, want });
const vid = (v: ScriptView, key: string, benefit: RegExp, who: string) => { const o = [...v.turn].reverse().find((o) => o.name === "select_table_value" && o.args.policy_id === doc(key).id && benefit.test(String(o.args.benefit)) && o.args.subject_id === who); return o?.ok && o.result.data.valueId ? (o.result.data.valueId as string) : null; };
const hit = (v: ScriptView, text: RegExp, key: string) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = ((o.result.data.hits ?? []) as any[]).find((x) => text.test(`${x.text ?? ""} ${x.evidence?.excerpt ?? ""}`) && x.policyId === doc(key).id); if (h) return h.evidence.evidence_id as string; } return null; };
const calcOf = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "calculate");
const search = (query: string, who: string) => call("search_passages", { query, subject_id: who });

export type ReportScenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[] };

const R1: ReportScenario = { id: "R1", title: "household document inventory", messages: ["What policies does my family have?"], turns: [
  { user: "What policies does my family have?", steps: [
    () => [call("household_documents", {})],
    () => [call("final_answer", { sentences: [S("Here are the documents on file for your household.")] })],
  ] },
] };

const R2: ReportScenario = { id: "R2", title: "direct Personal Accident amount, then a wrong amount corrected", messages: ["How much is my personal accident cover?", "So my personal accident cover is S$1,200,000, right?"], turns: [
  { user: "How much is my personal accident cover?", steps: [
    () => [call("resolve_person", { mention: "me" })],
    () => [sel("CERT", "Group Personal Accident", MK)],
    (v) => [call("final_answer", { subject_id: MK, sentences: [S("Your Group Personal Accident sum assured on the Public Officers Group Scheme certificate is S$450,000 as of 15 September 2023.", { value_ids: ids(vid(v, "CERT", /Personal Accident/, MK)), subject_id: MK })] })],
  ] },
  { user: "S$1,200,000, right?", steps: [
    () => [sel("CERT", "Group Personal Accident", MK), sel("CERT", "Group Term Life", MK)],
    (v) => [call("final_answer", { subject_id: MK, sentences: [S("No: your Group Personal Accident sum assured is S$450,000 as of 15 September 2023; the S$1,200,000 on the certificate is your Group Term Life sum assured.", { value_ids: ids(vid(v, "CERT", /Personal Accident/, MK), vid(v, "CERT", /Term Life/, MK)), subject_id: MK })] })],
  ] },
] };

const FRACTURE = "I fractured my tibia in a fall. It's a simple (closed) fracture. How much could the Simple Fracture benefit pay?";
const COMPOUND = "And if it had been a compound fracture of the leg instead?";
const R3: ReportScenario = { id: "R3", title: "percentage of a fixed benefit limit (Simple Fracture) versus percentage of the Sum Insured (Other Fracture)", messages: [FRACTURE, COMPOUND], turns: [
  { user: "simple (closed) fracture", steps: [
    () => [call("resolve_person", { mention: "I" })],
    () => [call("note_facts", { subject_id: MK, facts: [{ key: "how_it_happened", value: "a fall", words: "in a fall" }, { key: "bone_fractured", value: "tibia", words: "I fractured my tibia" }, { key: "fracture_type", value: "simple", words: "It's a simple (closed) fracture" }] }),
      sel("SUMMARY", "Jaw, Pelvis, Leg, Ankle or Knee", MK, "percent"), sel("CERT", "Group Personal Accident", MK)],
    // The certificate's Personal Accident sum insured is passed too: the server must not use it as the base.
    (v) => [call("calculate", { calculator: "lump_sum", purpose: "claim", subject_id: MK, policy_id: doc("SUMMARY").id, benefit: "Simple Fracture - Jaw, Pelvis, Leg, Ankle or Knee", condition: "a simple fracture of the leg (tibia)", assumption_words: "I fractured my tibia in a fall", percent_value_id: vid(v, "SUMMARY", /Jaw/, MK), sum_insured_value_id: vid(v, "CERT", /Personal Accident/, MK) })],
    (v) => { const c = calcOf(v); return [call("final_answer", { subject_id: MK, sentences: c?.ok && c.result.data.amount != null
      ? [S(`If the Simple Fracture benefit applies to your simple tibia fracture, the indicative illustration is S$${Number(c.result.data.amount).toLocaleString("en-SG")}; it is not an approved payment.`, { result_id: c.result.data.calc_id, subject_id: MK })]
      : [S("I couldn't work out the Simple Fracture amount.", { subject_id: MK })] })]; },
  ] },
  { user: "compound fracture", steps: [
    () => [sel("WORDING", "Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)", MK, "percent"), sel("CERT", "Group Personal Accident", MK)],
    (v) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: MK, policy_id: doc("WORDING").id, benefit: "Other Fracture - Jaw, Pelvis, Leg, Ankle or Knee", condition: "a compound fracture of the leg", assumption_words: "if it had been a compound fracture of the leg instead", percent_value_id: vid(v, "WORDING", /Other Fracture/, MK), sum_insured_value_id: vid(v, "CERT", /Personal Accident/, MK) })],
    (v) => { const c = calcOf(v); return [call("final_answer", { subject_id: MK, sentences: c?.ok && c.result.data.amount != null
      ? [S(`If it had been a compound fracture of the leg and the Other Fracture benefit applied, the illustration would be S$${Number(c.result.data.amount).toLocaleString("en-SG")}; it is not an approved payment.`, { result_id: c.result.data.calc_id, subject_id: MK })]
      : [S("I couldn't work out the Other Fracture amount.", { subject_id: MK })] })]; },
  ] },
] };

const BAD_DATE = "I was admitted to hospital after an accident on 30 February 2026 at 9am and discharged on 2 March 2026 at 9am. Does the Daily Hospital Cash pay anything?";
const GOOD_DATE = "Sorry, I was admitted on 28 February 2026 at 9am and discharged on 2 March 2026 at 9am, Singapore time.";
const R4: ReportScenario = { id: "R4", title: "an invalid date, then a valid correction, and the waiting period decided without a rate", messages: [BAD_DATE, GOOD_DATE], turns: [
  { user: "30 February 2026", steps: [
    () => [call("resolve_person", { mention: "I" })],
    () => [call("note_facts", { subject_id: MK, facts: [{ key: "how_it_happened", value: "an accident", words: "after an accident" }, { key: "admission_datetime", value: "2026-02-30T09:00", words: "admitted to hospital after an accident on 30 February 2026 at 9am" }, { key: "discharge_datetime", value: "2026-03-02T09:00", words: "discharged on 2 March 2026 at 9am" }] }), search("Daily Hospital Cash from the 11th day", MK)],
    (v) => [call("ask_user", { kind: "fact", subject_id: MK, fact_key: "admission_datetime", question: "30 February isn't a calendar date, so on what date were you admitted?", because_evidence_ids: ids(hit(v, /Daily Hospital Cash/, "SUMMARY")) })],
  ] },
  { user: "28 February 2026", steps: [
    () => [call("note_facts", { subject_id: MK, facts: [{ key: "admission_datetime", value: "2026-02-28T09:00+08:00", words: "admitted on 28 February 2026 at 9am" }, { key: "discharge_datetime", value: "2026-03-02T09:00+08:00", words: "discharged on 2 March 2026 at 9am, Singapore time" }] }), search("Daily Hospital Cash from the 11th day", MK)],
    () => [call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: MK, policy_id: doc("SUMMARY").id, benefit: "Daily Hospital Cash", admission: { at: "2026-02-28T09:00+08:00", words: "admitted on 28 February 2026 at 9am" }, discharge: { at: "2026-03-02T09:00+08:00", words: "discharged on 2 March 2026 at 9am, Singapore time" } })],
    (v) => { const c = calcOf(v); return [call("final_answer", { subject_id: MK, sentences: [
      S("The Daily Hospital Cash is payable from the 11th day onwards.", { evidence_ids: ids(hit(v, /Daily Hospital Cash/, "SUMMARY")), subject_id: MK }),
      ...(c?.ok ? [S("Your stay from 28 February to 2 March does not reach the 11th day, so this benefit does not pay for it.", { result_id: c.result.data.calc_id, subject_id: MK })] : []),
    ] })]; },
  ] },
] };

const R5: ReportScenario = { id: "R5", title: "switching the subject between two people", messages: ["What is Serena's personal accident cover?", "And what is my own term life cover?", "Back to Serena: what is her term life cover?"], turns: [
  { user: "Serena's personal accident", steps: [
    () => [call("resolve_person", { mention: "Serena" })],
    () => [sel("CERT", "Group Personal Accident", SE)],
    (v) => [call("final_answer", { subject_id: SE, sentences: [S("Serena's Group Personal Accident sum assured is S$450,000 as of 15 September 2023.", { value_ids: ids(vid(v, "CERT", /Personal Accident/, SE)), subject_id: SE })] })],
  ] },
  { user: "my own term life", steps: [
    () => [call("resolve_person", { mention: "my" })],
    () => [sel("CERT", "Group Term Life", MK)],
    (v) => [call("final_answer", { subject_id: MK, sentences: [S("Your Group Term Life sum assured is S$1,200,000 as of 15 September 2023.", { value_ids: ids(vid(v, "CERT", /Term Life/, MK)), subject_id: MK })] })],
  ] },
  { user: "Back to Serena", steps: [
    () => [call("resolve_person", { mention: "Serena" })],
    () => [sel("CERT", "Group Term Life", SE)],
    (v) => [call("final_answer", { subject_id: SE, sentences: [S("Serena's Group Term Life sum assured is S$1,200,000 as of 15 September 2023.", { value_ids: ids(vid(v, "CERT", /Term Life/, SE)), subject_id: SE })] })],
  ] },
] };

/** The wrong-product reply with NO repair available: the script has no step for the repair request, as when the
 * repair budget is spent. The Term Life figure stated as Personal Accident must not be shown; the supported document
 * and product facts must be. Not a complete answer: the Personal Accident amount is not given. */
const R6: ReportScenario = { id: "R6", title: "Term Life figure stated as Personal Accident, repair unavailable", messages: ["How much is my personal accident cover?"], turns: [
  { user: "personal accident cover", steps: [
    () => [call("resolve_person", { mention: "me" })],
    () => [search("Group Personal Accident Group Term Life sum assured certificate", MK)],
    (v) => [call("final_answer", { subject_id: MK, sentences: [S("Your personal accident cover on the Public Officers Group Scheme certificate is S$1,200,000 as of 15 September 2023.", { evidence_ids: ids(hit(v, /GROUP TERM LIFE/, "CERT")), benefit: "Group Personal Accident", subject_id: MK })] })],
  ] },
] };

export const REPORT_SCENARIOS: ReportScenario[] = [R1, R2, R3, R4, R5, R6];
