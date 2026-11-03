/** The simple chat's one model call: the prompt and the household's library as a cached system prefix, the
 * conversation so far, and the question. Anthropic (default) goes through the Anthropic SDK with structured output and
 * prompt caching; OpenAI goes through the app's existing hosted call (lib/ai/providers.ts). Tests pass their own
 * SimpleModel, so nothing here is called offline. */
import type { ModelChoice } from "@/lib/ai/providers";
import { SIMPLE_ANSWER_SCHEMA, SIMPLE_SYSTEM_PROMPT, TABLE_ANSWER_SCHEMA } from "./prompt";

export type Turn = { role: "user" | "assistant"; text: string };
/** `withRows`: the library carries the benefit table, and each statement names its row (lib/benefit-table/chat.ts). */
export type SimpleModelCall = { library: string; history: Turn[]; question: string; withRows?: boolean };
export type SimpleUsage = { input: number; cacheWrite: number; cacheRead: number; output: number };
export type SimpleModelReply = { json: unknown; stopReason: string | null; model: string; usage: SimpleUsage };
export type SimpleModel = { choice: ModelChoice; call(args: SimpleModelCall): Promise<SimpleModelReply> };

export const MAX_OUTPUT_TOKENS = 8000;
/** How much the model reasons before it answers (see anthropicRequest). */
export const SIMPLE_EFFORT = "low" as const;

/** The cloud environment reserves ANTHROPIC_API_KEY, so DearPolicy's own DEARPOLICY_ANTHROPIC_KEY comes first. Only a
 * variable's name is ever reported, never its value. */
export const KEY_VARIABLES = ["DEARPOLICY_ANTHROPIC_KEY", "ANTHROPIC_API_KEY"] as const;
export function apiKeyFromEnv(env: Record<string, string | undefined> = process.env): { name: (typeof KEY_VARIABLES)[number]; key: string } {
  for (const name of KEY_VARIABLES) {
    const key = env[name]?.trim();
    if (key) return { name, key };
  }
  throw new Error(`No API key: set ${KEY_VARIABLES.join(" or ")}`);
}
/** Always the public API: a harness may set ANTHROPIC_BASE_URL for its own use, and the SDK would otherwise follow it. */
export const API_BASE_URL = "https://api.anthropic.com";

/** Consecutive turns of one role are joined, and the history starts with the household, as the Messages API needs. */
export function alternating(history: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of history) {
    if (!t.text.trim()) continue;
    if (!out.length && t.role === "assistant") continue;
    if (out.at(-1)?.role === t.role) out[out.length - 1] = { role: t.role, text: out.at(-1)!.text + "\n\n" + t.text };
    else out.push({ ...t });
  }
  if (out.at(-1)?.role === "user") out.pop();
  return out;
}

export function anthropicRequest(choice: ModelChoice, args: SimpleModelCall) {
  return {
    model: choice.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // The library is the same for every question of a household, so it is cached after the first request. The 5-minute
    // cache costs 1.25x input to write (the 1-hour one 2x), and still covers a conversation's follow-ups.
    system: [
      { type: "text" as const, text: SIMPLE_SYSTEM_PROMPT },
      { type: "text" as const, text: args.library, cache_control: { type: "ephemeral" as const, ttl: "5m" as const } },
    ],
    messages: [...alternating(args.history).map((t) => ({ role: t.role, content: t.text })), { role: "user" as const, content: args.question }],
    // "low": the answer's time is almost all the model writing (about 4.4s + 7ms per output token over 53 recorded
    // answers), and "medium" made direct answers miss 10s. Paid comparison, 3 Nov 2026, 8 questions on two made-up
    // households: low averaged 6.1s (max 7.8s) against 9.7s (max 15.8s), and no answer was less correct
    // (/mnt/project-files/chat-speed/effort.md). Every amount is still checked by the server (verify.ts).
    output_config: { effort: SIMPLE_EFFORT, format: { type: "json_schema" as const, schema: (args.withRows ? TABLE_ANSWER_SCHEMA : SIMPLE_ANSWER_SCHEMA) as unknown as Record<string, unknown> } },
    // Server-side refusal fallback (routes a declined request to a fallback model within the same call).
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
}

type AnthropicLike = { beta: { messages: { stream(params: ReturnType<typeof anthropicRequest>): { finalMessage(): Promise<{ content: { type: string; text?: string }[]; stop_reason: string | null; model: string; usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } }> } } } };

const parseJson = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return null; }
};

export function anthropicModel(choice: ModelChoice, client?: AnthropicLike): SimpleModel {
  return {
    choice,
    async call(args) {
      let c = client;
      if (!c) {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        c = new Anthropic({ apiKey: apiKeyFromEnv().key, baseURL: API_BASE_URL }) as unknown as AnthropicLike;
      }
      const message = await c.beta.messages.stream(anthropicRequest(choice, args)).finalMessage();
      const text = message.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
      return {
        json: message.stop_reason === "refusal" ? null : parseJson(text),
        stopReason: message.stop_reason, model: message.model,
        usage: {
          input: message.usage.input_tokens ?? 0, output: message.usage.output_tokens ?? 0,
          cacheRead: message.usage.cache_read_input_tokens ?? 0, cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

/** OpenAI through the app's hosted call. It takes one system and one user text, so the conversation is folded into the user text. */
export function openaiModel(choice: ModelChoice): SimpleModel {
  return {
    choice,
    async call(args) {
      const { hostedStructuredCompletion } = await import("@/lib/ai/providers");
      const earlier = alternating(args.history).map((t) => `<${t.role}>\n${t.text}\n</${t.role}>`).join("\n");
      const reply = await hostedStructuredCompletion(choice, {
        system: SIMPLE_SYSTEM_PROMPT + "\n\n" + args.library,
        user: (earlier ? `<conversation_so_far>\n${earlier}\n</conversation_so_far>\n\n` : "") + args.question,
        jsonSchema: args.withRows ? TABLE_ANSWER_SCHEMA : SIMPLE_ANSWER_SCHEMA, maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      return {
        json: reply.truncated ? null : parseJson(reply.content), stopReason: reply.truncated ? "max_tokens" : reply.resolved.finishReason,
        model: reply.resolved.resolvedModel ?? choice.model,
        usage: { input: reply.usage.input - (reply.usage.cached ?? 0), cacheRead: reply.usage.cached ?? 0, cacheWrite: 0, output: reply.usage.output },
      };
    },
  };
}

export function modelFromChoice(choice: ModelChoice): SimpleModel {
  if (choice.provider === "anthropic") return anthropicModel(choice);
  if (choice.provider === "openai") return openaiModel(choice);
  throw new Error(`The simple chat has no path for provider ${choice.provider}`);
}

/** Usage as lib/ai/ledger.ts books it: input counts every prompt token (5-minute cache writes at their 1.25x price), cached
 * the cache reads. */
export function ledgerUsage(u: SimpleUsage): { input: number; output: number; cached: number } {
  return { input: u.input + u.cacheRead + Math.ceil(1.25 * u.cacheWrite), output: u.output, cached: u.cacheRead };
}
/** What one call cost at list price, US$ (5-minute cache writes at 1.25x input, cache reads at the cached price). */
export function callUsd(price: { input: number; output: number; cachedInput?: number }, u: SimpleUsage): number {
  return (u.input * price.input + 1.25 * u.cacheWrite * price.input + u.cacheRead * (price.cachedInput ?? price.input) + u.output * price.output) / 1e6;
}
