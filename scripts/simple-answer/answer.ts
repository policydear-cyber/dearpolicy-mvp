/** The simple baseline answerer: the household's whole stored library in one long-context Claude request, a short
 * system prompt, the conversation so far, and the answer. No retrieval, benefit records, calculators or checks.
 * Experiment only (scripts/simple-answer/compare.ts); nothing in the live app imports this. */
import type Anthropic from "@anthropic-ai/sdk";
import type { Household } from "./household";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const MAX_OUTPUT_TOKENS = 8000;

export const SYSTEM_PROMPT = `You answer a household's questions about their own insurance documents. The full text of every document they uploaded is below, with each document's details and the family members it is linked to.

Answer only from these pages. For every fact you give, quote the words that support it and cite the document name and page, and say whose policy it is. Keep each amount with its conditions, limits and currency exactly as printed. If the documents do not say something, say that plainly rather than guessing; missing wording is not an exclusion. A dated certificate shows what was true on its date, not necessarily today. Do not promise that a claim will be paid; the insurer decides. If you need one fact from the household to answer properly, answer what you can first and then ask for it. Be brief and plain: lead with the answer.`;

export { renderDocument, renderLibrary } from "../../lib/simple-chat/library";
import { renderLibrary } from "../../lib/simple-chat/library";

/** Rough token count for planning (no API call). Conservative: 3 characters per token. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3);

export type Turn = { role: "user" | "assistant"; text: string };

export function buildRequest(household: Household, history: Turn[], question: string, model = DEFAULT_MODEL) {
  const messages: Anthropic.MessageParam[] = [...history.map((t) => ({ role: t.role, content: t.text })), { role: "user" as const, content: question }];
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // The library is the same for every question of a household, so it is cached after the first request. One hour,
    // because the current pipeline's answers (up to minutes each) are collected between the baseline's questions.
    system: [
      { type: "text" as const, text: SYSTEM_PROMPT },
      { type: "text" as const, text: renderLibrary(household), cache_control: { type: "ephemeral" as const, ttl: "1h" as const } },
    ],
    messages,
    output_config: { effort: "medium" as const },
    // Server-side refusal fallback (routes a declined request to a fallback model within the same call).
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
}
export type SimpleRequest = ReturnType<typeof buildRequest>;

/** The key for paid runs. The cloud environment reserves ANTHROPIC_API_KEY (sessions never receive it), so the
 * experiment's own DEARPOLICY_ANTHROPIC_KEY comes first. Only the variable's name is ever reported, never its value. */
export const KEY_VARIABLES = ["DEARPOLICY_ANTHROPIC_KEY", "ANTHROPIC_API_KEY"] as const;
export function apiKeyFromEnv(env: Record<string, string | undefined> = process.env): { name: (typeof KEY_VARIABLES)[number]; key: string } {
  for (const name of KEY_VARIABLES) {
    const key = env[name]?.trim();
    if (key) return { name, key };
  }
  throw new Error(`No API key: set ${KEY_VARIABLES.join(" or ")}`);
}
/** Always the public API: the harness sets ANTHROPIC_BASE_URL for its own use, and the SDK would otherwise follow it. */
export const API_BASE_URL = "https://api.anthropic.com";

/** Just the slice of the SDK the baseline uses, so the offline test can pass a stub. */
export type ModelClient = { beta: { messages: { stream(params: SimpleRequest): { finalMessage(): Promise<Anthropic.Beta.BetaMessage> } } } };

/** US$ per million tokens (claude-api skill table, cached 2026-10-06). Cache writes are 2x input (1-hour TTL). */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
};
export type Usage = { input: number; cacheWrite: number; cacheRead: number; output: number };
export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price on file for ${model}`);
  return (u.input * p.input + u.cacheWrite * p.input * 2 + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6;
}

export type SimpleAnswer = { text: string; stopReason: string | null; model: string; usage: Usage; costUsd: number; ms: number };

export async function answerSimply(client: ModelClient, household: Household, history: Turn[], question: string, model = DEFAULT_MODEL): Promise<SimpleAnswer> {
  const started = Date.now();
  const message = await client.beta.messages.stream(buildRequest(household, history, question, model)).finalMessage();
  const usage: Usage = {
    input: message.usage.input_tokens ?? 0,
    cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    cacheRead: message.usage.cache_read_input_tokens ?? 0,
    output: message.usage.output_tokens ?? 0,
  };
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return {
    text: message.stop_reason === "refusal" ? `[declined: ${text}]` : text,
    stopReason: message.stop_reason, model: message.model, usage,
    costUsd: costUsd(PRICES[message.model] ? message.model : model, usage), ms: Date.now() - started,
  };
}
