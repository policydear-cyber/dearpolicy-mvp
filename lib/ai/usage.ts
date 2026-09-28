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
const householdScope = new AsyncLocalStorage<{ householdId: string }>();
/** Runs `fn` with every model call inside it attributed to `householdId`. */
export function runWithModelHousehold<T>(householdId: string, fn: () => Promise<T>): Promise<T> {
  return householdScope.run({ householdId }, fn);
}
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
export type UsageReport = { since: string; scope: "household" | "all_households"; calls: number; failedCalls: number;
  inputTokens: number; outputTokens: number; costUsd: number; unpricedCalls: number; rows: UsageRow[] };

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
    outputTokens: sum((x) => x.outputTokens), costUsd: Math.round(sum((x) => x.costUsd) * 1e6) / 1e6, unpricedCalls: sum((x) => x.unpricedCalls) };
}
export function startOfMonth(now = new Date()) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); }
