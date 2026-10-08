/**
 * Conversational RAG, Prompt 2: the model-driven conversation loop (npm run rag2:loop-test).
 *
 * PGlite, the synthetic household (scripts/fixtures/rag2-loop/household.ts), every turn posted to the REAL chat route
 * with DEARPOLICY_RAG_LOOP=1 and the TEST-ONLY scripted model (scripts/fixtures/rag2-loop/conversations.ts). What the
 * household SEES (the answer saved after the save-time gate), the evidence ids it rests on and the gate's outcome are
 * asserted:
 *  F  flags: loop default off, refused in production unless allowed; the scripted model refused in production; with
 *     the flag off the chat never reaches the loop; the hook in lib/chat/workflow.ts is the only importer.
 *  D  the demo conversations (a)-(f): figure from the person's own column; "my son" -> one question (never the
 *     stepson) -> the child's column; one fact question at a time, a known fact never asked again; an interruption
 *     answered and the pending question re-asked; a correction updating facts and withdrawing derived estimates; the
 *     final answer with cited printed limits and labelled indicative estimates, never a total.
 *  N  negatives: a figure printed in none of its evidence, evidence no tool returned, an unevidenced cover statement,
 *     a stale (corrected) household figure, "payout" wording, another person's column (the gate), two questions at
 *     once, asking who twice, a model that never ends (budget).
 *  H  the hosted adapter: OpenAI-style and Anthropic tool-call request / reply mapping, usage and model id; no network
 *     under the deterministic stand-in.
 * Every check runs; exit 1 if any failed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness, type Harness } from "./fixtures/rag2-loop/harness";
import { claimConversation, CLAIM_MESSAGES, POLICY_MESSAGE, POLICY_QUESTION } from "./fixtures/rag2-loop/conversations";
import { DOCS, M } from "./fixtures/rag2-loop/household";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

setEnv();
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 10).join("\n     ")); }
}
const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => q.text), ...(a.nextSteps ?? [])].join(" ");
const MONEY = /S\$\s?\d/;
const doc = (key: string) => DOCS.find((d) => d.key === key)!;
const E = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });

async function main() {
  const flag = await import("@/lib/rag2/loop/flag");
  const { installLoopModel, loopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const H = await import("@/lib/rag2/loop/hosted-model");
  const { DROPPED_NOTE } = await import("@/lib/rag2/loop/compose");
  const { RESUME_NOTE, ESTIMATE_NOTICE } = await import("@/lib/rag2/loop/hook");
  const { FIGURE_LEFT_OUT_NOTE } = await import("@/lib/chat/answer-verification");

  await check("F1 DEARPOLICY_RAG_LOOP default off; refused in a production build unless explicitly allowed; implies the tools only for the loop", () => {
    assert.equal(flag.ragLoopEnabled(E({})), false);
    assert.equal(flag.ragLoopEnabled(E({ DEARPOLICY_RAG_LOOP: "1" })), true);
    assert.equal(flag.ragLoopEnabled(E({ DEARPOLICY_RAG_LOOP: "1", NODE_ENV: "production" })), false);
    assert.equal(flag.ragLoopEnabled(E({ DEARPOLICY_RAG_LOOP: "1", VERCEL: "1" })), false);
    assert.equal(flag.ragLoopEnabled(E({ DEARPOLICY_RAG_LOOP: "1", NODE_ENV: "production", DEARPOLICY_RAG_LOOP_ALLOW_PRODUCTION: "1" })), true);
    assert.equal(flag.loopToolEnv(E({})).DEARPOLICY_RAG_TOOLS, undefined);
    assert.equal(flag.loopToolEnv(E({ DEARPOLICY_RAG_LOOP: "1" })).DEARPOLICY_RAG_TOOLS, "1");
    const b = flag.loopBudget(E({ DEARPOLICY_RAG_LOOP_MAX_STEPS: "1000" })); assert.equal(b.maxSteps, 40);
  });
  await check("F2 the scripted model is refused in a production build (constructing or installing it)", () => {
    assert.throws(() => new ScriptedLoopModel([], { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv), /test-only/);
    assert.throws(() => new ScriptedLoopModel([], { VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv), /test-only/);
    const m = new ScriptedLoopModel([]);
    assert.throws(() => installLoopModel(m, { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv), /test-only/);
    installLoopModel(m); assert.throws(() => loopModel({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv), /test-only/); installLoopModel(null);
    assert.equal(loopModel().kind, "hosted");
  });
  await check("F3 the only hook: lib/chat/workflow.ts imports the loop's flag and loads the hook only behind ragLoopEnabled()", async () => {
    const text = await readFile(path.resolve("lib/chat/workflow.ts"), "utf8");
    const refs = text.match(/[@\w./-]*lib\/rag2[\w./-]*/g) ?? [];
    assert.deepEqual([...new Set(refs)].sort(), ["@/lib/rag2/loop/flag", "@/lib/rag2/loop/hook", "lib/rag2/loop/hook.ts"]);
    assert.equal((text.match(/if\(ragLoopEnabled\(\)\)return \(await import\("@\/lib\/rag2\/loop\/hook"\)\)/g) ?? []).length, 2);
    const env = await readFile(path.resolve(".env.example"), "utf8");
    assert.match(env, /^# DEARPOLICY_RAG_LOOP=/m); assert.match(env, /^# DEARPOLICY_RAG_LOOP_ALLOW_PRODUCTION=/m);
  });
  await check("H1 hosted adapter: OpenAI-style tool calls (request tools/tool_calls, reply parsing, usage, model id)", async () => {
    const tools = [{ name: "resolve_person", description: "d", parameters: { type: "object", properties: { mention: { type: "string" } } } }];
    const input = { messages: [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "u" }, { role: "assistant" as const, content: null, toolCalls: [{ id: "c1", name: "resolve_person", arguments: { mention: "me" } }] }, { role: "tool" as const, toolCallId: "c1", name: "resolve_person", content: "{\"ok\":true}" }], tools, maxOutputTokens: 500 };
    const req = H.openAiRequest("gpt-x", input) as any;
    assert.equal(req.tools[0].type, "function"); assert.equal(req.tools[0].function.name, "resolve_person"); assert.equal(req.tool_choice, "required");
    assert.equal(req.messages[2].tool_calls[0].function.arguments, "{\"mention\":\"me\"}"); assert.equal(req.messages[3].tool_call_id, "c1");
    const rep = H.openAiReply({ model: "gpt-x-2026", usage: { prompt_tokens: 120, completion_tokens: 30 }, choices: [{ message: { content: null, tool_calls: [{ id: "t9", type: "function", function: { name: "final_answer", arguments: "{\"sentences\":[]}" } }] } }] });
    assert.deepEqual(rep.toolCalls, [{ id: "t9", name: "final_answer", arguments: { sentences: [] } }]); assert.deepEqual(rep.usage, { input: 120, output: 30 });
    const areq = H.anthropicRequest("claude-x", input) as any;
    assert.equal(areq.system, "s"); assert.equal(areq.tools[0].input_schema.type, "object");
    assert.equal(areq.messages[1].content[0].type, "tool_use"); assert.equal(areq.messages[2].content[0].type, "tool_result");
    const arep = H.anthropicReply({ model: "claude-x", usage: { input_tokens: 7, output_tokens: 3 }, content: [{ type: "tool_use", id: "u1", name: "ask_user", input: { kind: "person", question: "Who?" } }] });
    assert.equal(arep.toolCalls[0].name, "ask_user"); assert.deepEqual(arep.usage, { input: 7, output: 3 });
    const saved = process.env.DEARPOLICY_DETERMINISTIC_MODEL; delete process.env.DEARPOLICY_DETERMINISTIC_MODEL;
    try {
      const seen: any[] = [];
      const fake = (async (url: string, init: any) => { seen.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ model: "gpt-x-2026", usage: { prompt_tokens: 50, completion_tokens: 5 }, choices: [{ message: { content: null, tool_calls: [{ id: "a", type: "function", function: { name: "resolve_person", arguments: "{\"mention\":\"my son\"}" } }] } }] }), { status: 200 }); }) as unknown as typeof fetch;
      const m = new H.HostedLoopModel({ provider: "openai", model: "gpt-x" }, fake);
      const out = await m.next(input);
      assert.equal(seen[0].url, "https://api.openai.com/v1/chat/completions"); assert.equal(out.modelId, "openai:gpt-x-2026"); assert.equal(out.usage.input, 50); assert.equal(out.toolCalls[0].arguments.mention, "my son");
    } finally { process.env.DEARPOLICY_DETERMINISTIC_MODEL = saved; }
    await assert.rejects(new H.HostedLoopModel({ provider: "openai", model: "gpt-x" }, (async () => { throw new Error("no network"); }) as unknown as typeof fetch).next(input), /deterministic model stand-in/);
  });

  const h: Harness = await startHarness();
  const run = async (script: ScriptTurn[], messages: string[]) => {
    const model = new ScriptedLoopModel(script); installLoopModel(model);
    let conv: { id?: string; rev?: number } = {};
    const turns: { answer: ChatAnswer; saved: Awaited<ReturnType<Harness["savedAnswer"]>>; trace: any; loop: any }[] = [];
    for (const m of messages) {
      const answer = await h.send(m, conv);
      conv = { id: answer.conversationId, rev: answer.conversationRevision };
      const saved = await h.savedAnswer(conv.id!);
      turns.push({ answer, saved, loop: saved.state.ragLoop, trace: saved.state.ragLoop?.turns.at(-1) });
    }
    installLoopModel(null);
    return { turns, model };
  };
  const evidence = (t: { loop: any; trace: any }) => (t.trace.evidenceChosen as string[]).map((id) => t.loop.evidence[id]);

  // ---------------- flag off: the existing chat ----------------
  await check("F4 flag off: the chat never reaches the loop (no loop state, the installed model is never asked)", async () => {
    delete process.env.DEARPOLICY_RAG_LOOP;
    const model = new ScriptedLoopModel([{ steps: [() => { throw new Error("the loop ran with the flag off"); }] }]); installLoopModel(model);
    let id: string | undefined;
    try { const a = await h.send(POLICY_MESSAGE); id = a.conversationId; } catch (e) { if (/the loop ran/.test(String(e))) throw e; }
    installLoopModel(null);
    assert.equal(model.started, 0);
    if (id) assert.equal((await h.savedAnswer(id)).state.ragLoop, undefined);
  });
  process.env.DEARPOLICY_RAG_LOOP = "1";

  // ---------------- (a) ----------------
  const A = await run(POLICY_QUESTION, [POLICY_MESSAGE]);
  await check("D-a ordinary question: the figure from the person's own column, bound and verified by the gate", () => {
    const t = A.turns[0];
    assert.match(t.saved.answer.summary, /Melissa's accidental medical expenses limit .* is S\$3,000 per policy year\./);
    assert.doesNotMatch(visible(t.saved.answer), /1,500/);
    assert.deepEqual(t.trace.gate, []); assert.equal(t.trace.outcome, "final_answer");
    const e = evidence(t);
    assert.ok(e.some((x: any) => x.table?.columnHeader === "Insured Adult" && x.table?.rowLabel.startsWith("Accidental medical expenses") && x.policyId === doc("PA").id));
    assert.ok(e.some((x: any) => /aggregate limit per insured person/.test(x.passage.text)));
    const b = t.saved.answer.figureBindings ?? [];
    assert.equal(b.length, 1); assert.equal(b[0].column, "Insured Adult"); assert.equal(b[0].subjectId, M.melissa.id); assert.equal(b[0].value, 3000);
    assert.ok(t.saved.answer.citations.some((c) => c.policyId === doc("PA").id && c.pageStart === 1));
    assert.equal(t.trace.modelKind, "scripted"); assert.ok(t.trace.toolCalls.length >= 4);
  });

  // ---------------- (b)-(f) ----------------
  const B = await run(claimConversation(), CLAIM_MESSAGES);
  const [b1, b2, c1, c2, d1, f1, f2] = B.turns;
  // Expectation changed (agent C): the stepson used to be silently left out of "my son"; he is now offered too,
  // labelled as the stepson, and the household chooses.
  await check("D-b1 \"my son\" with two sons and a stepson: one question offering Jun Hao, Jun Wei and Ryan (labelled stepson), nothing else said", () => {
    const a = b1.saved.answer;
    assert.equal(a.questions.length, 1); assert.equal(a.questions[0].id, "rag_person");
    assert.deepEqual((a.personCandidates ?? []).map((p) => p.id).sort(), [M.junhao.id, M.junwei.id, M.ryan.id].sort());
    assert.match((a.personCandidates ?? []).find((p) => p.id === M.ryan.id)!.label, /stepson/);
    assert.doesNotMatch(visible(a), MONEY);
    assert.equal(b1.loop.pending.kind, "person");
  });
  await check("D-b2 the household chooses Jun Hao: answered from the Child column (S$80, never the adult S$150)", () => {
    const a = b2.saved.answer;
    assert.match(visible(a), /Jun Hao's hospital cash is S\$80 per day, from the Child column/);
    assert.match(visible(a), /S\$100 per day for up to 30 days/);
    assert.doesNotMatch(visible(a), /S\$150/); assert.deepEqual(b2.trace.gate, []);
    assert.ok(evidence(b2).some((x: any) => x.table?.columnHeader === "Child" && x.policyId === doc("CASH").id));
    assert.equal(b2.loop.subjectId, M.junhao.id); assert.equal(b2.loop.pending, null);
    assert.ok((a.figureBindings ?? []).every((x) => x.subjectId === M.junhao.id));
  });
  await check("D-c1 injury: the facts stated are recorded, and ONE question that changes the amount (nights, for hospital cash) is asked", () => {
    const a = c1.saved.answer;
    assert.equal(a.mode, "fact_finding"); assert.equal(a.questions.length, 1); assert.match(a.questions[0].text, /how many nights/i);
    assert.equal((visible(a).match(/\?/g) ?? []).length, 2); // the question, in the summary and on its card
    assert.doesNotMatch(visible(a), MONEY);
    // Expectation changed (agent C): no cause=accident is recorded from "fell off the monkey bars"; how it happened is
    // recorded in the household's words, and the injury as their (paraphrased, unconfirmed) report.
    assert.equal(c1.loop.claim.facts.cause, undefined); assert.equal(c1.loop.claim.subjectId, M.junhao.id);
    assert.deepEqual([c1.loop.claim.facts.how_it_happened.source, c1.loop.claim.facts.how_it_happened.basis], ["user_reported", "stated"]);
    assert.deepEqual([c1.loop.claim.facts.injury.value, c1.loop.claim.facts.injury.source, c1.loop.claim.facts.injury.basis], ["arm fracture", "user_reported", "paraphrased"]);
    assert.equal(c1.loop.pending.factKey, "nights_in_hospital"); assert.ok(c1.trace.evidenceChosen.length >= 1);
  });
  await check("D-c2 next question one at a time; asking again for the recorded number of nights is refused", () => {
    const a = c2.saved.answer;
    assert.equal(a.questions.length, 1); assert.match(a.questions[0].text, /How much was the hospital bill/);
    const refused = c2.trace.toolCalls.find((t: any) => t.name === "ask_user" && !t.ok);
    assert.ok(refused && /already recorded/.test(refused.error));
    assert.equal(c2.loop.claim.facts.nights_in_hospital.value, "2"); assert.equal(c2.loop.pending.factKey, "bill_amount");
  });
  await check("D-d interruption: the deductible is answered from Darren's plan, then the pending bill question is put back", () => {
    const a = d1.saved.answer;
    assert.match(a.summary, /deductible is S\$3,500 per policy year/); assert.deepEqual(d1.trace.gate, []);
    assert.ok(a.details.includes(RESUME_NOTE)); assert.equal(a.questions.length, 1); assert.match(a.questions[0].text, /How much was the hospital bill/);
    assert.equal(d1.trace.reasked, a.questions[0].text); assert.equal(d1.loop.pending.factKey, "bill_amount");
    assert.ok(evidence(d1).some((x: any) => x.policyId === doc("HOSP").id && /Deductible/.test(x.table?.rowLabel ?? "")));
    assert.equal(Object.keys(d1.loop.claim.facts).includes("bill_amount"), false);
  });
  await check("D-f1 every input known: printed limits cited, hospital cash as labelled indicative estimates (S$200, S$160), never a total", () => {
    const a = f1.saved.answer, v = visible(a);
    assert.match(v, /up to S\$800 per fracture/); assert.match(v, /S\$1,500 per policy year, in the Insured Child column/);
    assert.match(v, /Indicative estimate: FamilyGuard hospital cash of S\$100 per day for 2 nights comes to S\$200\./);
    assert.match(v, /Indicative estimate: DailyCare hospital cash of S\$80 per day for 2 nights comes to S\$160\./);
    assert.doesNotMatch(v, /S\$360|payout/i); assert.equal(a.disclaimer, ESTIMATE_NOTICE);
    assert.deepEqual(f1.trace.gate, []); assert.equal((a.computations ?? []).length, 2);
    assert.ok((a.computations ?? []).every((c) => c.operation === "product" && c.operands[0].binding?.subjectId === M.junhao.id));
    assert.equal(f1.loop.pending, null); assert.equal(f1.loop.claim.derived.length, 2);
  });
  await check("D-e/f2 correction: nights updated 2 -> 3, the old estimates withdrawn, the final answer recomputed (S$300, S$240) and grounded", () => {
    const a = f2.saved.answer, v = visible(a);
    assert.match(a.summary, /^Updated: nights in hospital is now 3 \(you first said 2\)\. The earlier estimate worked out from it no longer applies\./);
    assert.match(v, /for 3 nights comes to S\$300\./); assert.match(v, /for 3 nights comes to S\$240\./);
    assert.doesNotMatch(v, /S\$200|S\$160|S\$540/);
    assert.equal(f2.loop.claim.facts.nights_in_hospital.value, "3"); assert.equal(f2.loop.claim.facts.nights_in_hospital.previous[0].value, "2");
    assert.ok(f2.loop.claim.derived.every((d: any) => d.turn === f2.loop.turn) && f2.loop.claim.derived.length === 2);
    assert.deepEqual(f2.trace.corrections, [{ key: "nights_in_hospital", from: "2", to: "3" }]);
    assert.deepEqual(f2.trace.gate, []);
    const e = evidence(f2);
    assert.ok(e.some((x: any) => /S\$800 per fracture/.test(x.passage.text) && x.passage.onPage === 2));
    assert.ok(e.some((x: any) => x.table?.columnHeader === "Insured Child" && /Accidental medical/.test(x.table.rowLabel)));
    assert.ok(a.citations.some((c) => c.policyId === doc("PA").id && c.pageStart === 2));
  });

  await check("D-g the output guard never had to change a loop answer (conversations (a)-(f))", async () => {
    const { guardInterventions } = await import("@/lib/chat/output-guard");
    assert.deepEqual(guardInterventions, []);
  });

  // ---------------- negatives ----------------
  const pick = (v: ScriptView, name: string) => { const o = v.find(name); if (!o?.ok) throw new Error(name + " failed"); return o.result.data; };
  const N = await run([
    { steps: [
      () => [call("resolve_person", { mention: "Jun Hao" })],
      (v) => [call("policies_for", { subject_id: pick(v, "resolve_person").person.id, topic: "accident" }), call("search_passages", { query: "fracture", subject_id: pick(v, "resolve_person").person.id })],
      (v) => { const ev = (pick(v, "search_passages").hits as any[])[0].evidence.evidence_id; return [call("final_answer", { subject_id: M.junhao.id, sentences: [
        { text: "Jun Hao's fractures are paid under accidental medical expenses up to S$9,999 per fracture.", evidence_ids: [ev], benefit: "accidental medical expenses" },
        { text: "Physiotherapy is paid up to S$300.", evidence_ids: ["e999"] },
        { text: "Jun Hao is covered for every sport.", },
        { text: "Here is what his documents say.", },
      ] })]; },
    ] },
  ], ["Is Jun Hao's fracture covered?"]);
  await check("N1 a figure printed in none of its evidence, evidence no tool returned and an unevidenced cover statement are all dropped, with an honest note", () => {
    const t = N.turns[0], v = visible(t.saved.answer);
    assert.doesNotMatch(v, /9,999|S\$300|every sport/);
    assert.equal(t.trace.dropped.length, 3);
    assert.ok(t.trace.dropped.some((d: any) => /printed in none/.test(d.reason)) && t.trace.dropped.some((d: any) => /no tool returned/.test(d.reason)) && t.trace.dropped.some((d: any) => /without citing evidence/.test(d.reason)));
    assert.match(t.saved.answer.summary, /Here is what his documents say\./); assert.ok(t.saved.answer.details.includes(DROPPED_NOTE));
  });
  const G = await run([
    { steps: [
      () => [call("resolve_person", { mention: "Jun Hao" })],
      (v) => [call("policies_for", { subject_id: pick(v, "resolve_person").person.id, topic: "accident" })],
      (v) => [call("select_table_value", { policy_id: (pick(v, "policies_for").covering as any[]).find((p) => /FamilyGuard/.test(p.productName)).policyId, benefit: "Accidental medical expenses", subject_id: M.junhao.id })],
      (v) => { const s = pick(v, "select_table_value"); return [call("final_answer", { subject_id: M.melissa.id, sentences: [
        { text: "Melissa's accidental medical expenses limit is S$1,500 per policy year.", evidence_ids: [s.evidence.evidence_id], benefit: "Accidental medical expenses (per policy year)", subject_id: M.melissa.id },
        { text: "Her documents are listed on the Family page.", },
      ] })]; },
    ] },
  ], ["What is Melissa's accidental medical expenses limit?"]);
  await check("N2 another person's column: the child's S$1,500 stated for Melissa is removed by the save-time gate (with the gate's note)", () => {
    const t = G.turns[0], v = visible(t.saved.answer);
    assert.deepEqual(t.trace.dropped, [], "the composer binds it (the passage prints 1,500); only the gate can tell the column is not Melissa's");
    assert.doesNotMatch(v, /1,500/);
    assert.ok(t.trace.gate.length >= 1, "the gate reported the wrong-column figure");
    assert.ok(v.includes(FIGURE_LEFT_OUT_NOTE));
  });
  // Expectation changed (agent C): a stale (corrected) household figure is now refused when compute is called (it is
  // no longer a recorded fact), before any sentence is composed; facts are recorded only from the household's words.
  const S = await run([
    { steps: [
      () => [call("resolve_person", { mention: "Jun Hao" })],
      () => [call("note_facts", { subject_id: M.junhao.id, facts: [{ key: "nights_in_hospital", value: "2", words: "2 nights" }] })],
      (v) => [call("policies_for", { subject_id: M.junhao.id, topic: "hospital" })],
      (v) => [call("ask_user", { kind: "fact", fact_key: "bill_amount", subject_id: M.junhao.id, question: "How much was the bill? And which hospital?", because_evidence_ids: ["e1"] })],
      (v) => [call("ask_user", { kind: "person", question: "Which son do you mean?", options: [M.junhao.id] })],
      (v) => [call("note_facts", { subject_id: M.junhao.id, facts: [{ key: "nights_in_hospital", value: "3", words: "actually 3" }] })],
      (v) => [call("select_table_value", { policy_id: (pick(v, "policies_for").covering as any[]).find((p) => /FamilyGuard/.test(p.productName)).policyId, benefit: "Hospital cash", subject_id: M.junhao.id })],
      (v) => [call("compute", { operation: "per_day", label: "stale", operands: [{ value_id: pick(v, "select_table_value").valueId }, { household: { label: "nights", attribution: "2 nights", count: 2 } }] })],
      (v) => [call("compute", { operation: "per_day", label: "fresh", operands: [{ value_id: pick(v, "select_table_value").valueId }, { household: { label: "nights", attribution: "actually 3", count: 3 } }] })],
      (v) => { const fresh = v.find("compute", (o) => o.args.label === "fresh")!.result.data; return [call("final_answer", { subject_id: M.junhao.id, sentences: [
        { text: `FamilyGuard hospital cash of S$100 per day for 3 nights gives a payout of S$${fresh.amount}.`, result_id: fresh.resultId },
        { text: `FamilyGuard hospital cash of S$100 per day for 3 nights comes to S$${fresh.amount}.`, result_id: fresh.resultId },
      ] })]; },
    ] },
  ], ["Jun Hao was in hospital 2 nights, no wait, actually 3. What's the hospital cash?"]);
  await check("N3 two questions at once and a person question without real candidates are refused; a stale (corrected) figure is refused at compute and payout wording never reaches the household; an estimate is labelled", () => {
    const t = S.turns[0], v = visible(t.saved.answer);
    const refusals = t.trace.toolCalls.filter((x: any) => !x.ok).map((x: any) => x.error);
    assert.ok(refusals.some((e: string) => /exactly one question/.test(e))); assert.ok(refusals.some((e: string) => /two or more household members/.test(e)));
    assert.ok(t.trace.toolCalls.some((x: any) => x.name === "compute" && x.args.label === "stale" && !x.ok && /not a recorded fact/.test(x.error)), "the stale figure is refused at compute");
    assert.doesNotMatch(v, /S\$200|payout/i);
    assert.match(v, /^Updated: nights in hospital is now 3 \(you first said 2\)\./);
    assert.match(v, /Indicative estimate: FamilyGuard hospital cash of S\$100 per day for 3 nights comes to S\$300\./);
    assert.ok(t.trace.dropped.some((d: any) => /payout/.test(d.reason)));
    assert.deepEqual(t.trace.gate, []);
  });
  const P = await run([
    { steps: [() => [call("resolve_person", { mention: "my son" })], (v) => [call("ask_user", { kind: "person", question: pick(v, "resolve_person").question, options: pick(v, "resolve_person").options.map((o: any) => o.id) })]] },
    { steps: [() => [call("ask_user", { kind: "person", question: "Which son do you mean?", options: [M.junhao.id, M.junwei.id] })], () => [call("resolve_person", { mention: "the younger one" })], (v) => [call("final_answer", { sentences: [{ text: "Thanks, I'll look at the youngest." }] })]] },
  ], ["What does my son's plan cover?", "the younger one"]);
  await check("N4 who is meant is asked once: a second person question right after the household answered is refused", () => {
    const t = P.turns[1];
    assert.ok(t.trace.toolCalls.some((x: any) => x.name === "ask_user" && !x.ok && /already asked who/.test(x.error)));
    assert.equal(t.saved.answer.questions.length, 0);
  });
  const L = await run([{ steps: Array.from({ length: 40 }, () => () => [call("resolve_person", { mention: "me" })]) }], ["Tell me everything"]);
  await check("N5 a model that never ends the turn stops at the step budget with an honest reply (no invented answer)", () => {
    const t = L.turns[0];
    assert.equal(t.trace.outcome, "budget_exhausted"); assert.equal(t.trace.steps, flag.loopBudget().maxSteps);
    assert.doesNotMatch(visible(t.saved.answer), MONEY); assert.match(t.saved.answer.summary, /couldn’t finish/);
  });
  await check("N6 no network call was attempted in the whole suite", () => { assert.deepEqual(h.networkCalls, []); });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:loop-test ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
