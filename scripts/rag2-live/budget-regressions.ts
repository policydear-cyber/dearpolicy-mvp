/**
 * Live-model smoke: the run-cap reservation logic (lib/rag2/loop/usage-meter.ts RunCostLedger + the meter's run budget,
 * e2e/support/rag2-live-guard.ts RunCapGuardModel). No network: the "hosted" models here are in-process fakes that
 * report usage like the provider does. Needs the local database (the meter records every call) with the live
 * household seeded (node --import tsx e2e/support/seed-rag2-live.ts).
 *   NODE_ENV=test DATABASE_URL=postgres://...@localhost/... node --import tsx scripts/rag2-live/budget-regressions.ts
 */
import assert from "node:assert/strict";
import { pool } from "@/lib/db/client";
import { loopLimits, loopRunUsage, resetLoopRunUsage } from "@/lib/ai/usage";
import { priceFor } from "@/lib/ai/providers";
import { estimateTokens, LoopUsageMeter, maxCallCostUsd, reserveInputTokens, RunCostLedger } from "@/lib/rag2/loop/usage-meter";
import type { LoopModel, ModelTurnInput, ModelTurnOutput } from "@/lib/rag2/loop/types";
import { RunCapGuardModel } from "../../e2e/support/rag2-live-guard";
import { HostedLoopModel, loopRequestSettings } from "@/lib/rag2/loop/hosted-model";
import { ACCOUNT_L } from "../fixtures/rag2-live/household";

const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1"].includes(host)) throw new Error("local database only");

class FakeHosted implements LoopModel {
  readonly kind = "hosted" as const; readonly id: string; calls = 0;
  constructor(readonly choice: { provider: "openai"; model: string }, private readonly behave: (n: number) => ModelTurnOutput | Error) { this.id = `openai:${choice.model}`; }
  async next(_input: ModelTurnInput): Promise<ModelTurnOutput> { this.calls++; const r = this.behave(this.calls); if (r instanceof Error) throw r; return r; }
}
const ok = (input: number, output: number): ModelTurnOutput => ({ toolCalls: [{ id: "c1", name: "final_answer", arguments: { sentences: [{ text: "ok" }] } }], text: null, usage: { input, output }, modelId: "openai:gpt-6-luna", resolvedModel: "gpt-6-luna-test", latencyMs: 1 });
const input = { messages: [{ role: "system" as const, content: "x".repeat(7000) }, { role: "user" as const, content: "hello" }], tools: [], maxOutputTokens: 2000 };
const LUNA = { provider: "openai" as const, model: "gpt-6-luna" };

let passed = 0, failed = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + String((e as Error).message ?? e).split("\n").join("\n     ")); }
}

