/**
 * Deterministic model stand-in for synthetic browser/CI journeys ONLY.
 *
 * It answers the conversation-interpretation and narration calls from fixed
 * rules (no network, no model), so a browser test can drive the real chat UI
 * end to end with synthetic data. Every other operation (reading a policy,
 * extracting evidence) fails, exactly as an unavailable model would, so the
 * app's own fail-closed paths are what the journey exercises.
 *
 * Impossible to enable in production: it requires ALL of
 *   DEARPOLICY_DETERMINISTIC_MODEL=synthetic-e2e, an E2E_RUN_ID, and
 *   NODE_ENV other than "production" with no VERCEL / VERCEL_ENV;
 * and lib/launch/guards.ts refuses to start a production server where the
 * flag is present at all. It never produces an amount: narration returns the
 * deterministic summary it was given (which the live-chat monetary boundary
 * has already made safe), and interpretation extracts facts, not figures.
 */
import type { z } from "zod";

export const DETERMINISTIC_MODEL_FLAG = "DEARPOLICY_DETERMINISTIC_MODEL";
export const DETERMINISTIC_MODEL_VALUE = "synthetic-e2e";

export function deterministicModelRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[DETERMINISTIC_MODEL_FLAG] ?? "").trim() !== "";
}

export function deterministicModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env[DETERMINISTIC_MODEL_FLAG] ?? "").trim() !== DETERMINISTIC_MODEL_VALUE) return false;
  if (env.NODE_ENV === "production") return false;
  if ((env.VERCEL ?? "").trim() || (env.VERCEL_ENV ?? "").trim()) return false;
  if (!(env.E2E_RUN_ID ?? "").trim()) return false;
  return true;
}

export class DeterministicModelUnavailableError extends Error {
  constructor(operation: string) { super(`deterministic stand-in does not implement ${operation}`); this.name = "DeterministicModelUnavailableError"; }
}

type Fact = { subjectId: string; key: string; value: string | number | boolean | null; state: "known" | "unknown" | "pending"; quote: string };
type Scenario = { subjectId: string; label: string; family: string; traits: string[]; quote: string };

/** Fixed-rule reading of a family member's message: facts and event traits
 * only. Deterministic: the same message always gives the same output. */
export function deterministicInterpretation(user: { currentMessage?: string; subjects?: { id: string }[]; previousIntent?: string | null }) {
  const message = String(user.currentMessage ?? "");
  const subject = user.subjects?.[0]?.id ?? "s1";
  const facts: Fact[] = [];
  const scenarioCandidates: Scenario[] = [];
  const add = (key: string, value: Fact["value"]) => facts.push({ subjectId: subject, key, value, state: "known", quote: message.slice(0, 480) || key });
  const scenario = (label: string, family: string, traits: string[]) => scenarioCandidates.push({ subjectId: subject, label, family, traits, quote: message.slice(0, 480) || label });
  let intent: "claim" | "portfolio" | "policy_question" | "follow_up" =
    /\b(?:what policies|portfolio|family have)\b/i.test(message) ? "portfolio"
    : /\b(?:what if|if i|if my|suppose)\b|matur|surrender|premium|guaranteed|endowment|what does my policy|does my policy|am i covered|covered for/i.test(message) ? "policy_question"
    : user.previousIntent ? "follow_up" : "claim";
  const diagnosed = message.match(/diagnosed with ([^.?!,]{2,80})/i);
  if (diagnosed && !/\bif\b/i.test(message)) {
    intent = "claim"; add("eventType", "diagnosis"); add("diagnosis", diagnosed[1].trim());
    scenario("Reported diagnosis", "illness", ["illness", "diagnosis"]);
  }
  if (/\b(?:admitted|hospitali[sz]ed|warded)\b/i.test(message)) {
    intent = "claim"; add("hospitalised", true);
    scenario("Hospital stay", "hospitalisation", ["hospitalisation"]);
  }
  return { intent, newTopic: false, searchTerms: ["critical illness", "hospital", "sum insured"], facts, scenarioCandidates };
}

export async function deterministicStructuredCompletion<T>(args: { system: string; user: string; schema: z.ZodType<T>; operation?: string }): Promise<T> {
  const operation = args.operation ?? "chat_reply";
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(args.user) as Record<string, unknown>; } catch { payload = {}; }
  let value: unknown;
  if (operation === "chat_fact_finding" || args.system.startsWith("Interpret this")) {
    value = deterministicInterpretation(payload as Parameters<typeof deterministicInterpretation>[0]);
  } else if (operation === "chat_reply") {
    // Narration: hand back the deterministic summary unchanged -- never a figure of its own.
    value = { summary: String(payload.summary ?? "").slice(0, 900), details: [] };
  } else if (operation === "coverage_extraction") {
    value = { benefits: [], observations: [], nextSteps: [] };
  } else {
    throw new DeterministicModelUnavailableError(operation);
  }
  return args.schema.parse(value);
}
