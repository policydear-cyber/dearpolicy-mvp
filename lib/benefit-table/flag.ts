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

/** scope: "all" when the table is on for this account only because DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS opened it to every
 * household (the account is not in the alpha list); such a household keeps its existing Coverage if it already has one
 * (lib/benefit-table/app.ts benefitTableLive). */
export type BenefitTableStatus = { enabled: boolean; reason: string; production: boolean; scope?: "alpha" | "all" };
const productionBuild = (env: NodeJS.ProcessEnv) => isProduction(env) || (env.VERCEL ?? "").trim() !== "" || (env.VERCEL_ENV ?? "").trim() !== "";

/** accountId: whose request this is. Even switched on, the table is only for the accounts in DEARPOLICY_ALPHA_ACCOUNTS
 * (lib/launch/alpha.ts); in production a call that names no account is off.
 *
 * DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS=1 opens the table to every signed-in household instead of the alpha list. It
 * changes nothing else: DEARPOLICY_BENEFIT_TABLE (and, in production, DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION) must
 * still be set, a call that names no account is still off, and the simple chat stays limited to the alpha list. */
export function benefitTableStatus(env: NodeJS.ProcessEnv = process.env, accountId?: string | null): BenefitTableStatus {
  const production = productionBuild(env);
  if (!truthy(env.DEARPOLICY_BENEFIT_TABLE)) return { enabled: false, production, reason: "DEARPOLICY_BENEFIT_TABLE is not set (default off)" };
  if (production && !truthy(env.DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION))
    return { enabled: false, production, reason: "DEARPOLICY_BENEFIT_TABLE is refused in a production build unless DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION=1" };
  if (truthy(env.DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS) && !alphaAccountAllowed(accountId, env)) {
    if (!accountId || !accountId.trim()) return { enabled: false, production, reason: "no account named (the table is per household)" };
    return { enabled: true, production, scope: "all", reason: "enabled for every account by DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS" };
  }
  if (!alphaAccountAllowed(accountId, env)) return { enabled: false, production, reason: "this account is not in DEARPOLICY_ALPHA_ACCOUNTS" };
  return { enabled: true, production, scope: "alpha", reason: production ? "enabled in production by DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION" : "enabled by DEARPOLICY_BENEFIT_TABLE" };
}
export const benefitTableEnabled = (env: NodeJS.ProcessEnv = process.env, accountId?: string | null) => benefitTableStatus(env, accountId).enabled;

export const DEFAULT_TABLE_MODEL: ModelChoice = { provider: "anthropic", model: "claude-sonnet-5-5" };
/** The stronger reader a page is tried with after its first try gave no reading, before it is ever read past (DC, 10 Nov:
 * "do not limit cost for reading documents", accuracy first). DEARPOLICY_BENEFIT_TABLE_STRONG_MODEL picks it as
 * "anthropic:<model>". */
export const DEFAULT_TABLE_STRONG_MODEL: ModelChoice = { provider: "anthropic", model: "claude-opus-5-5" };
export function benefitTableStrongModel(env: NodeJS.ProcessEnv = process.env): ModelChoice {
  const raw = (env.DEARPOLICY_BENEFIT_TABLE_STRONG_MODEL ?? "").trim();
  if (!raw) return DEFAULT_TABLE_STRONG_MODEL;
  const m = /^anthropic:([\w.-]+)$/.exec(raw);
  if (!m) throw new Error(`DEARPOLICY_BENEFIT_TABLE_STRONG_MODEL must be "anthropic:<model>", not "${raw}"`);
  return { provider: "anthropic", model: m[1] };
}
export function benefitTableModel(env: NodeJS.ProcessEnv = process.env): ModelChoice {
  const raw = (env.DEARPOLICY_BENEFIT_TABLE_MODEL ?? "").trim();
  if (!raw) return DEFAULT_TABLE_MODEL;
  const m = /^anthropic:([\w.-]+)$/.exec(raw);
  if (!m) throw new Error(`DEARPOLICY_BENEFIT_TABLE_MODEL must be "anthropic:<model>", not "${raw}"`);
  return { provider: "anthropic", model: m[1] };
}
