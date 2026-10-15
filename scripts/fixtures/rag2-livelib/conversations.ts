/**
 * V1.5: scripted conversations on the live-library household (./household.ts) for the browser spec
 * e2e/tests/rag2-livelib.spec.ts (E2E_RAG2_HOUSEHOLD=livelib). Scripted moves -- PLUMBING evidence, not model results.
 */
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
export type LivelibScenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[] };
export const INVENTORY_ASK = "List all our uploaded documents and their roles, including any files that could not be read.";
const peopleOf = (v: ScriptView) => (([...v.turn].reverse().find((x) => x.name === "household_documents")?.result?.data?.people ?? []) as any[]);
const L1: LivelibScenario = { id: "L1", title: "inventory: the reply names every readable document itself", messages: [INVENTORY_ASK], turns: [
  { user: "uploaded documents", steps: [
    () => [call("household_documents", {})],
    (v) => [call("final_answer", { sentences: peopleOf(v).map((p: any) => ({ text: `${p.short}: ${(p.documents as any[]).filter((d) => d.readable === "ready").map((d) => d.name).join("; ")}.`, evidence_ids: (p.documents as any[]).map((d) => d.evidence?.evidence_id).filter(Boolean) })) })],
  ] },
] };
/** V1.5: an answer saved with four next steps, one of them a repeat of the first (spacing and case aside): the page shows
 * the three distinct steps in their saved order. */
export const STEPS_ASK = "Hypothetically, Adrian died in a car accident in Japan. What can I do?";
export const STEPS_SAVED = [
  "Notify Kestrel Life Ltd of the death and ask which claim forms they need.",
  "Ask the employer or scheme administrator for the certificate in force on the date of death.",
  "  notify kestrel life ltd of the death and ask which claim forms they need. ",
  "Keep the death certificate and any repatriation receipts together.",
];
const pbOf = (v: ScriptView) => { const o = [...v.turn].reverse().find((x) => x.name === "person_benefits"); return ((o?.result?.data?.documents ?? []) as any[]).flatMap((d) => (d.benefits as any[]).map((b) => ({ ...b }))); };
const L2: LivelibScenario = { id: "L2", title: "next steps: every saved step displayed, in order, each once", messages: [STEPS_ASK], turns: [
  { user: "car accident in Japan", steps: [
    () => [call("person_benefits", { subject_id: "7e600000-0000-4000-8000-000000000001" })],
    (v) => [call("final_answer", { subject_id: "7e600000-0000-4000-8000-000000000001", sentences: [{ text: "Adrian’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.", value_ids: [pbOf(v).find((b) => /Term Life/.test(b.benefit) && b.value_id)?.value_id], subject_id: "7e600000-0000-4000-8000-000000000001" }], next_steps: STEPS_SAVED })],
  ] },
] };
export const LIVELIB_SCENARIOS: LivelibScenario[] = [L1, L2];
