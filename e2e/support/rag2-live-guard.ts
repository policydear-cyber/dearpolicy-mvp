/**
 * Live-model smoke (scripts/rag2-live): the safety checks and the run-cap guard of the live test server.
 *
 * The guard wraps the REAL hosted loop model (lib/rag2/loop/hosted-model.ts, the configured chat model) and is
 * installed through the loop's public installLoopModel hook, so the app path is unchanged: the real /api/chat route,
 * job runner, loop, tools, usage meter, ledger, persistence and save-time gate. It adds only the run's own spend cap,
 * kept by RESERVATION (lib/rag2/loop/usage-meter.ts RunCostLedger): before EVERY model call -- tool-loop steps,
 * retries, any verification call -- the call's worst case (input tokens estimated high + its max output tokens, at the
 * configured model's price on file) is reserved; the call is refused (no network request) when the reservation would
 * pass the cap; afterwards it is settled at the provider-reported usage, and a failed call or one reporting no usage
 * keeps its whole reservation as spent. The meter's own process-wide run budget (DEARPOLICY_RAG_LOOP_RUN_MAX_USD)
 * applies on top. A model with no price on file is refused before the server starts (fail closed).
 */
import { modelFor, priceFor, costUsd, type ModelChoice, type Price } from "@/lib/ai/providers";
import { maxCallCostUsd, reserveInputTokens, RunCostLedger } from "@/lib/rag2/loop/usage-meter";
import type { LoopModel, ModelTurnInput, ModelTurnOutput } from "@/lib/rag2/loop/types";

export const MAX_RUN_CAP_USD = 0.5;
export type GuardCall = {
  seq: number; at: string; estInputTokens: number; maxOutputTokens: number; reservedUsd: number; chargedUsd: number | null;
  ok: boolean; refused?: string; error?: string; usage?: { input: number; output: number }; latencyMs?: number;
  requestedModel: string; resolvedModel?: string | null; tools: number; messages: number;
};

/** Every precondition of a live run; throws with the first one that fails. Never prints a secret. */
export function liveSafetyChecks(env: NodeJS.ProcessEnv = process.env): { choice: ModelChoice; price: Price; capUsd: number } {
  const fail = (m: string) => { throw new Error("live run refused: " + m); };
  if (env.NODE_ENV !== "test") fail("NODE_ENV must be \"test\"");
  if ((env.VERCEL ?? "") !== "" || (env.VERCEL_ENV ?? "") !== "") fail("VERCEL / VERCEL_ENV must be unset");
  const host = (u: string | undefined) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
  if (!["localhost", "127.0.0.1"].includes(host(env.DATABASE_URL))) fail(`DATABASE_URL must be a local database (host "${host(env.DATABASE_URL)}")`);
  if (host(env.OPENAI_BASE_URL) !== "127.0.0.1") fail("OPENAI_BASE_URL must point at the loopback relay (http://127.0.0.1:8787/v1)");
  const key = env.OPENAI_API_KEY ?? "";
  if (!key) fail("OPENAI_API_KEY must be set to a non-secret dummy value (the relay drops it)");
  if (/^sk-/.test(key) || key.length > 64) fail("OPENAI_API_KEY looks like a real key: the live run uses a dummy value; the real key stays in the Composio connection");
  for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"]) if (env[k]) fail(`${k} must be unset (only the relay is reachable)`);
  if (env.DEARPOLICY_DETERMINISTIC_MODEL) fail("DEARPOLICY_DETERMINISTIC_MODEL must be unset (it would stop the real model being called)");
  const cap = Number(env.RAG2_LIVE_RUN_CAP_USD ?? "0.5");
  if (!Number.isFinite(cap) || cap <= 0 || cap > MAX_RUN_CAP_USD) fail(`RAG2_LIVE_RUN_CAP_USD must be > 0 and <= ${MAX_RUN_CAP_USD} (got ${env.RAG2_LIVE_RUN_CAP_USD})`);
  const meterCap = Number(env.DEARPOLICY_RAG_LOOP_RUN_MAX_USD ?? "");
  if (!Number.isFinite(meterCap) || meterCap <= 0 || meterCap > MAX_RUN_CAP_USD) fail(`DEARPOLICY_RAG_LOOP_RUN_MAX_USD must be set, > 0 and <= ${MAX_RUN_CAP_USD}`);
  if (env.DEARPOLICY_RAG_LOOP_REQUIRE_PRICE !== "1") fail("DEARPOLICY_RAG_LOOP_REQUIRE_PRICE must be 1 (an unpriced model is refused, never budgeted at a guess)");
  const choice = modelFor("chat");
  if (choice.provider !== "openai") fail(`the chat model resolves to ${choice.provider}:${choice.model}; set CHAT_MODEL=openai:<model>`);
  if (env.RAG2_LIVE_EXPECT_MODEL && `${choice.provider}:${choice.model}` !== env.RAG2_LIVE_EXPECT_MODEL) fail(`the chat model resolves to ${choice.provider}:${choice.model}, not ${env.RAG2_LIVE_EXPECT_MODEL}`);
  const price = priceFor(choice);
  if (!price) fail(`no price on file for ${choice.provider}:${choice.model} in lib/ai/providers.ts: refusing to run (fail closed)`);
  return { choice, price: price!, capUsd: Math.min(cap, meterCap) };
}

export class RunCapGuardModel implements LoopModel {
  readonly kind = "hosted" as const;
  readonly id: string;
  readonly choice: ModelChoice;
  readonly calls: GuardCall[] = [];
  constructor(private readonly inner: LoopModel, readonly ledger: RunCostLedger, readonly price: Price) {
    if (!inner.choice) throw new Error("the guarded model must be a hosted model with a provider choice");
    this.id = inner.id; this.choice = inner.choice;
  }
  async next(input: ModelTurnInput): Promise<ModelTurnOutput> {
    const est = reserveInputTokens(input);
    const usd = maxCallCostUsd(this.price, est, input.maxOutputTokens);
    const base = { seq: this.calls.length + 1, at: new Date().toISOString(), estInputTokens: est, maxOutputTokens: input.maxOutputTokens, reservedUsd: usd, requestedModel: `${this.choice.provider}:${this.choice.model}`, tools: input.tools.length, messages: input.messages.length };
    const r = this.ledger.reserve(usd, est, input.maxOutputTokens);
    if ("refused" in r) {
      this.calls.push({ ...base, chargedUsd: 0, ok: false, refused: r.refused });
      // "spend" keeps the meter from retrying it; no request is sent.
      throw new Error(`live run spend cap reached, no model call made: ${r.refused}`);
    }
    const t0 = Date.now();
    try {
      const out = await this.inner.next(input);
      const reported = out.usage.input > 0 || out.usage.output > 0;
      const charged = this.ledger.settle(r, reported ? costUsd(this.choice, out.usage) : null);
      this.calls.push({ ...base, chargedUsd: charged, ok: true, usage: out.usage, latencyMs: Date.now() - t0, resolvedModel: out.resolvedModel ?? null });
      return out;
    } catch (error) {
      const charged = this.ledger.settle(r, null);
      this.calls.push({ ...base, chargedUsd: charged, ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200), latencyMs: Date.now() - t0 });
      throw error;
    }
  }
}
