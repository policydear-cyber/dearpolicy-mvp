/** The benefit table's model calls: one structured-output request through the Anthropic SDK, with the key and API base
 * the simple chat uses (lib/simple-chat/model.ts). Tests and replays pass their own TableModel, so nothing here runs
 * offline. */
import type { ModelChoice } from "@/lib/ai/providers";
import { API_BASE_URL, apiKeyFromEnv } from "@/lib/simple-chat/model";

/** timeoutMs: the call is stopped after this long and replies with stopReason "timeout" and no reading, so a caller with a
 * time limit (a serverless function) can still say the reading did not finish, instead of being stopped mid-call. */
/** A file the model is shown with the prompt: one page of the stored document as a PDF, or a picture upload. data is
 * base64. */
export type Attachment = { kind: "pdf" | "image"; mediaType: string; data: string };
export type TableCall = { system: string; user: string; schema: unknown; maxTokens: number; timeoutMs?: number; attachments?: Attachment[] };
/** The user turn: the plain prompt, or the attached files first and the prompt after them. */
export function userContent(c: TableCall): string | unknown[] {
  if (!c.attachments?.length) return c.user;
  return [...c.attachments.map((a) => a.kind === "pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } }
    : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } }), { type: "text", text: c.user }];
}
/** input: uncached prompt tokens; cacheRead/cacheWrite: the prompt tokens served from or written to the prompt cache. */
export type TableReply = { json: unknown; stopReason: string | null; model: string; input: number; output: number; ms: number; cacheRead?: number; cacheWrite?: number };
export type TableModel = { choice: ModelChoice; call(c: TableCall): Promise<TableReply> };

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
type Client = { messages: { stream(p: unknown): { finalMessage(): Promise<{ content: { type: string; text?: string }[]; stop_reason: string | null; model: string; usage: Usage }>;
  abort?(): void; on?(event: "text", listener: (delta: string) => void): unknown; currentMessage?: { model?: string; usage?: Usage } | null } } };
/** Output tokens a stream stopped mid-reply is booked for: the usage the API reported so far, or the text it streamed at
 * about 3 characters a token when that is more (the API fills output_tokens only in its last event, so a call stopped
 * after minutes of streaming would otherwise be booked as about 0). */
export function stoppedOutputTokens(reported: number | null | undefined, streamedChars: number): number {
  return Math.max(reported ?? 0, Math.ceil(streamedChars / 3));
}

/** opts.effort false: the request carries no effort setting, for a model that refuses one (a figure guard on an older model). */
export function anthropicTableModel(choice: ModelChoice, client?: Client, opts: { effort?: boolean } = {}): TableModel {
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
      const stream = api.messages.stream({ model: choice.model, max_tokens: c.maxTokens, system, messages: [{ role: "user", content: userContent(c) }],
        output_config: { ...(opts.effort === false ? {} : { effort: "medium" as const }), format: { type: "json_schema", schema: c.schema } } });
      let timedOut = false, streamedChars = 0;
      stream.on?.("text", (delta) => { streamedChars += delta.length; });
      const timer = c.timeoutMs != null && stream.abort ? setTimeout(() => { timedOut = true; stream.abort!(); }, Math.max(0, c.timeoutMs)) : null;
      let message;
      try { message = await stream.finalMessage(); }
      catch (error) {
        if (!timedOut) throw error;
        // Stopped at the caller's time limit: the tokens used so far are still booked.
        const u = stream.currentMessage?.usage ?? {};
        return { json: null, stopReason: "timeout", model: stream.currentMessage?.model ?? choice.model, input: u.input_tokens ?? 0, output: stoppedOutputTokens(u.output_tokens, streamedChars), ms: Date.now() - started,
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

