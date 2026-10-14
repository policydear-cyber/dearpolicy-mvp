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
export const LIVELIB_SCENARIOS: LivelibScenario[] = [L1];
