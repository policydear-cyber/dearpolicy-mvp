/**
 * V1.1 Task 5: model usage and budgets, from what was actually recorded.
 *
 * Two different numbers, never confused:
 *   - The OWNER'S PROVIDER BUDGET (e.g. the $5/month cap set on the OpenAI
 *     account). It is an owner setting shown for comparison only. DearPolicy
 *     does not and cannot enforce the provider's billing cap; the provider
 *     does. Nothing here claims otherwise.
 *   - The INTERNAL PER-HOUSEHOLD LIMIT (PLAN_HARD_STOP_USD, lib/ai/ledger.ts
 *     assertUnderSpendCap). That one IS enforced by DearPolicy, before each
 *     hosted call, for the household the call is for.
 *
 * Usage figures come from model_executions: one row per attempt, with the
 * provider-reported tokens and the priced cost of that attempt.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { query } from "@/lib/db/client";
import { ensureProvenanceSchema } from "./provenance";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { planLimits } from "./ledger";

// ---------------------------------------------------------------------------
// Which household a model call is for, for the whole request/job.
// ---------------------------------------------------------------------------
const householdScope = new AsyncLocalStorage<{ householdId: string; exhausted?: Set<string>; deadline?: number }>();
/** Runs `fn` with every model call inside it attributed to `householdId`.
 * Round 10: with `budgetMs`, every model call inside it also shares one time
 * budget (lib/ai/llm.ts clamps each call's timeout to what is left and fails
 * a call fast once it is spent), so a slow or hanging provider can no longer
 * stack 150-second timeouts and retries past the platform's function limit --
 * the turn falls back to what code can answer instead of dying mid-answer. */
export function runWithModelHousehold<T>(householdId: string, fn: () => Promise<T>, opts: { budgetMs?: number } = {}): Promise<T> {
  const deadline = opts.budgetMs != null && opts.budgetMs > 0 ? Date.now() + opts.budgetMs : undefined;
  return householdScope.run({ householdId, exhausted: new Set(), deadline }, fn);
}
/** Milliseconds left in this request's model time budget; null when none was set. */
export function remainingModelTimeMs(): number | null {
  const deadline = householdScope.getStore()?.deadline;
  return deadline == null ? null : Math.max(0, deadline - Date.now());
}
/** A chat turn's model time budget: CHAT_TURN_MODEL_BUDGET_MS, default 150 s
 * (the chat functions' limit is 300 s; the rest is the database, the answer
 * itself and the retry the job runner may still need). */
export function chatTurnModelBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CHAT_TURN_MODEL_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 5_000 ? Math.min(raw, 270_000) : 150_000;
}
/** Round 8: a provider account found out of quota during this request. The
 * rest of the request answers without it rather than calling an account that
 * cannot answer (exhausted quota is shared by every model on the account). */
export function markProviderExhausted(provider: string) { householdScope.getStore()?.exhausted?.add(provider); }
export function providerExhaustedThisRequest(provider: string) { return householdScope.getStore()?.exhausted?.has(provider) ?? false; }
/** The household of the current request, when one was set. In a local
 * development session (DEV_AUTH_ENABLED, one household per process) the
 * development account is used; in production there is no such default, so
 * a call is never booked to the wrong household. */
