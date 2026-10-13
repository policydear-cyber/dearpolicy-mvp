/**
 * Replay of the first actual-model run (docs/rag-migration/live/RUN-s47-live-1-*) WITHOUT any model call: every
 * model step is played back verbatim -- the same tool calls with the same arguments, grouped into the same model
 * calls as the relay log recorded them -- through the REAL chat route on the same synthetic household. Tool results
 * (and so the evidence / value ids the recorded arguments refer to) are deterministic, so the replay reaches the same
 * state the live run did; what the product does with those model outputs is then graded.
 *   node --import tsx scripts/rag2-scenario-replay.ts            (npm run rag2:scenario-replay-test)
 * Evidence class: REPLAY of recorded model output (not a new model result).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-scenario/household";
import type { ScriptTurn } from "@/lib/rag2/loop/scripted-model";

const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
const runDir = (prefix: string) => { const base = "docs/rag-migration/live"; const d = fs.readdirSync(base).filter((x) => x.startsWith(prefix)).sort()[0]; return path.join(base, d); };
const RUN = process.env.REPLAY_RUN ?? runDir("RUN-s47-live-1-");

/** The recorded model calls of each turn: the trace's tool calls, grouped by the relay's per-call tool-call names. */
export function recordedTurns(dir = RUN): { user: string; steps: { name: string; arguments: Record<string, unknown> }[][] }[] {
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const conv = run.conversations.find((c: any) => c.scenario === "S47");
  const relay = fs.readFileSync(path.join(dir, "relay.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l: any) => l.status === 200);
  const out: { user: string; steps: { name: string; arguments: Record<string, unknown> }[][] }[] = [];
  let r = 0;
  for (const t of conv.loaded.turns) {
    const calls: any[] = (t.trace?.toolCalls ?? []).filter((x: any) => x.name !== "model");
    const steps: { name: string; arguments: Record<string, unknown> }[][] = [];
    let i = 0;
    while (i < calls.length) {
      const names: string[] = relay[r++]?.tool_calls ?? [];
      if (!names.length) throw new Error(`relay log has no model call for turn ${t.index + 1} call ${i + 1}`);
      const step = names.map((n) => { const c = calls[i++]; if (!c || c.name !== n) throw new Error(`turn ${t.index + 1}: relay says ${n}, trace says ${c?.name}`); return { name: c.name, arguments: c.args }; });
      steps.push(step);
    }
    out.push({ user: t.user, steps });
  }
  return out;
}

const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => "[Q] " + q.text), ...(a.nextSteps ?? []).map((n) => "[next] " + n)].join("\n");
const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) { try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); } catch (e) { results.push({ name, ok: false }); console.log("FAIL " + name + "\n     " + (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 10).join("\n     ")); } }

