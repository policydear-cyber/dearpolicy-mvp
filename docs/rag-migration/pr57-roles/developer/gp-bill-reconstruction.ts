/**
 * RECONSTRUCTION (not evidence of what the live model did): DC's live answer of 20 Oct 2026 to "raymond tripped over the kerb and
 * fell, his GP bill is $800, can he claim for this?" (production main 4956588). Household and documents: the ANONYMISED fixture
 * scripts/fixtures/reliable-chat/fracture-conversation.ts (Daniel stands in for the policyholder; no production data was read).
 * The model is the test-only ScriptedLoopModel: each variant is one PLAUSIBLE way the model could have answered, played through the
 * real chat route on PGlite. No model call, no spend. Developer-owned scratch, not a registered test.
 *
 *   node --import tsx docs/rag-migration/pr57-roles/developer/gp-bill-reconstruction.ts
 *   DISPLAY="Daniel Lee Wei Ming" ...   (critic round 6 R6-1: the member saved under an app-style name, not the certificate's order)
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as FX from "../../../../scripts/fixtures/reliable-chat/fracture-conversation";
import { ScriptedLoopModel, type ScriptCall, type ScriptTurn, type ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { CERT, call, idsAny } from "../../../../scripts/fixtures/reliable-chat/fracture-script";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const DAN = FX.M.daniel.id;
const MSG = "daniel tripped over the kerb and fell, his GP bill is $800, can he claim for this?";
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");

/** The opening every variant shares, then `final` repeated for every repair step (the model answering the same way again). */
const turnOf = (final: (v: ScriptView) => ScriptCall[]): ScriptTurn => ({ steps: [
  () => [call("resolve_person", { mention: "daniel" })],
  () => [call("note_facts", { subject_id: DAN, facts: [{ key: "how_it_happened", value: "tripped over the kerb and fell", words: "tripped over the kerb and fell" }, { key: "bill_amount", value: "$800 GP bill", words: "his GP bill is $800" }] }), call("person_benefits", { subject_id: DAN, topic: "GP bill after an accident" })],
  () => [call("search_passages", { k: 8, query: "medical expenses outpatient GP clinic reimbursement accident", subject_id: DAN })],
  ...Array.from({ length: 6 }, () => final),
] });

const contact = ["contact:" + CERT];
const VARIANTS: Record<string, ScriptTurn> = {
  // A: an honest absence over his documents (the model's own terms include "outpatient" and "GP")
  A_absence: turnOf(() => [call("final_answer", { subject_id: DAN, sentences: [
    { kind: "not_found", claim: "benefit_not_found", topic: "GP or outpatient treatment", terms: ["outpatient", "GP", "clinic", "general practitioner"], subject_id: DAN },
  ], next_steps: contact })]),
  // B: what his accident cover does print (ambulance, cited) plus the absence
  B_ambulance_and_absence: turnOf((v) => [call("final_answer", { subject_id: DAN, sentences: [
    { kind: "fact", text: "Daniel's Group Personal Accident cover reimburses ground ambulance costs after an accident up to $500.", evidence_ids: idsAny(v, /ambulance/i).slice(0, 1), subject_id: DAN },
    { kind: "not_found", claim: "benefit_not_found", topic: "GP or outpatient treatment", terms: ["outpatient", "GP", "clinic", "general practitioner"], subject_id: DAN },
  ], next_steps: contact })]),
  // C: an uncited sentence (what the composer drops)
  C_uncited: turnOf(() => [call("final_answer", { subject_id: DAN, sentences: [
    { kind: "fact", text: "Daniel's documents do not include a benefit that pays for a GP bill after a fall.", subject_id: DAN },
  ], next_steps: contact })]),
};

const HH = process.env.DISPLAY ? { ...FX, M: { ...FX.M, daniel: { ...FX.M.daniel, name: process.env.DISPLAY } } } : FX;
async function main() {
  setEnv(HH as any);
  const h = await startHarness(HH as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  for (const [name, t] of Object.entries(VARIANTS)) {
    installLoopModel(new ScriptedLoopModel([t]));
    try {
      const a = await h.send(MSG, {});
      const s = await h.savedAnswer(a.conversationId!);
      const tr = s.state.ragLoop.turns.at(-1);
      console.log(`\n=== ${name}\n${visible(s.answer)}\n  outcome: ${tr.outcome}\n  dropped: ${JSON.stringify((tr.dropped ?? []).map((d: any) => `${d.sentence?.slice(0, 80)} -- ${d.reason}`), null, 1)}\n  incomplete: ${JSON.stringify(tr.incomplete ?? [])}\n  calls: ${JSON.stringify((tr.toolCalls ?? []).map((c: any) => `${c.name}${c.ok ? "" : " ERR " + String(c.error ?? "").slice(0, 400)}`), null, 1)}`);
    } finally { installLoopModel(null); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
