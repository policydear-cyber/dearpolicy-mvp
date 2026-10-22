/**
 * The benefit table (lib/benefit-table): each document read once into rows, each person's table assembled from them,
 * and the Coverage page showing that table. Only when DEARPOLICY_BENEFIT_TABLE is set. Default off: with the switch off
 * no document is read into it, its routes answer "not switched on", and Coverage shows the existing view.
 *
 * As with DEARPOLICY_SIMPLE_CHAT, a production build refuses the switch unless DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION=1
 * is also set there. DEARPOLICY_BENEFIT_TABLE_MODEL picks the reading model as "anthropic:<model>"; default
 * anthropic:claude-sonnet-5-5, the model the 21 Oct 2026 test readings used.
 */
import { isProduction, truthy } from "@/lib/launch/guards";
import { alphaAccountAllowed } from "@/lib/launch/alpha";
import type { ModelChoice } from "@/lib/ai/providers";

export type BenefitTableStatus = { enabled: boolean; reason: string; production: boolean };
const productionBuild = (env: NodeJS.ProcessEnv) => isProduction(env) || (env.VERCEL ?? "").trim() !== "" || (env.VERCEL_ENV ?? "").trim() !== "";

/** accountId: whose request this is. Even switched on, the table is only for the accounts in DEARPOLICY_ALPHA_ACCOUNTS
 * (lib/launch/alpha.ts); in production a call that names no account is off. */
export function benefitTableStatus(env: NodeJS.ProcessEnv = process.env, accountId?: string | null): BenefitTableStatus {
  const production = productionBuild(env);
  if (!truthy(env.DEARPOLICY_BENEFIT_TABLE)) return { enabled: false, production, reason: "DEARPOLICY_BENEFIT_TABLE is not set (default off)" };
  if (production && !truthy(env.DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION))
    return { enabled: false, production, reason: "DEARPOLICY_BENEFIT_TABLE is refused in a production build unless DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION=1" };
  if (!alphaAccountAllowed(accountId, env)) return { enabled: false, production, reason: "this account is not in DEARPOLICY_ALPHA_ACCOUNTS" };
  return { enabled: true, production, reason: production ? "enabled in production by DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION" : "enabled by DEARPOLICY_BENEFIT_TABLE" };
}
export const benefitTableEnabled = (env: NodeJS.ProcessEnv = process.env, accountId?: string | null) => benefitTableStatus(env, accountId).enabled;

export const DEFAULT_TABLE_MODEL: ModelChoice = { provider: "anthropic", model: "claude-sonnet-5-5" };
export function benefitTableModel(env: NodeJS.ProcessEnv = process.env): ModelChoice {
  const raw = (env.DEARPOLICY_BENEFIT_TABLE_MODEL ?? "").trim();
  if (!raw) return DEFAULT_TABLE_MODEL;
  const m = /^anthropic:([\w.-]+)$/.exec(raw);
  if (!m) throw new Error(`DEARPOLICY_BENEFIT_TABLE_MODEL must be "anthropic:<model>", not "${raw}"`);
  return { provider: "anthropic", model: m[1] };
}
