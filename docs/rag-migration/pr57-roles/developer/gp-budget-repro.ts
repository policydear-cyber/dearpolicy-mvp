/**
 * Production 0417567 (20 Oct 2026, Live site tester t12): "raymond tripped on the kerb, GP bill was $800, can he claim" ran 59 s and
 * stopped at the per-question model-use limit. This replays that question over the household SNAPSHOT the baseline thread took with
 * DC's yes (/mnt/project-files/ux-live/release-set/snapshot, real data, never committed), with a scripted model that makes the moves a
 * hosted model makes on it, and reports for every model call the prompt it would send (tokens estimated as the meter does) and what
 * each tool result adds -- the meter's per-turn token limit is checked with those estimates as if they were the provider's counts.
 * No production read, no spend. Developer-owned scratch, not a registered test.
 *
 *   SNAP=/mnt/project-files/ux-live/release-set/snapshot node --import tsx docs/rag-migration/pr57-roles/developer/gp-budget-repro.ts
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { setEnv, startHarness, type HarnessHousehold } from "../../../../scripts/fixtures/rag2-loop/harness";
import { ScriptedLoopModel, type ScriptCall, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { estimateTokens } from "@/lib/rag2/loop/usage-meter";
import type { ModelTurnInput, ModelTurnOutput } from "@/lib/rag2/loop/types";

const SNAP = process.env.SNAP ?? "/mnt/project-files/ux-live/release-set/snapshot";
const snap = JSON.parse(readFileSync(`${SNAP}/household.json`, "utf8"));
const ACCOUNT = "00000000-0000-0000-0000-00000000d001";
const uid = (n: number) => `9d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M: Record<string, { id: string; name: string; pref: string | null; rel: string; notes: null; dob: null }> = {};
snap.members.forEach((m: any, i: number) => { M[m.name] = { id: uid(i + 1), name: m.name, pref: m.name.split(/\s+/).at(-1), rel: m.relationship === "dependant" ? "child" : m.relationship, notes: null, dob: null }; });
const DOCS = snap.documents.map((d: any, i: number) => ({
  key: `D${i}`, id: d.policyId, owner: M[d.uploadedFor]?.id ?? Object.values(M)[0].id,
  members: (d.linkedPeople as string[]).filter((n) => M[n]).map((n) => ({ id: M[n].id })),
  insurer: d.insurer ?? "", product: d.productName ?? d.name, policyNumber: d.policyNumber, groupPolicyNumber: null,
  policyType: d.documentType ?? "group", role: d.documentRole ?? "other", personal: d.documentRole === "certificate" && !!d.policyNumber,
  hash: createHash("sha1").update(d.policyId).digest("hex"), effective: d.effectiveDate, filename: d.name,
  processing: d.processingStatus, pageCount: d.pages.length,
  pages: Object.fromEntries(d.pages.map((p: any) => [p.page, p.text])),
}));
const HH = { ACCOUNT, OTHER_ACCOUNT: "00000000-0000-0000-0000-00000000d002", DOCS, M: Object.fromEntries(Object.values(M).map((m, i) => [`m${i}`, m])) } as unknown as HarnessHousehold;
const DES = Object.values(M).find((m) => /raymond/i.test(m.name))!.id;

const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const absence = (): ScriptCall[] => [call("final_answer", { subject_id: DES, sentences: [{ kind: "fact", text: "Raymond's documents do not include a benefit that pays for a GP bill after a fall.", subject_id: DES }], next_steps: [] })];
// (MODE=notfound: the model answers with a checked absence, which the documents refute -- they print GP lines)
const notFound = (): ScriptCall[] => [call("final_answer", { subject_id: DES, sentences: [{ kind: "not_found", claim: "benefit_not_found", topic: "GP or outpatient treatment", terms: ["GP", "outpatient", "clinic"], subject_id: DES }], next_steps: [] })];
const search = (query: string) => (): ScriptCall[] => [call("search_passages", { k: 8, query, subject_id: DES })];
const MODE = process.env.MODE ?? "searches";
const TURN: ScriptTurn = { steps: [
  () => [call("resolve_person", { mention: "raymond" })],
  () => [call("note_facts", { subject_id: DES, facts: [{ key: "how_it_happened", value: "tripped on the kerb", words: "tripped on the kerb" }, { key: "bill_amount", value: "$800 GP bill", words: "GP bill was $800" }] }), call("person_benefits", { subject_id: DES, topic: "GP bill after a fall" })],
  search("GP outpatient clinic consultation medical expenses"),
  // (MODE=searches: a model that keeps looking -- the production turn ran 59 s -- until the budget stops it before any answer)
  ...(MODE === "searches" ? [search("panel GP clinic visit"), search("outpatient medicare benefit"), search("accident medical expenses reimbursement")] : []),
  ...Array.from({ length: 10 }, () => (MODE === "notfound" ? notFound : absence)),
] };

const LIMIT = Number(process.env.DEARPOLICY_RAG_LOOP_MAX_TOKENS ?? 80_000), OUT = Number(process.env.DEARPOLICY_RAG_LOOP_MAX_OUTPUT_TOKENS ?? 2_000);
const rows: string[] = [];
class Metered extends ScriptedLoopModel {
  async next(input: ModelTurnInput): Promise<ModelTurnOutput> {
    const out = await super.next(input);
    const est = estimateTokens(input);
    if (process.env.DUMP_PB) { const pb = input.messages.find((m: any) => m.role === "tool" && m.name === "person_benefits") as any; if (pb && !(globalThis as any).__pb) { (globalThis as any).__pb = 1; console.log("PB", pb.content.slice(0, 6000)); } }
    const tools = input.messages.filter((m) => m.role === "tool") as { name: string; content: string }[];
    const last = tools.slice(-3).map((t) => `${t.name} ${Math.ceil(t.content.length / 3.5)}`).join(", ");
    rows.push(`call ${rows.length + 1}: prompt ~${est} tokens (tool specs ~${Math.ceil(JSON.stringify(input.tools).length / 3.5)}, system ~${Math.ceil(((input.messages.find((m) => m.role === "system") as any)?.content ?? "").length / 3.5)}); latest results: ${last || "-"}; -> ${out.toolCalls.map((c) => c.name).join(", ")}`);
    // (as a hosted model reports it: the whole prompt as input, a short tool call as output)
    return { ...out, usage: { input: est, output: 300 } };
  }
}

async function main() {
  setEnv(HH);
  const h = await startHarness(HH);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  // (NEXT=1: then "what do i do now", answered by a model that gives general advice the composer cannot keep and a contact step -- t13)
  const CERT_ID = snap.documents.find((d: any) => d.documentRole === "certificate" && d.pages.length === 1)?.policyId;
  const NEXT: ScriptTurn = { steps: Array.from({ length: 4 }, () => () => [call("final_answer", { subject_id: DES, sentences: [{ kind: "fact", text: "You need to submit a claim form with the GP bill and receipts to the insurer.", subject_id: DES }], next_steps: ["contact:" + CERT_ID] })]) };
  installLoopModel(new Metered(process.env.NEXT ? [TURN, NEXT] : [TURN]));
  try {
    const a = await h.send("raymond tripped on the kerb, GP bill was $800, can he claim");
    const sv = await h.savedAnswer(a.conversationId!);
    const t = sv.state?.ragLoop?.turns?.at(-1);
    console.log(rows.join("\n"));
    console.log(`limit ${LIMIT} tokens per question (each call also reserves ${OUT} output tokens before it is made)`);
    console.log(`outcome: ${t?.outcome} ${t?.stop ? JSON.stringify(t.stop) : ""}`);
    console.log(`calls: ${JSON.stringify((t?.toolCalls ?? []).map((c: any) => `${c.name}${c.ok ? "" : " ERR " + String(c.error ?? "").slice(0, 120)}`))}`);
    console.log(`adjusted: ${JSON.stringify(t?.adjusted ?? [])}\nincomplete: ${JSON.stringify(t?.incomplete ?? [])}\nlimit: ${JSON.stringify(t?.limit ?? null)}`);
    console.log(`answer: ${[a.summary, ...(a.details ?? [])].join("\n")}`);
    if (process.env.NEXT) { const b = await h.send("what do i do now", { id: a.conversationId! }); console.log(`next: ${[b.summary, ...(b.details ?? [])].join("\n")}\nnext steps: ${JSON.stringify(b.nextSteps)}`); }
    if (process.env.FULL) console.log("FULL", JSON.stringify({ ...a, conversationId: undefined }, null, 1).slice(0, 8000));
  } finally { installLoopModel(null); }
}
main().catch((e) => { console.error(e); process.exit(1); });