(async () => {
  const price = priceFor(LUNA)!;
  await t("B0 the configured model has a price on file (gpt-6-luna)", () => { assert.ok(price); assert.equal(price.input, 0.1); assert.equal(price.output, 0.5); });
  await t("B1 ledger: reserves the worst case, refuses past the cap, settles at the actual cost", () => {
    const l = new RunCostLedger(0.01);
    const a = l.reserve(0.006, 1000, 2000); assert.ok(!("refused" in a));
    const b = l.reserve(0.006, 1000, 2000); assert.ok("refused" in b, "a second reservation passing the cap is refused");
    assert.equal(l.settle(a as any, 0.001), 0.001); assert.ok(Math.abs(l.spentUsd - 0.001) < 1e-12); assert.equal(l.reservedUsd, 0);
    const c = l.reserve(0.006, 1000, 2000); assert.ok(!("refused" in c), "after settling, room is released");
  });
  await t("B2 ledger: a failed call (no usage reported) keeps its whole reservation as spent", () => {
    const l = new RunCostLedger(0.5); const r = l.reserve(0.004, 1, 1) as any;
    assert.equal(l.settle(r, null), 0.004); assert.equal(l.spentUsd, 0.004); assert.equal(l.calls, 1);
  });
  await t("B3 reservation = (input tokens, estimated high + max output tokens) x the model's price", () => {
    const est = reserveInputTokens(input);
    assert.ok(est > estimateTokens(input), "the reservation's input estimate is above the meter's token estimate");
    assert.ok(Math.abs(maxCallCostUsd(price, est, 2000) - (est * 0.1 + 2000 * 0.5) / 1e6) < 1e-15);
  });
  await t("B4 meter: a call whose reservation would pass the run cap is refused before the model is called", async () => {
    resetLoopRunUsage();
    const m = new FakeHosted(LUNA, () => ok(100, 10));
    const limits = { ...loopLimits(), runMaxUsd: 0.0005 };
    const meter = new LoopUsageMeter({ model: m, accountId: ACCOUNT_L, limits, startedAt: Date.now(), promptVersion: "rag2-loop-test" });
    const r = await meter.next(input);
    assert.equal(r.ok, false); assert.equal((r as any).stop.kind, "run_budget"); assert.equal(m.calls, 0);
  });
  await t("B5 meter: settled at the provider-reported usage when the call succeeds", async () => {
    resetLoopRunUsage();
    const m = new FakeHosted(LUNA, () => ok(10_000, 500));
    const meter = new LoopUsageMeter({ model: m, accountId: ACCOUNT_L, limits: { ...loopLimits(), runMaxUsd: 0.5 }, startedAt: Date.now(), promptVersion: "rag2-loop-test" });
    const r = await meter.next(input); assert.equal(r.ok, true);
    assert.ok(Math.abs(loopRunUsage().usd - (10_000 * 0.1 + 500 * 0.5) / 1e6) < 1e-12, `run usd ${loopRunUsage().usd}`);
  });
  await t("B6 meter: a failed call and its retry each keep their reservation as spent (never 0)", async () => {
    resetLoopRunUsage();
    const m = new FakeHosted(LUNA, () => new Error("model service returned an error (500)"));
    const limits = { ...loopLimits(), runMaxUsd: 0.5, retries: 1 };
    const meter = new LoopUsageMeter({ model: m, accountId: ACCOUNT_L, limits, startedAt: Date.now(), promptVersion: "rag2-loop-test" });
    const r = await meter.next(input);
    assert.equal(r.ok, false); assert.equal(m.calls, 2, "retried once");
    const one = maxCallCostUsd(price, reserveInputTokens(input), 2000);
    assert.ok(Math.abs(loopRunUsage().usd - 2 * one) < 1e-12, `run usd ${loopRunUsage().usd} vs ${2 * one}`);
    assert.equal(loopRunUsage().calls, 2);
  });
  await t("B7 meter: an unpriced model is refused (fail closed) when DEARPOLICY_RAG_LOOP_REQUIRE_PRICE=1", async () => {
    resetLoopRunUsage();
    process.env.DEARPOLICY_RAG_LOOP_REQUIRE_PRICE = "1";
    try {
      const m = new FakeHosted({ provider: "openai", model: "gpt-unpriced-test" }, () => ok(1, 1));
      const meter = new LoopUsageMeter({ model: m, accountId: ACCOUNT_L, limits: loopLimits(), startedAt: Date.now(), promptVersion: "rag2-loop-test" });
      const r = await meter.next(input);
      assert.equal(r.ok, false); assert.match((r as any).stop.detail, /no price on file/); assert.equal(m.calls, 0);
    } finally { delete process.env.DEARPOLICY_RAG_LOOP_REQUIRE_PRICE; }
  });
  await t("B8 live guard: reserves before every call, refuses (no request) once the cap would pass, charges failures in full", async () => {
    const one = maxCallCostUsd(price, reserveInputTokens(input), 2000);
    let n = 0;
    const inner = new FakeHosted(LUNA, () => (++n === 2 ? new Error("model service returned an error (502)") : ok(0, 0)));
    const g = new RunCapGuardModel(inner, new RunCostLedger(one * 2.5), price);
    await g.next(input);                       // success reporting no usage: reservation kept
    await assert.rejects(() => g.next(input)); // failure: reservation kept
    await assert.rejects(() => g.next(input), /spend cap/); // the third would pass the cap
    assert.equal(inner.calls, 2, "the refused call never reached the model");
    assert.ok(Math.abs(g.ledger.spentUsd - 2 * one) < 1e-12);
    assert.equal(g.calls.filter((c) => c.refused).length, 1);
  });
  await t("B9 hosted model: a 400 naming an optional setting (temperature) is sent again once without it, and remembered", async () => {
    const saved = { key: process.env.OPENAI_API_KEY, det: process.env.DEARPOLICY_DETERMINISTIC_MODEL };
    process.env.OPENAI_API_KEY = "dummy-not-a-key"; delete process.env.DEARPOLICY_DETERMINISTIC_MODEL;
    try {
      const bodies: any[] = [];
      const http = (async (_u: string, init: any) => {
        const b = JSON.parse(init.body); bodies.push(b);
        if ("temperature" in b) return new Response(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0 with this model." } }), { status: 400 });
        return new Response(JSON.stringify({ model: "gpt-6-luna-x", usage: { prompt_tokens: 5, completion_tokens: 2 }, choices: [{ message: { content: null, tool_calls: [] } }] }), { status: 200 });
      }) as unknown as typeof fetch;
      const m = new HostedLoopModel({ provider: "openai", model: "gpt-strip-test" }, http);
      const out = await m.next(input);
      assert.equal(bodies.length, 2); assert.ok(!("temperature" in bodies[1])); assert.equal(bodies[1].tool_choice, "required");
      assert.deepEqual(out.usage, { input: 5, output: 2 });
      await m.next(input); assert.equal(bodies.length, 3, "remembered: no second 400"); assert.ok(!("temperature" in bodies[2]));
      assert.ok(!("temperature" in loopRequestSettings("openai", "gpt-strip-test", 2000)));
    } finally { if (saved.key == null) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.key; if (saved.det != null) process.env.DEARPOLICY_DETERMINISTIC_MODEL = saved.det; }
  });
  resetLoopRunUsage();
  console.log(`\nrag2-live budget regressions ${passed}/${passed + failed} passed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