export function currentModelHousehold(): string | null {
  const scoped = householdScope.getStore()?.householdId;
  if (scoped) return scoped;
  if (process.env.DEV_AUTH_ENABLED === "1" && process.env.NODE_ENV !== "production" && process.env.DEV_ACCOUNT_ID) return process.env.DEV_ACCOUNT_ID;
  return null;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------
export type BudgetConfig = {
  /** The owner's own monthly cap on the model provider account. Display only. */
  ownerProviderBudget: { amountUsd: number | null; source: "owner_setting" | "owner_default" | "not_set"; enforcedByDearPolicy: false; note: string };
  /** DearPolicy's own per-household monthly stop, enforced before hosted calls. */
  householdLimit: { amountUsd: number; enforcedByDearPolicy: true; note: string };
};
export function budgetConfig(env: NodeJS.ProcessEnv = process.env): BudgetConfig {
  // The owner's stated budget is US$5/month on the provider account; a
  // deployment can set OWNER_PROVIDER_BUDGET_USD (an empty value = not set).
  const raw = env.OWNER_PROVIDER_BUDGET_USD;
  const owner = raw == null ? 5 : raw.trim() !== "" && Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
  return {
    ownerProviderBudget: {
      amountUsd: owner,
      source: raw == null ? "owner_default" : owner == null ? "not_set" : "owner_setting",
      enforcedByDearPolicy: false,
      note: "Your monthly limit on the model provider account. The provider enforces it; DearPolicy only shows spend against it.",
    },
    householdLimit: {
      amountUsd: planLimits().hardStopUsd,
      enforcedByDearPolicy: true,
      note: "DearPolicy stops new model calls for a household that reaches this amount in a month.",
    },
  };
}

// ---------------------------------------------------------------------------
// Usage by operation and model
// ---------------------------------------------------------------------------
export type UsageRow = { operation: string; role: string; provider: string; model: string; calls: number; failedCalls: number;
  inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number; unpricedCalls: number };
/** inputTokens include cachedTokens (the part the provider served from its prompt cache, priced at the cached rate). */
export type UsageReport = { since: string; scope: "household" | "all_households"; calls: number; failedCalls: number;
  inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number; unpricedCalls: number; rows: UsageRow[] };

/** Recorded model usage since `since`, grouped by operation and model. With
 * an accountId, only that household's calls; with null, every call on the
 * provider account (the owner's view, the one to hold against the owner's
 * provider budget). The model is the provider-reported one when present. */
export async function usageByOperationAndModel(accountId: string | null, since: Date): Promise<UsageReport> {
  await ensureProvenanceSchema();
  const params: unknown[] = [since.toISOString()];
  let where = "created_at >= $1";
  if (accountId) { params.push(pseudonymizeId(accountId)); where += " AND household_ref = $2"; }
  const r = await query<{ operation: string; role: string; provider: string; model: string; calls: number; failed: number;
    input_tokens: string; output_tokens: string; cached_tokens: string; cost_usd: string; unpriced: number }>(
    `SELECT operation, role, requested_provider AS provider, coalesce(resolved_model, requested_model) AS model,
            count(*)::int AS calls, count(*) FILTER (WHERE status='failed')::int AS failed,
            coalesce(sum(input_tokens),0)::text AS input_tokens, coalesce(sum(output_tokens),0)::text AS output_tokens,
            coalesce(sum(cached_tokens),0)::text AS cached_tokens, coalesce(sum(cost_usd),0)::text AS cost_usd,
            count(*) FILTER (WHERE status='succeeded' AND cost_usd IS NULL)::int AS unpriced
       FROM model_executions WHERE ${where}
      GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`, params);
  const rows: UsageRow[] = r.rows.map((x) => ({ operation: x.operation, role: x.role, provider: x.provider, model: x.model,
    calls: x.calls, failedCalls: x.failed, inputTokens: Number(x.input_tokens), outputTokens: Number(x.output_tokens),
    cachedTokens: Number(x.cached_tokens), costUsd: Number(x.cost_usd), unpricedCalls: x.unpriced }));
  const sum = (f: (row: UsageRow) => number) => rows.reduce((n, row) => n + f(row), 0);
  return { since: since.toISOString(), scope: accountId ? "household" : "all_households", rows,
    calls: sum((x) => x.calls), failedCalls: sum((x) => x.failedCalls), inputTokens: sum((x) => x.inputTokens),
    outputTokens: sum((x) => x.outputTokens), cachedTokens: sum((x) => x.cachedTokens), costUsd: Math.round(sum((x) => x.costUsd) * 1e6) / 1e6, unpricedCalls: sum((x) => x.unpricedCalls) };
}
export function startOfMonth(now = new Date()) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); }

