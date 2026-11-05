/** The benefit table's model calls: one structured-output request through the Anthropic SDK, with the key and API base
 * the simple chat uses (lib/simple-chat/model.ts). Tests and replays pass their own TableModel, so nothing here runs
 * offline. */
import type { ModelChoice } from "@/lib/ai/providers";
import { API_BASE_URL, apiKeyFromEnv } from "@/lib/simple-chat/model";

/** timeoutMs: the call is stopped after this long and replies with stopReason "timeout" and no reading, so a caller with a
 * time limit (a serverless function) can still say the reading did not finish, instead of being stopped mid-call. */
export type TableCall = { system: string; user: string; schema: unknown; maxTokens: number; timeoutMs?: number };
/** input: uncached prompt tokens; cacheRead/cacheWrite: the prompt tokens served from or written to the prompt cache. */
export type TableReply = { json: unknown; stopReason: string | null; model: string; input: number; output: number; ms: number; cacheRead?: number; cacheWrite?: number };
export type TableModel = { choice: ModelChoice; call(c: TableCall): Promise<TableReply> };

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
type Client = { messages: { stream(p: unknown): { finalMessage(): Promise<{ content: { type: string; text?: string }[]; stop_reason: string | null; model: string; usage: Usage }>;
  abort?(): void; currentMessage?: { model?: string; usage?: Usage } | null } } };

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
      // The prompt is the same for every page of every household's documents, so it is cached for the calls that follow
      // within 5 minutes (a document's page re-reads, the next upload). The document itself comes after it, uncached.
      const system = [{ type: "text" as const, text: c.system, cache_control: { type: "ephemeral" as const, ttl: "5m" as const } }];
      const stream = api.messages.stream({ model: choice.model, max_tokens: c.maxTokens, system, messages: [{ role: "user", content: c.user }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: c.schema } } });
      let timedOut = false;
      const timer = c.timeoutMs != null && stream.abort ? setTimeout(() => { timedOut = true; stream.abort!(); }, Math.max(0, c.timeoutMs)) : null;
      let message;
      try { message = await stream.finalMessage(); }
      catch (error) {
        if (!timedOut) throw error;
        // Stopped at the caller's time limit: the tokens used so far are still booked.
        const u = stream.currentMessage?.usage ?? {};
        return { json: null, stopReason: "timeout", model: stream.currentMessage?.model ?? choice.model, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, ms: Date.now() - started,
          cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
      } finally { if (timer) clearTimeout(timer); }
      const text = message.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
      let json: unknown = null;
      try { json = message.stop_reason === "end_turn" ? JSON.parse(text) : null; } catch { json = null; }
      return { json, stopReason: message.stop_reason, model: message.model, input: message.usage.input_tokens ?? 0, output: message.usage.output_tokens ?? 0, ms: Date.now() - started,
        cacheRead: message.usage.cache_read_input_tokens ?? 0, cacheWrite: message.usage.cache_creation_input_tokens ?? 0 };
    },
  };
}
