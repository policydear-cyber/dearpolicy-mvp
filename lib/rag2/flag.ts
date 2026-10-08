/**
 * Conversational RAG (Prompt 1): the common retrieval tools in lib/rag2 are built alongside the existing chat and
 * stay dark unless DEARPOLICY_RAG_TOOLS is set. With the flag off nothing in the existing chat path changes -- no
 * existing module imports lib/rag2.
 *
 * A production build (NODE_ENV=production, or any Vercel deployment) refuses the flag unless it is also explicitly
 * allowed there with DEARPOLICY_RAG_TOOLS_ALLOW_PRODUCTION=1 -- turning an unfinished answer path on in front of
 * households takes two deliberate settings, never one stray variable.
 */
import { isProduction, truthy } from "@/lib/launch/guards";

export type RagToolsStatus = { enabled: boolean; reason: string };

/** Whether the lib/rag2 tools may run, and why (for logs and the launch check). */
export function ragToolsStatus(env: NodeJS.ProcessEnv = process.env): RagToolsStatus {
  if (!truthy(env.DEARPOLICY_RAG_TOOLS)) return { enabled: false, reason: "DEARPOLICY_RAG_TOOLS is not set (default off)" };
  const productionBuild = isProduction(env) || (env.VERCEL ?? "").trim() !== "" || (env.VERCEL_ENV ?? "").trim() !== "";
  if (productionBuild && !truthy(env.DEARPOLICY_RAG_TOOLS_ALLOW_PRODUCTION))
    return { enabled: false, reason: "DEARPOLICY_RAG_TOOLS is refused in a production build unless DEARPOLICY_RAG_TOOLS_ALLOW_PRODUCTION=1" };
  return { enabled: true, reason: productionBuild ? "enabled in production by DEARPOLICY_RAG_TOOLS_ALLOW_PRODUCTION" : "enabled by DEARPOLICY_RAG_TOOLS" };
}

/** True only when the conversational retrieval tools are switched on (default off). */
export function ragToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ragToolsStatus(env).enabled;
}
