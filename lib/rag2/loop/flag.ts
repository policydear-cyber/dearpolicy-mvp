/**
 * Conversational RAG (Prompt 2): the model-driven conversation loop (lib/rag2/loop) answers chat turns only when
 * DEARPOLICY_RAG_LOOP is set. Default off: with the flag off lib/chat/workflow.ts never loads the loop and the
 * existing chat runs exactly as before.
 *
 * A production build (NODE_ENV=production, or any Vercel deployment) refuses the flag unless it is also explicitly
 * allowed there with DEARPOLICY_RAG_LOOP_ALLOW_PRODUCTION=1 -- the same two-setting rule as DEARPOLICY_RAG_TOOLS.
 * The loop runs the lib/rag2 tools itself, so turning the loop on implies the tools for the loop's own calls.
 */
import { isProduction, truthy } from "@/lib/launch/guards";

export type RagLoopStatus = { enabled: boolean; reason: string; production: boolean };

const productionBuild = (env: NodeJS.ProcessEnv) => isProduction(env) || (env.VERCEL ?? "").trim() !== "" || (env.VERCEL_ENV ?? "").trim() !== "";

/** Whether chat turns go through the model-driven loop, and why (for logs and the launch check). */
export function ragLoopStatus(env: NodeJS.ProcessEnv = process.env): RagLoopStatus {
  const production = productionBuild(env);
  if (!truthy(env.DEARPOLICY_RAG_LOOP)) return { enabled: false, production, reason: "DEARPOLICY_RAG_LOOP is not set (default off)" };
  if (production && !truthy(env.DEARPOLICY_RAG_LOOP_ALLOW_PRODUCTION))
    return { enabled: false, production, reason: "DEARPOLICY_RAG_LOOP is refused in a production build unless DEARPOLICY_RAG_LOOP_ALLOW_PRODUCTION=1" };
  return { enabled: true, production, reason: production ? "enabled in production by DEARPOLICY_RAG_LOOP_ALLOW_PRODUCTION" : "enabled by DEARPOLICY_RAG_LOOP" };
}

/** True only when the conversation loop is switched on (default off). */
export function ragLoopEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ragLoopStatus(env).enabled;
}

/** The environment the loop runs its lib/rag2 tool calls under: the tools flag follows the loop flag (and its
 * production allowance), so one deliberate setting turns the whole path on. */
export function loopToolEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const s = ragLoopStatus(env);
  if (!s.enabled) return env;
  return { ...env, DEARPOLICY_RAG_TOOLS: "1", ...(s.production ? { DEARPOLICY_RAG_TOOLS_ALLOW_PRODUCTION: "1" } : {}) };
}

/** Bounded budget per chat turn: model steps and tokens (input + output, summed over the turn's model calls). */
export function loopBudget(env: NodeJS.ProcessEnv = process.env): { maxSteps: number; maxTokens: number; maxOutputTokens: number } {
  const n = (v: string | undefined, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) && x >= lo ? Math.min(hi, Math.floor(x)) : d; };
  return { maxSteps: n(env.DEARPOLICY_RAG_LOOP_MAX_STEPS, 12, 2, 40), maxTokens: n(env.DEARPOLICY_RAG_LOOP_MAX_TOKENS, 120_000, 4_000, 1_000_000), maxOutputTokens: n(env.DEARPOLICY_RAG_LOOP_MAX_OUTPUT_TOKENS, 2_000, 256, 16_000) };
}
