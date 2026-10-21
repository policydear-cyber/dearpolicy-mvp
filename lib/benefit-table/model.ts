/** The benefit table's model calls: one structured-output request through the Anthropic SDK, with the key and API base
 * the simple chat uses (lib/simple-chat/model.ts). Tests and replays pass their own TableModel, so nothing here runs
 * offline. */
import type { ModelChoice } from "@/lib/ai/providers";
import { API_BASE_URL, apiKeyFromEnv } from "@/lib/simple-chat/model";

export type TableCall = { system: string; user: string; schema: unknown; maxTokens: number };
export type TableReply = { json: unknown; stopReason: string | null; model: string; input: number; output: number; ms: number };
export type TableModel = { choice: ModelChoice; call(c: TableCall): Promise<TableReply> };

type Client = { messages: { stream(p: unknown): { finalMessage(): Promise<{ content: { type: string; text?: string }[]; stop_reason: string | null; model: string; usage: { input_tokens?: number | null; output_tokens?: number | null } }> } } };

export function anthropicTableModel(choice: ModelChoice, client?: Client): TableModel {
  return {
    choice,
    async call(c) {
      let api = client;
      if (!api) {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        api = new Anthropic({ apiKey: apiKeyFromEnv().key, baseURL: API_BASE_URL }) as unknown as Client;
      }
      const started = Date.now();
      const message = await api.messages.stream({ model: choice.model, max_tokens: c.maxTokens, system: c.system, messages: [{ role: "user", content: c.user }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: c.schema } } }).finalMessage();
      const text = message.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
      let json: unknown = null;
      try { json = message.stop_reason === "end_turn" ? JSON.parse(text) : null; } catch { json = null; }
      return { json, stopReason: message.stop_reason, model: message.model, input: message.usage.input_tokens ?? 0, output: message.usage.output_tokens ?? 0, ms: Date.now() - started };
    },
  };
}
