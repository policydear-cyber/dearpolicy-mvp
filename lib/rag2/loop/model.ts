/**
 * Conversational RAG (Prompt 2): which model drives the loop. The real chat model (hosted-model.ts) unless a test has
 * installed a scripted model (scripted-model.ts) -- which is refused in a production build.
 */
import { HostedLoopModel } from "./hosted-model";
import { scriptedModelAllowed } from "./scripted-model";
import type { LoopModel } from "./types";

const KEY = Symbol.for("dearpolicy.rag2.loop.model");
type Holder = { [KEY]?: LoopModel | null };

/** Test-only: drive the loop with this model (a ScriptedLoopModel). Pass null to remove it. */
export function installLoopModel(model: LoopModel | null, env: NodeJS.ProcessEnv = process.env): void {
  if (model && model.kind === "scripted" && !scriptedModelAllowed(env)) throw new Error("the scripted loop model is test-only and is refused in a production build");
  (globalThis as Holder)[KEY] = model;
}

/** The model for this turn. */
export function loopModel(env: NodeJS.ProcessEnv = process.env): LoopModel {
  const installed = (globalThis as Holder)[KEY];
  if (installed) {
    if (installed.kind === "scripted" && !scriptedModelAllowed(env)) throw new Error("the scripted loop model is test-only and is refused in a production build");
    return installed;
  }
  return new HostedLoopModel();
}