async function main() {
  const turns = recordedTurns();
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const script: ScriptTurn[] = turns.map((t) => ({ user: t.user, steps: t.steps.map((s) => () => s) }));
  installLoopModel(new ScriptedLoopModel(script));
  let c: { id?: string; rev?: number } = {};
  const saved: { answer: ChatAnswer; state: any; trace: any }[] = [];
  for (const t of turns) {
    const a = await h.send(t.user, c);
    c = { id: a.conversationId, rev: a.conversationRevision };
    const s = await h.savedAnswer(c.id!);
    saved.push({ answer: s.answer, state: s.state, trace: s.state.ragLoop?.turns.at(-1) });
    console.log(`\nUSER: ${t.user}\nAPP:  ${visible(s.answer).replace(/\n/g, "\n      ")}\n      incomplete=${JSON.stringify(saved.at(-1)!.trace?.incomplete ?? [])} gate=${JSON.stringify(saved.at(-1)!.trace?.gate ?? [])} calcs=${JSON.stringify(((s.answer as any).calculations ?? []).map((r: any) => [r.benefit, r.result?.value]))}`);
  }
  installLoopModel(null);
  if (process.env.REPLAY_ONLY) process.exit(0);
  const t5 = saved[4];
  const v5 = visible(t5.answer);
  const docKey = (id: string) => HH.DOCS.find((d) => d.id === id)?.key;
  await check("turn 5: the closed-tibia illustration (S$9,000) reaches the visible answer, conditionally worded", () => { assert.match(v5, /\bIf\b[^.]*S\$9,000(?![\d,]*\d)/); assert.ok(!/approved payment|you will receive/i.test(v5.replace(/not an approved payment/gi, ""))); });
  await check("turn 5: its calculation record is saved (lump_sum, 6% x S$300,000 x 50%) and re-runs", async () => {
    const r = ((t5.answer as any).calculations ?? []).find((x: any) => x.calculator === "lump_sum");
    assert.ok(r, "no saved calculation record"); assert.equal(r.result.value, 9000);
    assert.deepEqual(r.operands.filter((o: any) => o.source === "document").map((o: any) => o.value).sort((a: number, b: number) => a - b), [6, 50, 300000]);
    const { recomputeCalculation } = await import("@/lib/claims/calc-record"); assert.ok(recomputeCalculation(r).ok);
  });
  await check("turn 5: citations support both the certificate amount and the fracture rule", () => {
    const cites = (t5.answer.citations ?? []).map((x) => `${docKey(x.policyId)}:${x.pageStart}`);
    assert.ok(cites.includes("CERT:1") && cites.includes("PA_WORD:1"), cites.join(","));
    assert.match(v5, /S\$300,000(?![\d,]*\d)/, "the certificate amount is not shown");
    assert.deepEqual(t5.trace?.gate ?? [], [], "the save-time gate rejected something");
  });
  await check("turn 5: the certificate figure is bound to its own product heading and person, the percentage to its own row", () => {
    const b = (t5.answer.figureBindings ?? []).find((x: any) => x.value === 300000);
    assert.ok(b, "no binding for S$300,000"); assert.match(String(b.benefit), /Personal Accident/i); assert.equal(b.subjectId, HH.M.desmond.id); assert.equal(docKey(b.policyId), "CERT");
  });
  const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
  const gate = (a: any) => verifyAnswerFigures(a, { accountId: HH.ACCOUNT, userText: turns[4].user, report: true, priorUserTexts: turns.slice(0, 4).map((t) => t.user) });
  await check("controls: a tampered record, an unrelated record and a wrong-product / wrong-person binding are rejected", async () => {
    const t1 = structuredClone(t5.answer) as any; t1.calculations.find((x: any) => x.calculator === "lump_sum").operands.find((o: any) => o.value === 50).value = 100;
    assert.ok((await gate(t1)).length, "a tampered share passed");
    const t2 = structuredClone(t5.answer) as any; const r2 = t2.calculations.find((x: any) => x.calculator === "lump_sum"); r2.subjectId = HH.M.grace.id;
    assert.ok((await gate(t2)).length, "a record for another person passed");
    const t3 = structuredClone(t5.answer) as any; const b3 = t3.figureBindings.find((x: any) => x.value === 300000); b3.benefit = "Group Term Life";
    assert.ok((await gate(t3)).length, "the certificate figure bound to Group Term Life passed");
    const t4 = structuredClone(t5.answer) as any; const b4 = t4.figureBindings.find((x: any) => x.value === 300000); b4.subjectId = HH.M.grace.id;
    assert.ok((await gate(t4)).length, "the certificate figure bound to Grace passed");
    const t6 = structuredClone(t5.answer) as any; const b6 = t6.figureBindings.find((x: any) => x.value === 300000); b6.currency = "USD";
    assert.ok((await gate(t6)).length, "the certificate figure in another currency passed");
  });
  await check("controls: the fallback resurrects only the calculation the reply attempted -- no femur/kneecap or earlier-turn record", () => {
    const shown = ((t5.answer as any).calculations ?? []).map((r: any) => r.benefit);
    assert.ok(shown.every((b: string) => /tibia|lower leg/i.test(b)), shown.join(" | "));
    for (const [i, s] of saved.entries()) if (i !== 4) assert.ok(!((s.answer as any).calculations ?? []).some((r: any) => r.calculator === "lump_sum"), `turn ${i + 1} shows a lump sum`);
  });
  await check("turn 6 (unchanged): the S$100 hospital estimate is still shown and saved", () => {
    assert.match(visible(saved[5].answer), /S\$100(?![\d,]*\d)/); assert.ok(((saved[5].answer as any).calculations ?? []).some((r: any) => r.result?.value === 100));
  });
  // The second actual-model run (s47-live-2): its turn 1 named the percentages without reading the certificate.
  if (!process.env.REPLAY_RUN) {
    const t2 = recordedTurns(runDir("RUN-s47-live-2-"));
    installLoopModel(new ScriptedLoopModel(t2.map((t) => ({ user: t.user, steps: t.steps.map((st) => () => st) }))));
    const a = await h.send(t2[0].user, {}); const s1 = await h.savedAnswer(a.conversationId!);
    installLoopModel(null);
    const v1 = visible(s1.answer);
    console.log(`\ns47-live-2 turn 1 replayed:\nAPP:  ${v1.replace(/\n/g, "\n      ")}`);
    await check("s47-live-2 turn 1: the omitted certificate lookup is completed by the one bounded lookup (dated amount, own product and person)", () => {
      assert.match(v1, /S\$300,000(?![\d,]*\d)[^.]*1 July 2025/, v1); assert.ok(!/haven['’]t yet read/i.test(v1), v1);
      const look = (s1.state.ragLoop.turns.at(-1).toolCalls as any[]).filter((x) => /grounded fallback/.test(String(x.args?.by ?? "")));
      assert.ok(look.length >= 2 && look.length <= 4, JSON.stringify(look.map((x) => x.name)));
      assert.deepEqual(s1.state.ragLoop.turns.at(-1).gate ?? [], []);
    });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nreplay of s47-live-1 and s47-live-2 ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
