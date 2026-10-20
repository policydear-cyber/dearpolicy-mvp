/**
 * PR #64 (GP-bill answer): the anonymised fracture household (./fracture-conversation.ts) plus two INVENTED Product Summary pages, as in
 * the Developer's reconstruction (docs/rag-migration/pr57-roles/developer/gp-bill-live-repro.ts): an overseas emergency outpatient
 * clause on page 20 and a panel GP benefit on page 25. Synthetic; shared by scripts/reliable-chat-pr64-gp-test.ts and the browser spec
 * e2e/tests/reliable-chat-gp-bill.spec.ts (E2E_RAG2_HOUSEHOLD=gpbill). Scripted model moves only.
 */
import type { ScriptCall, ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import * as FX from "./fracture-conversation";
import { CERT, call, idsAny } from "./fracture-script";

export const DAN = FX.M.daniel.id;
export const PS_P20 = ["SECTION 4: TRAVEL ASSISTANCE", "Emergency Outpatient Treatment Overseas", "We will reimburse the reasonable medical expenses for emergency outpatient treatment received outside Singapore following an Accident, up to $1,000 per Accident."].join("\n");
export const PS_P25 = ["SECTION 6: CLINICAL BENEFITS", "Panel GP Benefit", "Consultation at a panel GP clinic in Singapore: no charge to the Insured Person. Non-panel GP consultation: up to $30 per visit."].join("\n");
export const PS_P25_OPMC = PS_P25.replace("SECTION 6: CLINICAL BENEFITS", "OUTPATIENT MEDICARE POLICY");
/** Daniel's certificate with one more product row of his own (the outpatient policy, under the given heading). */
export const certWithRow = (heading: string) => FX.CERT_P1.replace("This certificate is issued", `${heading}(POLICY NO. 3037850)\nS****411A\tLee Wei Ming, Daniel\tPlan A\tAs of 06/10/2022\nThis certificate is issued`);
/** The household with the two invented pages (and, optionally, another page 25 or certificate page). */
export const household = (p25 = PS_P25, cert?: string) => {
  const DOCS = FX.DOCS.map((d: any) => d.key === "PRODUCT_SUMMARY" ? { ...d, pages: { ...d.pages, 20: PS_P20, 25: p25 } } : d.key === "CERT" && cert ? { ...d, pages: { 1: cert } } : d);
  return { ...FX, DOCS, doc: (k: string) => DOCS.find((d: any) => d.key === k)! };
};
export const GP_HH = household();

export const MSG = {
  unsaid: "daniel tripped on the kerb and fell, his GP bill is $800, can he claim for this?",
  home: "daniel tripped on the kerb and fell, he saw a GP in Singapore and his GP bill is $800, can he claim for this?",
  abroad: "daniel tripped on the kerb on holiday in Bangkok and fell, his GP bill is $800, can he claim for this?",
  tampines: "daniel tripped on the kerb and saw a GP in Tampines, his GP bill is $800, can he claim for this?",
};
/** The model records the facts and answers without addressing the bill (so the server's GP check runs). `extra`: the model also states
 * a fact of its own (the ground ambulance line), so the server's quote is not the only sentence. */
export const gpTurn = (extra = false): ScriptTurn => {
  const final = (v: any): ScriptCall[] => [call("final_answer", { subject_id: DAN, sentences: [
    ...(extra ? [{ kind: "fact", text: "Daniel's Group Personal Accident cover reimburses ground ambulance costs after an accident up to $500.", evidence_ids: idsAny(v, /ambulance/i).slice(0, 1), subject_id: DAN }] : []),
    { kind: "fact", text: "Daniel's documents do not include a benefit that pays for a GP bill after a fall.", subject_id: DAN },
  ], next_steps: ["contact:" + CERT] })];
  return { steps: [
    () => [call("resolve_person", { mention: "daniel" })],
    () => [call("note_facts", { subject_id: DAN, facts: [{ key: "how_it_happened", value: "tripped on the kerb", words: "tripped on the kerb" }, { key: "bill_amount", value: "$800 GP bill", words: "his GP bill is $800" }] })],
    () => [call("search_passages", { k: 8, query: "GP outpatient clinic medical expenses ambulance", subject_id: DAN })],
    ...Array.from({ length: 6 }, () => final),
  ] };
};
export type GpScenario = { id: string; title: string; messages: string[]; turns: ScriptTurn[] };
export const GP_SCENARIOS = (): GpScenario[] => [
  { id: "GP-UNSAID", title: "GP bill, place not said", messages: [MSG.unsaid], turns: [gpTurn()] },
  { id: "GP-HOME", title: "GP bill in Singapore", messages: [MSG.home], turns: [gpTurn()] },
  { id: "GP-ABROAD", title: "GP bill on holiday in Bangkok", messages: [MSG.abroad], turns: [gpTurn()] },
  { id: "GP-TAMPINES", title: "GP in Tampines (not abroad)", messages: [MSG.tampines], turns: [gpTurn()] },
  { id: "GP-EXTRA", title: "place not said; the model also states a fact of its own", messages: [MSG.unsaid], turns: [gpTurn(true)] },
];
