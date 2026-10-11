/**
 * Release HOLDOUT (node --import tsx scripts/rag2-release-holdout.ts; npm run rag2:release-holdout).
 *
 * Paraphrased scenarios written BEFORE the candidate was frozen and run once against the frozen candidate, without
 * changing the implementation to suit them (results retained as they come, failures included). Same harness and
 * synthetic household as scripts/rag2-release-acceptance.ts; expected facts read off the fixture pages by hand.
 */
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness, type Harness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-release/household";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

const { M, doc } = HH;
const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 10).join("\n     ")); }
}
const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => "[Q] " + q.text), ...(a.nextSteps ?? []).map((n) => "[next] " + n)].join("\n");
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const pick = (v: ScriptView, name: string, where?: (o: any) => boolean) => { const o = v.find(name, where); if (!o?.ok) throw new Error("script: " + name + " failed: " + JSON.stringify(o?.result).slice(0, 300)); return o.result.data; };
const hit = (v: ScriptView, text: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => text.test(`${x.text ?? ""} ${x.evidence?.excerpt ?? ""}`)); if (h) return h.evidence.evidence_id as string; } throw new Error("script: no passage like " + text); };
const DIAGNOSTIC = /cited page|figure is not bound|one column per person|save-time|evidence id|\bvalue id\b|\b[evr]\d+\b|left out is for|POLICY NO\.|FIGURE|gate/;

