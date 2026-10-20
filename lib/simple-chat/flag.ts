/**
 * The simple chat (lib/simple-chat): the household's whole library of stored page text in one long-context model
 * request, a short prompt, and server checks on what comes back. It answers chat turns only when
 * DEARPOLICY_SIMPLE_CHAT is set. Default off: with the switch off lib/chat/workflow.ts never loads this module and the
 * existing chat runs exactly as before.
 *
 * As with DEARPOLICY_RAG_LOOP, a production build refuses the switch unless DEARPOLICY_SIMPLE_CHAT_ALLOW_PRODUCTION=1
 * is also set there, so one stray setting cannot change what households see.
 *
 * DEARPOLICY_SIMPLE_CHAT_MODEL picks the model as "provider:model" (anthropic or openai); default anthropic:claude-opus-5-5,
 * the model the 20 Oct 2026 comparison measured.
 */
import { isProduction, truthy } from "@/lib/launch/guards";
import type { ModelChoice } from "@/lib/ai/providers";

export type SimpleChatStatus = { enabled: boolean; reason: string; production: boolean };

const productionBuild = (env: NodeJS.ProcessEnv) => isProduction(env) || (env.VERCEL ?? "").trim() !== "" || (env.VERCEL_ENV ?? "").trim() !== "";

export function simpleChatStatus(env: NodeJS.ProcessEnv = process.env): SimpleChatStatus {
  const production = productionBuild(env);
  if (!truthy(env.DEARPOLICY_SIMPLE_CHAT)) return { enabled: false, production, reason: "DEARPOLICY_SIMPLE_CHAT is not set (default off)" };
  if (production && !truthy(env.DEARPOLICY_SIMPLE_CHAT_ALLOW_PRODUCTION))
    return { enabled: false, production, reason: "DEARPOLICY_SIMPLE_CHAT is refused in a production build unless DEARPOLICY_SIMPLE_CHAT_ALLOW_PRODUCTION=1" };
  return { enabled: true, production, reason: production ? "enabled in production by DEARPOLICY_SIMPLE_CHAT_ALLOW_PRODUCTION" : "enabled by DEARPOLICY_SIMPLE_CHAT" };
}

/** True only when the simple chat is switched on (default off). */
export function simpleChatEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return simpleChatStatus(env).enabled;
}

export const DEFAULT_SIMPLE_MODEL: ModelChoice = { provider: "anthropic", model: "claude-opus-5-5" };

/** The model the simple chat calls. Only providers with a long-context path here are accepted. */
export function simpleChatModel(env: NodeJS.ProcessEnv = process.env): ModelChoice {
  const raw = (env.DEARPOLICY_SIMPLE_CHAT_MODEL ?? "").trim();
  if (!raw) return DEFAULT_SIMPLE_MODEL;
  const m = /^(anthropic|openai):([\w.-]+)$/.exec(raw);
  if (!m) throw new Error(`DEARPOLICY_SIMPLE_CHAT_MODEL must be "anthropic:<model>" or "openai:<model>", not "${raw}"`);
  return { provider: m[1] as ModelChoice["provider"], model: m[2] };
}