// ---------------------------------------------------------------------------
// Conversation-loop budgets (the conversation loop's usage meter checks every loop model call against these).
//
// Every amount here is DearPolicy's own internal limit, enforced before each call. None of them is, or makes, a
// spend cap on the provider API key: the provider bills whatever the key is used for, and the owner's monthly
// provider budget (US$5) is a figure these limits are kept beneath -- a setting above the ceiling is clamped down to
// it, never honoured, and nothing here raises it.
// ---------------------------------------------------------------------------
export type LoopLimits = {
  /** Model calls per chat turn, counting failed attempts and retries. */
  maxCallsPerTurn: number;
  /** Input + output tokens per chat turn (provider-reported; checked before each call against an estimate of it). */
  maxTokensPerTurn: number;
  maxOutputTokens: number;
  /** Priced cost per chat turn (US$). */
  maxTurnUsd: number;
  /** Retries of a failed call (a timeout, a dropped connection, a busy provider); each retry is a counted call. */
  retries: number;
  /** One call's timeout, and the whole turn's model time (whichever ends first; also the chat's own model budget). */
  callTimeoutMs: number;
  turnTimeoutMs: number;
  /** Loop spend per household per calendar month (US$; from model_executions), on top of the plan hard stop. */
  householdMonthlyUsd: number;
  /** A bounded run budget for this process (an evaluation or test run, or one Preview instance): calls and US$. */
  runMaxCalls: number;
  runMaxUsd: number;
  /** Price per million tokens used for budgeting when the model has no price on file (deliberately high). */
  fallbackPrice: { input: number; output: number };
  /** The ceiling every US$ limit is clamped to: 80% of the owner's provider budget (US$5 when not set). */
  ceilingUsd: number;
};
export function loopLimits(env: NodeJS.ProcessEnv = process.env): LoopLimits {
  const owner = budgetConfig(env).ownerProviderBudget.amountUsd;
  const ceilingUsd = Math.round(Math.min(5, owner ?? 5) * 0.8 * 100) / 100;
  const int = (v: string | undefined, d: number, lo: number, hi: number) => { const x = Number(v); return v != null && v.trim() !== "" && Number.isFinite(x) && x >= lo ? Math.min(hi, Math.floor(x)) : d; };
  const usd = (v: string | undefined, d: number) => { const x = Number(v); const want = v != null && v.trim() !== "" && Number.isFinite(x) && x >= 0 ? x : d; return Math.min(want, ceilingUsd); };
  return {
    maxCallsPerTurn: int(env.DEARPOLICY_RAG_LOOP_MAX_STEPS, 12, 2, 40),
    maxTokensPerTurn: int(env.DEARPOLICY_RAG_LOOP_MAX_TOKENS, 80_000, 4_000, 200_000),
    maxOutputTokens: int(env.DEARPOLICY_RAG_LOOP_MAX_OUTPUT_TOKENS, 2_000, 256, 16_000),
    maxTurnUsd: usd(env.DEARPOLICY_RAG_LOOP_MAX_TURN_USD, 0.05),
    retries: int(env.DEARPOLICY_RAG_LOOP_RETRIES, 1, 0, 2),
    callTimeoutMs: int(env.DEARPOLICY_RAG_LOOP_CALL_TIMEOUT_MS, 45_000, 1, 120_000),
    turnTimeoutMs: int(env.DEARPOLICY_RAG_LOOP_TURN_TIMEOUT_MS, 120_000, 1, 270_000),
    householdMonthlyUsd: usd(env.DEARPOLICY_RAG_LOOP_HOUSEHOLD_MONTHLY_USD, 1),
    runMaxCalls: int(env.DEARPOLICY_RAG_LOOP_RUN_MAX_CALLS, 150, 0, 5_000),
    runMaxUsd: usd(env.DEARPOLICY_RAG_LOOP_RUN_MAX_USD, 0.5),
    fallbackPrice: { input: 5, output: 20 },
    ceilingUsd,
  };
}

/** This process's loop usage (the run budget): every metered call, failed ones included. */
type LoopRun = { calls: number; usd: number };
const LOOP_RUN = Symbol.for("dearpolicy.rag2.loop.run");
function loopRunState(): LoopRun { const g = globalThis as { [LOOP_RUN]?: LoopRun }; return (g[LOOP_RUN] ??= { calls: 0, usd: 0 }); }
export function loopRunUsage(): LoopRun { return { ...loopRunState() }; }
export function addLoopRunUsage(calls: number, usd: number) { const r = loopRunState(); r.calls += calls; r.usd += usd; }
/** Test / evaluation-script use only: start a fresh run budget. */
export function resetLoopRunUsage() { const r = loopRunState(); r.calls = 0; r.usd = 0; }

/** The cost to budget for one call: the priced cost, else the tokens at the (high) fallback price. */
export function budgetCostUsd(priced: number | null, usage: { input: number; output: number }, fallback: LoopLimits["fallbackPrice"]): number {
  return priced != null ? priced : (usage.input * fallback.input + usage.output * fallback.output) / 1_000_000;
}

/** The household's conversation-loop calls and budgeted spend this calendar month (model_executions rows the loop
 * recorded: operation rag_answer, prompt version rag2-loop*); unpriced calls are budgeted at the fallback price. */
export async function loopHouseholdSpendThisMonth(accountId: string, fallback: LoopLimits["fallbackPrice"]): Promise<{ calls: number; usd: number }> {
  await ensureProvenanceSchema();
  const r = await query<{ calls: number; usd: string }>(
    `SELECT count(*)::int AS calls,
            coalesce(sum(coalesce(cost_usd, (input_tokens * $3::numeric + output_tokens * $4::numeric) / 1000000)), 0)::text AS usd
       FROM model_executions
      WHERE household_ref = $1 AND operation = 'rag_answer' AND prompt_version LIKE 'rag2-loop%' AND created_at >= $2`,
    [pseudonymizeId(accountId), startOfMonth().toISOString(), fallback.input, fallback.output]);
  return { calls: Number(r.rows[0]?.calls ?? 0), usd: Number(r.rows[0]?.usd ?? 0) };
}

/** Agent F (D22): the provider name recorded for a loop model that has no priced provider (the test-only scripted model). */
export const SCRIPTED_PROVIDER = "scripted";
