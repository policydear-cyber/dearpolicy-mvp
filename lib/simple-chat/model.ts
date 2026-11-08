/** The simple chat's one model call: the prompt and the household's library as a cached system prefix, the
 * conversation so far, and the question. Anthropic (default) goes through the Anthropic SDK with structured output and
 * prompt caching; OpenAI goes through the app's existing hosted call (lib/ai/providers.ts). Tests pass their own
 * SimpleModel, so nothing here is called offline. */
import type { ModelChoice } from "@/lib/ai/providers";
import { SIMPLE_ANSWER_SCHEMA, SIMPLE_SYSTEM_PROMPT, TABLE_ANSWER_SCHEMA } from "./prompt";

export type Turn = { role: "user" | "assistant"; text: string };
/** `withRows`: the library carries the benefit table, and each statement names its row (lib/benefit-table/chat.ts).
 * `cache`: write the library to the prompt cache (LIBRARY_CACHE_TTL). Off for a conversation's first question: almost every
 * chat is one question, so a write there is paid for and never read (live 8 Nov: US$1.01 for one question, the library
 * written to the 1-hour cache at 2x). From the second question on, a follow-up within minutes reads it at the cached price. */
export type SimpleModelCall = { library: string; history: Turn[]; question: string; withRows?: boolean; cache?: boolean };
export type SimpleUsage = { input: number; cacheWrite: number; cacheRead: number; output: number };
export type SimpleModelReply = { json: unknown; stopReason: string | null; model: string; usage: SimpleUsage };
export type SimpleModel = { choice: ModelChoice; call(args: SimpleModelCall): Promise<SimpleModelReply> };

export const MAX_OUTPUT_TOKENS = 8000;

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

/** How long the household's library stays cached, and what writing it costs as a multiple of the input price
 * (Anthropic: 1.25x for 5 minutes, 2x for 1 hour). The ledger and the spend cap book the chat's writes at this rate.
 * 5 minutes: a follow-up comes within minutes or not at all (live 3 to 8 Nov: every simple chat was one question, so the
 * 1-hour write was never read and doubled each question's cost). */
export const LIBRARY_CACHE_TTL = "5m" as const;
export const CACHE_WRITE_RATE = { "5m": 1.25, "1h": 2 } as const;
export const LIBRARY_CACHE_WRITE_RATE = CACHE_WRITE_RATE[LIBRARY_CACHE_TTL];

export function anthropicRequest(choice: ModelChoice, args: SimpleModelCall) {
  return {
    model: choice.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // The library is cached only when asked (args.cache: from a conversation's second question on), for LIBRARY_CACHE_TTL.
    system: [
      { type: "text" as const, text: SIMPLE_SYSTEM_PROMPT },
      args.cache
        ? { type: "text" as const, text: args.library, cache_control: { type: "ephemeral" as const, ttl: LIBRARY_CACHE_TTL } }
        : { type: "text" as const, text: args.library },
    ],
    messages: [...alternating(args.history).map((t) => ({ role: t.role, content: t.text })), { role: "user" as const, content: args.question }],
    output_config: { effort: "medium" as const, format: { type: "json_schema" as const, schema: (args.withRows ? TABLE_ANSWER_SCHEMA : SIMPLE_ANSWER_SCHEMA) as unknown as Record<string, unknown> } },
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

/** Usage as lib/ai/ledger.ts books it: input counts every prompt token (cache writes at their write rate: the chat's
 * library at LIBRARY_CACHE_WRITE_RATE, a 5-minute cache at 1.25x), cached the cache reads. */
export function ledgerUsage(u: SimpleUsage, writeRate: number = CACHE_WRITE_RATE["5m"]): { input: number; output: number; cached: number } {
  return { input: u.input + u.cacheRead + Math.ceil(writeRate * u.cacheWrite), output: u.output, cached: u.cacheRead };
}
/** What one chat call cost at list price, US$ (library cache writes at LIBRARY_CACHE_WRITE_RATE x input, cache reads at
 * the cached price). */
export function callUsd(price: { input: number; output: number; cachedInput?: number }, u: SimpleUsage, writeRate: number = LIBRARY_CACHE_WRITE_RATE): number {
  return (u.input * price.input + writeRate * u.cacheWrite * price.input + u.cacheRead * (price.cachedInput ?? price.input) + u.output * price.output) / 1e6;
}
