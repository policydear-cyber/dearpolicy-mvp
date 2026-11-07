/** The figure guards' switch (guards.ts). Default OFF: with DEARPOLICY_FIGURE_GUARDS unset no guard is called, nothing is
 * stored, and every page shows exactly what it shows without them.
 *
 * - A production build refuses the switch unless DEARPOLICY_FIGURE_GUARDS_ALLOW_PRODUCTION=1 is also set.
 * - It is on only for the accounts in DEARPOLICY_ALPHA_ACCOUNTS, unless DEARPOLICY_FIGURE_GUARDS_ALL_ACCOUNTS=1; a call that
 *   names no account is off.
 * - DEARPOLICY_FIGURE_GUARD_MODELS: the four guards, comma-separated "anthropic:<model>:<wording>" (wording "direct" or
 *   "copyFirst"). Default: Opus 5.5 direct, Sonnet 5.5 copy-first, Sonnet 5 direct, Haiku 4.5 copy-first: different
 *   models and wordings, so the five readers do not share one blind spot.
 * - DEARPOLICY_FIGURE_GUARD_CAP_USD: the most one document's check may spend, worst case (default 3). */
import { isProduction, truthy } from "@/lib/launch/guards";
import { alphaAccountAllowed } from "@/lib/launch/alpha";
import type { ModelChoice } from "@/lib/ai/providers";
import type { GuardPrompt } from "./guards";

const productionBuild = (env: NodeJS.ProcessEnv) => isProduction(env) || (env.VERCEL ?? "").trim() !== "" || (env.VERCEL_ENV ?? "").trim() !== "";

export function figureGuardsEnabled(env: NodeJS.ProcessEnv = process.env, accountId?: string | null): boolean {
  if (!truthy(env.DEARPOLICY_FIGURE_GUARDS)) return false;
  if (productionBuild(env) && !truthy(env.DEARPOLICY_FIGURE_GUARDS_ALLOW_PRODUCTION)) return false;
  if (!accountId || !accountId.trim()) return false;
  return truthy(env.DEARPOLICY_FIGURE_GUARDS_ALL_ACCOUNTS) || alphaAccountAllowed(accountId, env);
}

export const DEFAULT_GUARDS: { choice: ModelChoice; prompt: GuardPrompt }[] = [
  { choice: { provider: "anthropic", model: "claude-opus-5-5" }, prompt: "direct" },
  { choice: { provider: "anthropic", model: "claude-sonnet-5-5" }, prompt: "copyFirst" },
  { choice: { provider: "anthropic", model: "claude-sonnet-5" }, prompt: "direct" },
  { choice: { provider: "anthropic", model: "claude-haiku-4-5" }, prompt: "copyFirst" },
];
export function guardRoster(env: NodeJS.ProcessEnv = process.env): { choice: ModelChoice; prompt: GuardPrompt }[] {
  const raw = (env.DEARPOLICY_FIGURE_GUARD_MODELS ?? "").trim();
  if (!raw) return DEFAULT_GUARDS;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^anthropic:([\w.-]+):(direct|copyFirst)$/.exec(s);
    if (!m) throw new Error(`DEARPOLICY_FIGURE_GUARD_MODELS entries must be "anthropic:<model>:direct|copyFirst", not "${s}"`);
    return { choice: { provider: "anthropic" as const, model: m[1] }, prompt: m[2] as GuardPrompt };
  });
  if (list.length !== 4) throw new Error(`DEARPOLICY_FIGURE_GUARD_MODELS must name 4 guards, not ${list.length}`);
  return list;
}
/** Whether a guard model takes the effort setting: Haiku 4.5 refuses a request that carries one (400, checked 6 Nov 2026). */
export const supportsEffort = (model: string) => !/^claude-haiku-4/.test(model);
export function guardCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number((env.DEARPOLICY_FIGURE_GUARD_CAP_USD ?? "").trim() || 3);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