async function main() {
  const h: Harness = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const out: string[] = [];
  const run = async (label: string, script: ScriptTurn[], messages: string[]) => {
    installLoopModel(new ScriptedLoopModel(script));
    let conv: { id?: string; rev?: number } = {};
    const turns: { text: string; answer: ChatAnswer; trace: any; loop: any }[] = [];
    try { for (const m of messages) { const a = await h.send(m, conv); conv = { id: a.conversationId, rev: a.conversationRevision }; const s = await h.savedAnswer(conv.id!); turns.push({ text: visible(s.answer), answer: s.answer, loop: s.state.ragLoop, trace: s.state.ragLoop?.turns.at(-1) }); } }
    finally { installLoopModel(null); }
    out.push([`### ${label}`, ...turns.flatMap((t, i) => [`USER: ${messages[i]}`, `APP:  ${t.text.replace(/\n/g, "\n      ")}`, `      (gate=${JSON.stringify(t.trace?.gate ?? [])} tools=${(t.trace?.toolCalls ?? []).map((c: any) => c.name + (c.ok ? "" : "!")).join(",")})`, ...(process.env.HOLDOUT_DEBUG ? (t.trace?.toolCalls ?? []).filter((c: any) => !c.ok).map((c: any) => `      ! ${c.name}: ${String(c.error ?? "").slice(0, 400)}`) : [])])].join("\n"));
    return turns;
  };

  // H1 "my wife" (the speaker is Alex) died in a car crash; the model answers first without asking, as live.
  const H1 = await run("H1 my wife died in a car crash", [{ steps: [
    () => [call("resolve_person", { mention: "my wife" })],
    (v) => [call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Personal Accident", subject_id: pick(v, "resolve_person").person.id, want: "amount" }), call("search_passages", { query: "death accident within days", subject_id: M.bea.id })],
    (v) => [call("final_answer", { subject_id: M.bea.id, sentences: [
      { text: "Bea's certificate shows a Group Personal Accident sum assured of S$400,000 as at 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.bea.id },
      { text: "Under the wording, Death due to Accident is 100% of the Sum Insured where death follows an Accident within 365 days.", evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: M.bea.id },
      { text: "I would need to know when the crash happened to say more." },
    ] })],
    (v) => [call("ask_user", { kind: "fact", subject_id: M.bea.id, fact_key: "accident_date", question: "When did the crash happen?", because_evidence_ids: [hit(v, /Death due to Accident: if/)], statements: [
      { text: "Bea's certificate shows a Group Personal Accident sum assured of S$400,000 as at 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.bea.id },
      { text: "Under the wording, Death due to Accident is 100% of the Sum Insured where death follows an Accident within 365 days.", evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: M.bea.id },
    ] })],
  ] }], ["my wife died in a car crash"]);
  await check("H1 Bea's own dated S$400,000 (never Alex's S$600,000), the 365-day condition, one question about the date, nothing internal", () => {
    const t = H1[0];
    assert.match(t.text, /S\$400,000/); assert.doesNotMatch(t.text, /S\$600,000/); assert.match(t.text, /365 days/);
    assert.equal(t.answer.questions?.length, 1); assert.doesNotMatch(t.text, DIAGNOSTIC);
  });

  // H2 a what-if for a toe fracture: 2% of Bea's sum assured.
  const H2 = await run("H2 what if Bea broke her toe", [{ steps: [
    () => [call("resolve_person", { mention: "Bea" })],
    () => [call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Personal Accident sum insured", subject_id: M.bea.id, want: "amount" }), call("select_table_value", { policy_id: doc("PA_WORD").id, benefit: "Fracture of toe", subject_id: M.bea.id, want: "percent" })],
    (v) => { const s = pick(v, "select_table_value", (o) => o.args.policy_id === doc("CERT").id), p = pick(v, "select_table_value", (o) => o.args.policy_id === doc("PA_WORD").id); return [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: M.bea.id, policy_id: doc("CERT").id, benefit: "Fracture of toe", sum_insured_value_id: s.valueId, percent_value_id: p.valueId, condition: "broken toe", assumption_words: "what if Bea broke her toe" })]; },
    (v) => [call("final_answer", { subject_id: M.bea.id, sentences: [
      { text: "Bea's certificate lists her Group Personal Accident sum assured as S$400,000, as of 1 April 2024.", value_ids: [pick(v, "select_table_value", (o) => o.args.policy_id === doc("CERT").id).valueId], subject_id: M.bea.id },
      { text: "The schedule of compensation lists Fracture of toe at 2% of the Sum Insured.", value_ids: [pick(v, "select_table_value", (o) => o.args.policy_id === doc("PA_WORD").id).valueId], subject_id: M.bea.id },
      { text: "If Bea broke her toe in an accident, an indicative illustration is S$8,000.", result_id: pick(v, "calculate").calc_id, subject_id: M.bea.id },
    ] })],
  ] }], ["how much would bea get if she broke her toe?"]);
  await check("H2 2% of S$400,000 = S$8,000 only as an illustration, from the calculation; never a payout", () => {
    const t = H2[0];
    assert.match(t.text, /S\$8,000/); assert.match(t.text, /2%/); assert.doesNotMatch(t.text, /payout|will (?:get|receive)/i); assert.doesNotMatch(t.text, DIAGNOSTIC);
  });

  // H3 a track-day race: the exclusion has an exception, so the open fact is whether the race was sanctioned.
  const H3 = await run("H3 track day race", [{ steps: [
    () => [call("resolve_person", { mention: "Alex" })],
    () => [call("search_passages", { query: "racing", subject_id: M.alex.id })],
    (v) => [call("ask_user", { kind: "fact", subject_id: M.alex.id, fact_key: "race_sanctioned", question: "Was the race sanctioned by the Authority?", because_evidence_ids: [hit(v, /competitive racing/)], statements: [
      { text: "The Group Personal Accident wording does not pay for death or injury caused by competitive racing on wheels, except racing sanctioned by the Authority.", evidence_ids: [hit(v, /competitive racing/)], subject_id: M.alex.id },
    ] })],
  ] }], ["is alex covered if he dies racing his motorbike at a track day?"]);
  await check("H3 the exclusion and its exception are cited; the one question that decides it is asked", () => {
    const t = H3[0];
    assert.match(t.text, /except racing sanctioned by the Authority/); assert.equal(t.answer.questions?.length, 1); assert.match(t.answer.questions![0].text, /sanctioned/);
  });

  // H4 a product the certificate does not list.
  const H4 = await run("H4 product not on the certificate", [{ steps: [
    () => [call("resolve_person", { mention: "Alex" })],
    () => [call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Living Care Plus", subject_id: M.alex.id, want: "amount" })],
    (v) => [call("final_answer", { subject_id: M.alex.id, sentences: [{ text: "The uploaded documents don't list Group Living Care Plus for Alex." }] })],
  ] }], ["what does alex's certificate say for living care plus?"]);
  await check("H4 absent from the documents is said as absent; never Living Care's S$350,000 in its place", () => {
    const t = H4[0];
    assert.match(t.text, /don't list Group Living Care Plus/); assert.doesNotMatch(t.text, /S\$350,000/);
  });

  console.log("\n" + out.join("\n\n"));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nrelease holdout ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
