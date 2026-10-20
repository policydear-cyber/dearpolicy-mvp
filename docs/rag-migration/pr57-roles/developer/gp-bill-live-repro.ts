/**
 * RECONSTRUCTION of the live re-ask after PR #61 (20 Oct 2026, ~08:24): the GP-bill answer opened with "You told me tripped on the
 * kerb.", quoted an overseas emergency outpatient clause, and left out the panel GP benefit. No production data was read. The household
 * is the ANONYMISED fixture of gp-bill-reconstruction.ts plus two INVENTED Product Summary pages (an overseas emergency outpatient
 * clause on page 20, a panel GP benefit on page 25): the hypothesis is that the real library prints both, in that order. Scripted
 * model, PGlite, no spend. Developer-owned scratch, not a registered test.
 *
 *   node --import tsx docs/rag-migration/pr57-roles/developer/gp-bill-live-repro.ts
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as FX from "../../../../scripts/fixtures/reliable-chat/fracture-conversation";
import { ScriptedLoopModel, type ScriptCall, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { CERT, call } from "../../../../scripts/fixtures/reliable-chat/fracture-script";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const DAN = FX.M.daniel.id;
const MSG = "daniel tripped on the kerb and fell, his GP bill is $800, can he claim for this?";
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");

const PS_P20 = ["SECTION 4: TRAVEL ASSISTANCE", "Emergency Outpatient Treatment Overseas", "We will reimburse the reasonable medical expenses for emergency outpatient treatment received outside Singapore following an Accident, up to $1,000 per Accident."].join("\n");
const PS_P25 = ["SECTION 6: CLINICAL BENEFITS", "Panel GP Benefit", "Consultation at a panel GP clinic in Singapore: no charge to the Insured Person. Non-panel GP consultation: up to $30 per visit."].join("\n");
// (Critic R10-1: the same panel GP line under a heading that names the scheme's Outpatient Medicare Policy, which Daniel's certificate does not list)
const PS_P25_OPMC = PS_P25.replace("SECTION 6: CLINICAL BENEFITS", "OUTPATIENT MEDICARE POLICY");
const household = (p25: string) => { const DOCS = FX.DOCS.map((d: any) => d.key === "PRODUCT_SUMMARY" ? { ...d, pages: { ...d.pages, 20: PS_P20, 25: p25 } } : d); return { ...FX, DOCS, doc: (k: string) => DOCS.find((d: any) => d.key === k)! }; };

// The model records the fact in its own words and answers without addressing the bill (the case where the server's G2 check runs).
const final = (): ScriptCall[] => [call("final_answer", { subject_id: DAN, sentences: [{ kind: "fact", text: "Daniel's documents do not include a benefit that pays for a GP bill after a fall.", subject_id: DAN }], next_steps: ["contact:" + CERT] })];
const TURN: ScriptTurn = { steps: [
  () => [call("resolve_person", { mention: "daniel" })],
  () => [call("note_facts", { subject_id: DAN, facts: [{ key: "how_it_happened", value: "tripped on the kerb", words: "tripped on the kerb" }, { key: "bill_amount", value: "$800 GP bill", words: "his GP bill is $800" }] })],
  () => [call("search_passages", { k: 8, query: "GP outpatient clinic medical expenses", subject_id: DAN })],
  ...Array.from({ length: 6 }, () => final),
] };

const CASES: [string, string, string][] = [
  ["A place not said (the live question)", MSG, PS_P25],
  ["the bill abroad (Critic R10-2)", "daniel tripped on the kerb in Bangkok and fell, his GP bill is $800, can he claim for this?", PS_P25],
  ["panel GP under the Outpatient Medicare Policy heading (Critic R10-1)", MSG, PS_P25_OPMC],
];
async function main() {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  for (const [name, msg, p25] of CASES) {
  const HH = household(p25);
  setEnv(HH as any);
  const h = await startHarness(HH as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  installLoopModel(new ScriptedLoopModel([TURN]));
  try {
    const a = await h.send(msg, {});
    const s = await h.savedAnswer(a.conversationId!);
    const tr = s.state.ragLoop.turns.at(-1);
    console.log(`\n=== ${name}\n${visible(s.answer)}\n  outcome: ${tr.outcome}\n  incomplete: ${JSON.stringify(tr.incomplete ?? [])}\n  dropped: ${JSON.stringify((tr.dropped ?? []).map((d: any) => `${String(d.sentence).slice(0, 60)} -- ${d.reason}`))}\n  calls: ${JSON.stringify((tr.toolCalls ?? []).map((c: any) => `${c.name}${c.ok ? "" : " ERR " + String(c.error ?? "").slice(0, 300)}`))}`);
  } finally { installLoopModel(null); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
