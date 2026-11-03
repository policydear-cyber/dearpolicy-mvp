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
 *
 * Two ways to reach the model (RAG2_LIVE_MODE):
 *  - relay (default): OPENAI_BASE_URL is the loopback relay (scripts/rag2-live/relay.py) and OPENAI_API_KEY a dummy;
 *  - direct (CI only): GITHUB_ACTIONS=true and CI=true, OPENAI_BASE_URL unset or exactly https://api.openai.com/v1,
 *    OPENAI_API_KEY the repository secret. The key is never printed, logged or persisted; nothing here records request
 *    headers. Per call the guard records what the relay recorded before: provider-reported model and usage, upstream
 *    latency (measured around the provider request), the request settings and the prompt / tool-schema sha256.
 * RAG2_LIVE_PREFLIGHT=1: the guard refuses the FIRST model call ("preflight: no model call made") without reserving
 * or sending anything, so a run exercises build, seed, server and the /api/chat path at US$0.
 *
 * Cumulative admission (every entry point calls liveSafetyChecks, so none can start without it): the run's cap is
 * min(RAG2_LIVE_RUN_CAP_USD, meter cap, what is left of the US$1.00 exercise in the LEDGER -- every earlier run's spend and
 * unsettled reservations, including the open trial-codespace allowance). RAG2_LIVE_RUN_ID names the run; the ledger
 * (RAG2_LIVE_LEDGER, default docs/rag-migration/live/LEDGER.json) must be readable and valid, the run_id must be unused,
 * and nothing may be left to refuse. A preflight run spends US$0, so it is refused only for an unreadable ledger or a used
 * run_id. There is no bypass: a cost written only in a results document does not count.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { planRun, validateLedger } from "../../scripts/rag2-live/ledger";
import { modelFor, priceFor, costUsd, type ModelChoice, type Price } from "@/lib/ai/providers";
import { loopRequestSettings } from "@/lib/rag2/loop/hosted-model";
import { maxCallCostUsd, reserveInputTokens, RunCostLedger } from "@/lib/rag2/loop/usage-meter";
import type { LoopModel, ModelTurnInput, ModelTurnOutput } from "@/lib/rag2/loop/types";

