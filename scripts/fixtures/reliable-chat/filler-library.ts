/**
 * Test-only: a LARGER library for latency measurement. The filler documents are INVENTED generic wording in the layouts the
 * stored pages use (numbered clauses, bullet rows with tab cells, "(% of ...)" tables); none is a reproduction of any real
 * document, and none prints anything about the benefits the death/fracture journeys are about. They exist so that loading,
 * tokenising and parsing cost scales the way a real household library does.
 */
import type { FxDoc } from "../rag2/household";
import * as DJ from "./death-journey";

const clause = (n: number, i: number) => [
  `${n}. ${["General conditions", "Claims procedure", "Exclusions", "Definitions", "Premium and renewal", "Cancellation", "Notice", "Currency"][i % 8]}`,
  `${n}.1 The Insured Person shall give notice to the Company within thirty (30) days of the event giving rise to a claim, and shall provide the information the Company reasonably requires.`,
  `${n}.2 The Company shall not be liable for any loss arising from circumstances set out in clause ${n + 1} of this wording or in the Schedule of the policy.`,
  `•\tOutpatient visit ${i + 1}\tUp to S$${(i + 1) * 40} per visit`,
  `•\tSpecialist consultation ${i + 1}\tUp to S$${(i + 1) * 90} per visit`,
].join("\n");
const page = (d: number, p: number) => [`Wording ${d}.${p}`, ...Array.from({ length: 7 }, (_, i) => clause(p * 7 + i + 1, d + i))].join("\n");
export function fillerDocs(count: number, pagesEach: number): FxDoc[] {
  return Array.from({ length: count }, (_, d) => ({
    key: `FILLER_${d}`, id: "7c000000-0000-4000-8000-" + String(900 + d).padStart(12, "0"), owner: DJ.M.daniel.id, members: [{ id: DJ.M.daniel.id }, { id: DJ.M.grace.id }],
    insurer: "Aldermoor Life Ltd", policyType: "Health insurance", groupPolicyNumber: null, product: `Filler Cover ${d + 1}`, policyNumber: `FIL-${1000 + d}`, role: "policy_wording", personal: false,
    hash: `sha256:filler-${d}`, pages: Object.fromEntries(Array.from({ length: pagesEach }, (_, p) => [p + 1, page(d, p)])),
  } as FxDoc));
}
