/** Anthropic Message Batches for OFFLINE work only: test and evaluation scripts, and bulk re-reads run from a script.
 * A batch costs about half of the same calls made live, and its answer comes back minutes to hours later, so it never
 * serves the app: upload, "Read again" and chat keep the live path in model.ts, and a test (batch-model-test.ts) fails if
 * app code imports this file. The request is the live request (tableRequest), so the model sees the same prompt.
 *
 * Calls made in the same moment (a script reading pages in parallel) go in one batch. A call that does not succeed
 * (errored, expired, canceled) throws, as a failed live call does. The caller's timeoutMs does not apply: a batch has no
 * per-call time limit. Opt in with DEARPOLICY_SCRIPT_BATCH=1 through scriptTableModel(). */
import type { ModelChoice } from "@/lib/ai/providers";
import { API_BASE_URL, apiKeyFromEnv } from "@/lib/simple-chat/model";
import { anthropicTableModel, tableRequest, type TableCall, type TableModel, type TableReply } from "@/lib/benefit-table/model";

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
type Message = { content: { type: string; text?: string }[]; stop_reason: string | null; model: string; usage: Usage };
export type BatchItem = { custom_id: string; result: { type: "succeeded"; message: Message } | { type: "errored"; error?: unknown } | { type: "canceled" } | { type: "expired" } };
export type BatchClient = { messages: { batches: {
  create(p: { requests: { custom_id: string; params: unknown }[] }): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ id: string; processing_status: string }>;
  results(id: string): Promise<AsyncIterable<BatchItem>>;
} } };
export type BatchOpts = { effort?: boolean; client?: BatchClient; windowMs?: number; pollMs?: number; maxWaitMs?: number; maxPerBatch?: number; sleep?: (ms: number) => Promise<void> };

/** One finished batch item as the reply a live call would have given. */
export function replyFromBatchItem(item: BatchItem, choice: ModelChoice, ms: number): TableReply {
  if (item.result.type !== "succeeded") throw new Error(`batched call ${item.result.type}${item.result.type === "errored" ? ": " + JSON.stringify(item.result.error ?? null).slice(0, 300) : ""}`);
  const m = item.result.message;
  const text = m.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
  let json: unknown = null;
  try { json = m.stop_reason === "end_turn" ? JSON.parse(text) : null; } catch { json = null; }
  return { json, stopReason: m.stop_reason, model: m.model ?? choice.model, input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0, ms,
    cacheRead: m.usage.cache_read_input_tokens ?? 0, cacheWrite: m.usage.cache_creation_input_tokens ?? 0 };
}

export function batchedTableModel(choice: ModelChoice, opts: BatchOpts = {}): TableModel {
  const windowMs = opts.windowMs ?? 1500, pollMs = opts.pollMs ?? 20_000, maxWaitMs = opts.maxWaitMs ?? 24 * 3600_000, maxPerBatch = opts.maxPerBatch ?? 200;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  type Waiting = { call: TableCall; resolve(r: TableReply): void; reject(e: unknown): void; started: number };
  let queue: Waiting[] = [], timer: ReturnType<typeof setTimeout> | null = null;
  const clientOf = async (): Promise<BatchClient> => {
    if (opts.client) return opts.client;
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new Anthropic({ apiKey: apiKeyFromEnv().key, baseURL: API_BASE_URL }) as unknown as BatchClient;
  };
  async function run(group: Waiting[]) {
    try {
      const api = await clientOf();
      // 1h cache: a batch can take longer than the 5-minute default, and the prompt is shared by all its requests.
      const batch = await api.messages.batches.create({ requests: group.map((w, i) => ({ custom_id: "r" + i, params: tableRequest(choice, w.call, { effort: opts.effort, cacheTtl: "1h" }) })) });
      const deadline = Date.now() + maxWaitMs;
      for (;;) {
        if ((await api.messages.batches.retrieve(batch.id)).processing_status === "ended") break;
        if (Date.now() > deadline) throw new Error(`batch ${batch.id} did not end within ${Math.round(maxWaitMs / 60000)} minutes`);
        await sleep(pollMs);
      }
      const seen = new Set<number>();
      for await (const item of await api.messages.batches.results(batch.id)) {
        const i = Number(item.custom_id.slice(1)), w = group[i];
        if (!w || seen.has(i)) continue;
        seen.add(i);
        try { w.resolve(replyFromBatchItem(item, choice, Date.now() - w.started)); } catch (e) { w.reject(e); }
      }
      group.forEach((w, i) => { if (!seen.has(i)) w.reject(new Error("batch returned no result for this call")); });
    } catch (e) { group.forEach((w) => w.reject(e)); }
  }
  const flush = () => {
    timer = null;
    const all = queue; queue = [];
    for (let i = 0; i < all.length; i += maxPerBatch) void run(all.slice(i, i + maxPerBatch));
  };
  return { choice, call: (c) => new Promise<TableReply>((resolve, reject) => { queue.push({ call: c, resolve, reject, started: Date.now() }); timer ??= setTimeout(flush, windowMs); }) };
}

/** What offline scripts use in place of anthropicTableModel: the live call, or a batch when DEARPOLICY_SCRIPT_BATCH=1. */
export function scriptTableModel(choice: ModelChoice, client?: undefined, opts: { effort?: boolean } = {}, env: Record<string, string | undefined> = process.env): TableModel {
  return env.DEARPOLICY_SCRIPT_BATCH === "1" ? batchedTableModel(choice, opts) : anthropicTableModel(choice, client, opts);
}
