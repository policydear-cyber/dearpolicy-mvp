/**
 * V1.5: the three failing conversations of the live verification after PR #50, as scripted model moves for the BROWSER
 * replay (e2e/tests/rag2-pr50.spec.ts, E2E_RAG2_HOUSEHOLD=pr50). The moves are the report's recorded tool calls; the
 * household is scripts/fixtures/rag2-pr50/household.ts (anonymised). scripts/rag2-pr50-regressions.ts runs the same
 * moves, and their negative controls, below the browser. No model call.
 */
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { M, doc } from "./household";

export type Pr50Scenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[] };
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const A = M.adrian.id;
const pbOf = (v: ScriptView) => { const o = [...v.turn].reverse().find((x) => x.name === "person_benefits"); return ((o?.result?.data?.documents ?? []) as any[]).flatMap((d) => (d.benefits as any[]).map((b) => ({ ...b, product: d.product, policy_id: d.policy_id }))); };
const vidOf = (v: ScriptView, re: RegExp) => pbOf(v).find((b) => re.test(b.benefit) && b.value_id)?.value_id as string | undefined;
const hitOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if ((o.name === "search_passages" || o.name === "read_page") && o.ok) { const hits = ((o.result?.data?.hits ?? []) as any[]); const hit = hits.find((x) => re.test(JSON.stringify(x))); if (hit) return hit.evidence.evidence_id as string; if (o.name === "read_page" && re.test(JSON.stringify(o.result))) return (JSON.stringify(o.result).match(/"evidence_id":"(e\d+)"/) ?? [])[1] ?? "none"; } return "none"; };

export const FRACTURE_ASK = "Hypothetical document-arithmetic test for Adrian: in the uploaded Summary of Benefits, Simple Fracture has a S$5,000 limit and a Leg row of 50%. If that provision applies, what is the illustration? Distinguish this from the separate Other Fracture provision and do not promise a payment.";
export const INVENTORY_ASK = "What policies does my family have? List my uploaded documents by person, insurer and product. Distinguish personal certificates from reference wording and unreadable files.";
export const DEATH_ASK = "Hypothetical test: Adrian died in a car accident in Japan. Based on my uploaded documents, what can I do?";

const SUM = () => doc("SUMMARY").id;
let e15 = "none";
const D: Pr50Scenario = { id: "P50D", title: "fixed-limit fracture: the recorded calls (proportion e15, applies_when Leg; base_value_id empty, then v1 = Term Life)", messages: [FRACTURE_ASK], turns: [{ user: FRACTURE_ASK, steps: [
  () => [call("person_benefits", { subject_id: A, topic: "simple fracture leg" })],
  () => [call("search_passages", { query: "Simple Fracture Benefit Limit leg percentage", policy_ids: [SUM()], subject_id: A })],
  (v: ScriptView) => { e15 = hitOf(v, /Compensation \(% of S\$5,000\)/); return [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: SUM(), benefit: "Simple Fracture", condition: "Leg", proportion: { evidence_id: e15, applies_when: "Leg" }, base_value_id: "", assumption_words: "If that provision applies" })]; },
  (v: ScriptView) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: SUM(), benefit: "Simple Fracture", condition: "Leg", proportion: { evidence_id: e15, applies_when: "Leg" }, base_value_id: vidOf(v, /Term Life/), assumption_words: "If that provision applies" })],
  (v: ScriptView) => { const ok = [...v.turn].reverse().find((o) => o.name === "calculate" && o.ok); return [call("final_answer", { subject_id: A, sentences: ok ? [
    { text: "If the Simple Fracture provision applies to a leg fracture, the conditional illustration is S$2,500, which is 50% of the S$5,000 Simple Fracture Benefit Limit; this is not a promise of payment.", result_id: (ok.result as any)?.data?.calc_id ?? (ok.result as any)?.calc_id, subject_id: A },
    { text: "Other Fracture is a separate benefit, a percentage of the Sum Insured rather than of the Simple Fracture Benefit Limit.", evidence_ids: [e15], subject_id: A },
  ] : [{ text: "If the Simple Fracture provision applies to a leg fracture due to an Accident, the illustration would be 50% of the S$5,000 limit, which is S$2,500.", evidence_ids: [e15], subject_id: A }] })]; },
] }] };

const peopleOf = (v: ScriptView) => (([...v.turn].reverse().find((x) => x.name === "household_documents")?.result?.data ?? {}) as any);
const C: Pr50Scenario = { id: "P50C", title: "inventory: the model names every readable document itself (the travel insurer's by file name) and writes its own unreadable-file sentence", messages: [INVENTORY_ASK], turns: [{ user: INVENTORY_ASK, steps: [
  () => [call("household_documents", {})],
  (v: ScriptView) => { const d = peopleOf(v); const ppl = (d.people ?? []) as any[]; const unl = (d.unlinked ?? []) as any[];
    const ev = ppl.flatMap((p) => (p.documents as any[]).map((x) => x.evidence?.evidence_id)).filter(Boolean);
    return [call("final_answer", { sentences: [
      ...ppl.filter((p) => p.documents.length).map((p: any) => ({ text: `${p.short}: ${(p.documents as any[]).map((x) => `${x.name} (${x.insurer}${x.kind === "personal" ? ", personal certificate" : ", reference wording"})`).join("; ")}.`, evidence_ids: (p.documents as any[]).map((x) => x.evidence?.evidence_id).filter(Boolean) })),
      ...ppl.filter((p) => !p.documents.length).map((p: any) => ({ text: `${p.short} has no documents on file.` })),
      { text: `Linked to nobody: ${unl.filter((x) => x.readable === "ready").map((x) => `${x.filename} (${x.insurer}, reference wording)`).join("; ")}.`, evidence_ids: unl.map((x) => x.evidence?.evidence_id).filter(Boolean) },
      { text: `${unl.find((x) => x.readable !== "ready")?.filename} could not be read.`, evidence_ids: ev.slice(0, 1) },
    ] })]; },
] }] };

const Ad: Pr50Scenario = { id: "P50A", title: "death: dated amounts, enrolment uncertainty, and a contact step with an unrelated insurer's clause", messages: [DEATH_ASK], turns: [{ user: DEATH_ASK, steps: [
  () => [call("person_benefits", { subject_id: A, topic: "death after an accident" }), call("read_page", { policy_id: doc("SUMMARY").id, page: 9 })],
  (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [
    { text: "Adrian’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.", value_ids: [vidOf(v, /Term Life/)], subject_id: A },
    { text: "The same certificate lists Group Personal Accident of S$600,000 as of 6 October 2022.", value_ids: [vidOf(v, /^Group Personal Accident$/)], subject_id: A },
    { text: "The documents do not establish that Adrian is enrolled for the Compassionate Death Allowance.", evidence_ids: [hitOf(v, /Compassionate Death Allowance/)], subject_id: A },
  ], next_steps: [
    "Contact Kestrel Life Ltd through the scheme administrator to report the death, and ask Harbourline General whether a travel policy covered the trip.",
    "Contact Harbourline General to claim the travel benefit.",
  ] })],
] }] };

export const PR50_SCENARIOS: Pr50Scenario[] = [D, C, Ad];