export const MAX_RUN_CAP_USD = 0.5;
export const OPENAI_DIRECT_BASE = "https://api.openai.com/v1";
export const PREFLIGHT_REFUSAL = "preflight: no model call made";
/** The placeholder the CI workflow passes when the repository secret is absent (preflight only; never a key). */
export const NO_KEY_PLACEHOLDER = "preflight-no-key-set";
export type LiveMode = "relay" | "direct";
export const DEFAULT_LEDGER_PATH = "docs/rag-migration/live/LEDGER.json";
export type GuardCall = {
  seq: number; at: string; estInputTokens: number; maxOutputTokens: number; reservedUsd: number; chargedUsd: number | null;
  ok: boolean; refused?: string; error?: string; usage?: { input: number; output: number }; latencyMs?: number;
  /** Measured around the provider request itself (hosted-model.ts), without the loop's own work. */
  upstreamMs?: number;
  requestedModel: string; resolvedModel?: string | null; tools: number; messages: number;
  settings?: Record<string, unknown>; systemPromptSha256?: string | null; toolsSha256?: string;
};
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
/** Sorted-key JSON, as relay.py hashes the tool schema it forwards. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(v);
}

/** Every precondition of a live run; throws with the first one that fails. Never prints a secret. */
export function liveSafetyChecks(env: NodeJS.ProcessEnv = process.env): { choice: ModelChoice; price: Price; capUsd: number; mode: LiveMode; preflight: boolean; runId: string; remainingUsd: number } {
  const fail = (m: string) => { throw new Error("live run refused: " + m); };
  const rawMode = env.RAG2_LIVE_MODE ?? "";
  if (rawMode !== "" && rawMode !== "relay" && rawMode !== "direct") fail(`RAG2_LIVE_MODE must be "relay" (default) or "direct"`);
  const mode: LiveMode = rawMode === "direct" ? "direct" : "relay";
  const preflight = env.RAG2_LIVE_PREFLIGHT === "1";
  if (env.NODE_ENV !== "test") fail("NODE_ENV must be \"test\"");
  if ((env.VERCEL ?? "") !== "" || (env.VERCEL_ENV ?? "") !== "") fail("VERCEL / VERCEL_ENV must be unset");
  const host = (u: string | undefined) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
  if (!["localhost", "127.0.0.1"].includes(host(env.DATABASE_URL))) fail(`DATABASE_URL must be a local database (host "${host(env.DATABASE_URL)}")`);
  const key = env.OPENAI_API_KEY ?? "";
  if (mode === "direct") {
    // CI only: the repository secret goes straight to OpenAI. Nothing about the key is ever echoed.
    if (env.GITHUB_ACTIONS !== "true" || env.CI !== "true") fail("RAG2_LIVE_MODE=direct is allowed only in GitHub Actions (GITHUB_ACTIONS=true and CI=true)");
    if (env.OPENAI_BASE_URL !== undefined && env.OPENAI_BASE_URL !== OPENAI_DIRECT_BASE) fail(`in direct mode OPENAI_BASE_URL must be unset or exactly ${OPENAI_DIRECT_BASE}`);
    if (!key) fail("in direct mode OPENAI_API_KEY must be set (the OPENAI_TEST_API_KEY repository secret)");
    if (key === NO_KEY_PLACEHOLDER && !preflight) fail("OPENAI_TEST_API_KEY not set: only a preflight run is possible");
  } else {
    if (host(env.OPENAI_BASE_URL) !== "127.0.0.1") fail("OPENAI_BASE_URL must point at the loopback relay (http://127.0.0.1:8787/v1)");
    if (!key) fail("OPENAI_API_KEY must be set to a non-secret dummy value (the relay drops it)");
    if (/^sk-/.test(key) || key.length > 64) fail("OPENAI_API_KEY looks like a real key: the live run uses a dummy value; the real key stays in the Composio connection");
  }
  for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"]) if (env[k]) fail(`${k} must be unset (only the relay is reachable)`);
  if (env.DEARPOLICY_DETERMINISTIC_MODEL) fail("DEARPOLICY_DETERMINISTIC_MODEL must be unset (it would stop the real model being called)");
  const cap = Number(env.RAG2_LIVE_RUN_CAP_USD ?? "0.5");
  if (!Number.isFinite(cap) || cap <= 0 || cap > MAX_RUN_CAP_USD) fail(`RAG2_LIVE_RUN_CAP_USD must be > 0 and <= ${MAX_RUN_CAP_USD} (got ${env.RAG2_LIVE_RUN_CAP_USD})`);
  const meterCap = Number(env.DEARPOLICY_RAG_LOOP_RUN_MAX_USD ?? "");
  if (!Number.isFinite(meterCap) || meterCap <= 0 || meterCap > MAX_RUN_CAP_USD) fail(`DEARPOLICY_RAG_LOOP_RUN_MAX_USD must be set, > 0 and <= ${MAX_RUN_CAP_USD}`);
  if (env.DEARPOLICY_RAG_LOOP_REQUIRE_PRICE !== "1") fail("DEARPOLICY_RAG_LOOP_REQUIRE_PRICE must be 1 (an unpriced model is refused, never budgeted at a guess)");
  const choice = modelFor("chat", env);
  if (choice.provider !== "openai") fail(`the chat model resolves to ${choice.provider}:${choice.model}; set CHAT_MODEL=openai:<model>`);
  if (env.RAG2_LIVE_EXPECT_MODEL && `${choice.provider}:${choice.model}` !== env.RAG2_LIVE_EXPECT_MODEL) fail(`the chat model resolves to ${choice.provider}:${choice.model}, not ${env.RAG2_LIVE_EXPECT_MODEL}`);
  // Every role the run configures resolves to exactly that model (no silent substitution, e.g. a missing key falling
  // back to another provider). The CI run sets all four, mirroring production.
  for (const [role, v] of [["chat", env.CHAT_MODEL], ["judgement", env.JUDGEMENT_MODEL], ["narration", env.NARRATION_MODEL], ["reading", env.READING_MODEL]] as const) {
    if (!v) continue;
    const got = modelFor(role, env);
    if (`${got.provider}:${got.model}` !== v.trim()) fail(`${role} model resolves to ${got.provider}:${got.model}, not ${v.trim()} (substituted)`);
  }
  const price = priceFor(choice);
  if (!price) fail(`no price on file for ${choice.provider}:${choice.model} in lib/ai/providers.ts: refusing to run (fail closed)`);
  // Cumulative admission against the authoritative ledger.
  const runId = env.RAG2_LIVE_RUN_ID ?? "";
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(runId)) fail("RAG2_LIVE_RUN_ID (1-40 of A-Z a-z 0-9 . _ -) is required: the run must be admitted against the cumulative ledger");
  const ledgerPath = env.RAG2_LIVE_LEDGER || DEFAULT_LEDGER_PATH;
  let ledger;
  try { ledger = validateLedger(JSON.parse(fs.readFileSync(ledgerPath, "utf8"))); } catch (e) { return fail(`the cumulative ledger ${ledgerPath} is missing or invalid (${e instanceof Error ? e.message : e}): refusing to start`); }
  const wanted = Math.min(cap, meterCap);
  const plan = planRun(ledger, { run_id: runId, scenarios: [], run_cap_usd: wanted, preflight });
  let admitted = wanted;
  if (plan.ok) admitted = plan.capUsd;
  else if (!preflight || ledger.runs.some((r) => r.run_id === runId)) fail(plan.reason);
  return { choice, price: price!, capUsd: admitted, mode, preflight, runId, remainingUsd: plan.ok ? plan.remainingUsd : 0 };
}

