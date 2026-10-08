/**
 * Conversational RAG (Prompt 2): the real model for the loop -- the chat role's model (CHAT_MODEL, else the preset /
 * default, lib/ai/providers.ts modelFor("chat")) called with native tool / function calling:
 *  - openai, groq, gemini: OpenAI-style chat completions with `tools` and `tool_calls` (Gemini through its
 *    OpenAI-compatible endpoint);
 *  - anthropic: the Messages API with `tools` and tool_use / tool_result blocks.
 * Each call returns the tool calls, token usage, the resolved model id and latency for the turn's trace.
 * Under the deterministic model stand-in (DEARPOLICY_DETERMINISTIC_MODEL) no network call is made: a test must install
 * the scripted model instead (scripted-model.ts).
 */
import { apiKeyFor, modelFor, type ModelChoice } from "@/lib/ai/providers";
import { deterministicModelRequested } from "@/lib/ai/deterministic-model";
import type { LoopMessage, LoopModel, ModelTurnInput, ModelTurnOutput, ToolCall } from "./types";

type Fetch = typeof fetch;
const GEMINI_ALIASES: Record<string, string> = { flash: "gemini-2.5-flash", "flash-lite": "gemini-2.5-flash-lite", pro: "gemini-2.5-pro" };

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : {}; } catch { return { __unparsed: raw }; }
}

/** OpenAI-style request body for a turn (exported for the adapter test). */
export function openAiRequest(model: string, input: ModelTurnInput) {
  const messages = input.messages.map((m) => {
    if (m.role === "assistant") return { role: "assistant", content: m.content ?? null, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}) };
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    return { role: m.role, content: m.content };
  });
  return { model, temperature: 0, max_completion_tokens: input.maxOutputTokens, tool_choice: "required", parallel_tool_calls: true, messages, tools: input.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) };
}
/** Reads an OpenAI-style reply into tool calls (exported for the adapter test). */
export function openAiReply(payload: any): { toolCalls: ToolCall[]; text: string | null; usage: { input: number; output: number }; model: string | null } {
  const msg = payload?.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c: any, i: number) => ({ id: String(c.id ?? `call_${i}`), name: String(c.function?.name ?? ""), arguments: parseArgs(c.function?.arguments) }));
  return { toolCalls, text: typeof msg.content === "string" ? msg.content : null, usage: { input: payload?.usage?.prompt_tokens ?? 0, output: payload?.usage?.completion_tokens ?? 0 }, model: payload?.model ?? null };
}
/** Anthropic Messages request body (exported for the adapter test). */
export function anthropicRequest(model: string, input: ModelTurnInput) {
  const system = input.messages.filter((m) => m.role === "system").map((m) => (m as { content: string }).content).join("\n\n");
  const out: { role: "user" | "assistant"; content: any[] }[] = [];
  const push = (role: "user" | "assistant", block: any) => { const last = out[out.length - 1]; if (last && last.role === role) last.content.push(block); else out.push({ role, content: [block] }); };
  for (const m of input.messages as LoopMessage[]) {
    if (m.role === "system") continue;
    if (m.role === "user") push("user", { type: "text", text: m.content });
    else if (m.role === "assistant") { if (m.content) push("assistant", { type: "text", text: m.content }); for (const c of m.toolCalls ?? []) push("assistant", { type: "tool_use", id: c.id, name: c.name, input: c.arguments }); }
    else push("user", { type: "tool_result", tool_use_id: m.toolCallId, content: m.content });
  }
  return { model, max_tokens: input.maxOutputTokens, temperature: 0, system, tool_choice: { type: "any" }, messages: out, tools: input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) };
}
export function anthropicReply(payload: any): { toolCalls: ToolCall[]; text: string | null; usage: { input: number; output: number }; model: string | null } {
  const blocks: any[] = payload?.content ?? [];
  return { toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id), name: String(b.name), arguments: parseArgs(b.input) })), text: blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n") || null, usage: { input: payload?.usage?.input_tokens ?? 0, output: payload?.usage?.output_tokens ?? 0 }, model: payload?.model ?? null };
}

export class HostedLoopModel implements LoopModel {
  readonly kind = "hosted" as const;
  readonly id: string;
  constructor(private readonly choice: ModelChoice = modelFor("chat"), private readonly http: Fetch = fetch, private readonly timeoutMs = 90_000) {
    this.id = `${choice.provider}:${choice.provider === "gemini" ? GEMINI_ALIASES[choice.model] ?? choice.model : choice.model}`;
  }
  async next(input: ModelTurnInput): Promise<ModelTurnOutput> {
    if (deterministicModelRequested()) throw new Error("the deterministic model stand-in is on: the conversation loop needs a scripted test model (no network call is made)");
    const { provider } = this.choice;
    const key = apiKeyFor(provider);
    if (!key) throw new Error(`no API key configured for ${provider}`);
    const model = provider === "gemini" ? GEMINI_ALIASES[this.choice.model] ?? this.choice.model : this.choice.model;
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Response, read: ReturnType<typeof openAiReply>;
      if (provider === "anthropic") {
        res = await this.http("https://api.anthropic.com/v1/messages", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(anthropicRequest(model, input)) });
        if (!res.ok) throw new Error(`model service returned ${res.status}`);
        read = anthropicReply(await res.json());
      } else {
        const base = provider === "groq" ? (process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1") : provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/openai" : (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");
        const body: Record<string, unknown> = openAiRequest(model, input);
        if (provider !== "openai") { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; delete body.parallel_tool_calls; }
        res = await this.http(base.replace(/\/$/, "") + "/chat/completions", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`model service returned ${res.status}`);
        read = openAiReply(await res.json());
      }
      return { toolCalls: read.toolCalls, text: read.text, usage: read.usage, modelId: read.model ? `${provider}:${read.model}` : this.id, latencyMs: Date.now() - t0 };
    } finally { clearTimeout(timer); }
  }
}