export class RunCapGuardModel implements LoopModel {
  readonly kind = "hosted" as const;
  readonly id: string;
  readonly choice: ModelChoice;
  readonly calls: GuardCall[] = [];
  /** reserve=false (the live server): the process-wide fetch guard reserves and settles every provider request on the
   * same ledger; this guard then only refuses a call whose worst case no longer fits, and records it. */
  constructor(private readonly inner: LoopModel, readonly ledger: RunCostLedger, readonly price: Price, readonly preflight = false, private readonly opts: { reserve?: boolean } = {}) {
    if (!inner.choice) throw new Error("the guarded model must be a hosted model with a provider choice");
    this.id = inner.id; this.choice = inner.choice;
  }
  async next(input: ModelTurnInput): Promise<ModelTurnOutput> {
    const est = reserveInputTokens(input);
    const usd = maxCallCostUsd(this.price, est, input.maxOutputTokens);
    const system = input.messages.find((m) => m.role === "system") as { content: string } | undefined;
    const base = { seq: this.calls.length + 1, at: new Date().toISOString(), estInputTokens: est, maxOutputTokens: input.maxOutputTokens, reservedUsd: usd, requestedModel: `${this.choice.provider}:${this.choice.model}`, tools: input.tools.length, messages: input.messages.length,
      systemPromptSha256: system ? sha(system.content.split("\n\nConversation state:")[0]) : null,
      toolsSha256: sha(canon(input.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })))) };
    if (this.preflight) {
      // Nothing reserved, nothing sent. "spend" keeps the meter from retrying it.
      this.calls.push({ ...base, reservedUsd: 0, chargedUsd: 0, ok: false, refused: PREFLIGHT_REFUSAL });
      throw new Error(`${PREFLIGHT_REFUSAL} (no spend)`);
    }
    if (this.opts.reserve === false) {
      if (usd > this.ledger.remainingUsd + 1e-12) {
        const why = `run cap US$${this.ledger.capUsd}: US$${this.ledger.spentUsd.toFixed(6)} spent + US$${this.ledger.reservedUsd.toFixed(6)} reserved; the next call may cost up to US$${usd.toFixed(6)}`;
        this.calls.push({ ...base, chargedUsd: 0, ok: false, refused: why });
        throw new Error(`live run spend cap reached, no model call made: ${why}`);
      }
      const t0 = Date.now();
      try {
        const out = await this.inner.next(input);
        this.calls.push({ ...base, chargedUsd: null, ok: true, usage: out.usage, latencyMs: Date.now() - t0, upstreamMs: out.latencyMs, resolvedModel: out.resolvedModel ?? null, settings: loopRequestSettings(this.choice.provider, this.choice.model, input.maxOutputTokens) });
        return out;
      } catch (error) {
        this.calls.push({ ...base, chargedUsd: null, ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200), latencyMs: Date.now() - t0, settings: loopRequestSettings(this.choice.provider, this.choice.model, input.maxOutputTokens) });
        throw error;
      }
    }
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
      this.calls.push({ ...base, chargedUsd: charged, ok: true, usage: out.usage, latencyMs: Date.now() - t0, upstreamMs: out.latencyMs, resolvedModel: out.resolvedModel ?? null, settings: loopRequestSettings(this.choice.provider, this.choice.model, input.maxOutputTokens) });
      return out;
    } catch (error) {
      const charged = this.ledger.settle(r, null);
      this.calls.push({ ...base, chargedUsd: charged, ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200), latencyMs: Date.now() - t0, upstreamMs: Date.now() - t0, settings: loopRequestSettings(this.choice.provider, this.choice.model, input.maxOutputTokens) });
      throw error;
    }
  }
}
