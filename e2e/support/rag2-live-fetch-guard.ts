/**
 * Live-model smoke: the PROCESS-WIDE model-call guard of the live test server. RunCapGuardModel wraps only the
 * conversation loop's model; any other model call in the server (judgement / narration / reading through lib/ai, a
 * retry inside a provider client, a verification call) goes through globalThis.fetch -- so the live server installs
 * this guard on globalThis.fetch BEFORE Next.js is created, and every outgoing request is checked:
 *  - to OpenAI (api.openai.com, or the loopback relay named by OPENAI_BASE_URL): only a POST whose JSON body names a
 *    priced model and a bounded max output (max_completion_tokens / max_tokens) is sent, and only after its worst case
 *    -- (body characters / 2.5 + max output tokens) x the price on file -- is RESERVED on the run ledger; refused
 *    otherwise (no request is sent);
 *  - to any other model-provider host (Google, Anthropic, Groq, ...): refused and recorded;
 *  - anything else (the local database API, localhost) passes untouched.
 * Each sent call is settled from its response usage (cached input priced as cached); a failed call, or one with no
 * usage, keeps its whole reservation as spent. The ledger is the ONE run ledger (lib/rag2/loop/usage-meter.ts
 * installSharedRunLedger): the loop's usage meter checks it before every loop call. Never records request headers, the
 * key, or message content -- per call: host, path, model requested / reported, max output, reservation, charge,
 * usage, status, upstream latency, request settings.
 */
import { costUsd, priceFor } from "@/lib/ai/providers";
import { maxCallCostUsd, type RunCostLedger } from "@/lib/rag2/loop/usage-meter";

export const OTHER_PROVIDER_HOSTS = [
  "generativelanguage.googleapis.com", "aiplatform.googleapis.com", "api.anthropic.com", "api.groq.com", "api.mistral.ai",
  "api.cohere.ai", "api.cohere.com", "api.together.xyz", "openrouter.ai", "api.deepseek.com", "api.x.ai", "api.perplexity.ai",
  "api.fireworks.ai", "bedrock-runtime.amazonaws.com", "openai.azure.com",
];
export type HttpCall = {
  seq: number; at: string; host: string; path: string; method: string; model: string | null; maxOutputTokens: number | null;
  estInputTokens: number | null; reservedUsd: number; chargedUsd: number; ok: boolean; status?: number; refused?: string; error?: string;
  usage?: { input: number; output: number; cached: number; reasoning: number | null } | null; providerModel?: string | null; upstreamMs?: number;
  settings?: Record<string, unknown>;
};
export type FetchGuard = { calls: HttpCall[]; uninstall: () => void };

const hostOf = (u: string | undefined) => { try { return new URL(u ?? "").hostname.toLowerCase(); } catch { return ""; } };

export function installFetchGuard(opts: { ledger: RunCostLedger; env?: NodeJS.ProcessEnv; preflightRefusal?: string | null; target?: { fetch: typeof fetch } }): FetchGuard {
  const env = opts.env ?? process.env;
  const target = opts.target ?? (globalThis as { fetch: typeof fetch });
  const original = target.fetch;
  const openaiHosts = new Set(["api.openai.com", hostOf(env.OPENAI_BASE_URL)].filter(Boolean));
  const calls: HttpCall[] = [];
  const isOther = (h: string) => OTHER_PROVIDER_HOSTS.some((x) => h === x || h.endsWith("." + x));
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const host = hostOf(url);
    const openai = openaiHosts.has(host);
    if (!openai && !isOther(host)) return original(input as RequestInfo, init);
    const method = (init?.method ?? (typeof input === "object" && "method" in (input as Request) ? (input as Request).method : "GET")).toUpperCase();
    const path = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
    const rec: HttpCall = { seq: calls.length + 1, at: new Date().toISOString(), host, path, method, model: null, maxOutputTokens: null, estInputTokens: null, reservedUsd: 0, chargedUsd: 0, ok: false };
    const refuse = (why: string): never => { rec.refused = why; calls.push(rec); throw new Error(`live fetch guard refused, no request sent (no spend): ${why}`); };
    if (!openai) refuse(`${host} is not the configured model provider (only OpenAI is allowed in the live run)`);
    if (opts.preflightRefusal) refuse(opts.preflightRefusal);
    const raw = typeof init?.body === "string" ? init.body : null;
    if (method !== "POST" || raw == null) refuse(`${method} ${path}: only a POST with a JSON body (bounded max output) can be reserved`);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw!); } catch { return refuse("the request body is not JSON"); }
    const model = typeof body.model === "string" ? body.model : null;
    rec.model = model;
    const maxOut = Number(body.max_completion_tokens ?? body.max_tokens ?? body.max_output_tokens);
    rec.maxOutputTokens = Number.isFinite(maxOut) && maxOut > 0 ? maxOut : null;
    rec.settings = Object.fromEntries(["temperature", "max_completion_tokens", "max_tokens", "tool_choice", "parallel_tool_calls", "reasoning_effort", "response_format"].filter((k) => k in body).map((k) => [k, k === "response_format" ? (body.response_format as { type?: string })?.type ?? null : body[k]]));
    if (!rec.maxOutputTokens) refuse(`${model ?? "the model"}: no bounded max output tokens on the request`);
    const price = model ? priceFor({ provider: "openai", model }) : null;
    if (!price) refuse(`no price on file for openai:${model}`);
    rec.estInputTokens = Math.ceil(raw!.length / 2.5);
    const usd = maxCallCostUsd(price!, rec.estInputTokens, rec.maxOutputTokens!);
    const r = opts.ledger.reserve(usd, rec.estInputTokens, rec.maxOutputTokens!);
    if ("refused" in r) refuse(`run cap: ${r.refused}`);
    const reservation = r as Exclude<typeof r, { refused: string }>;
    rec.reservedUsd = usd;
    const t0 = Date.now();
    try {
      const res = await original(input as RequestInfo, init);
      rec.upstreamMs = Date.now() - t0; rec.status = res.status; rec.ok = res.ok;
      let actual: number | null = null;
      if (res.ok) {
        const payload = await res.clone().json().catch(() => null) as { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } } | null;
        const u = payload?.usage;
        rec.providerModel = payload?.model ?? null;
        if (u && ((u.prompt_tokens ?? 0) > 0 || (u.completion_tokens ?? 0) > 0)) {
          rec.usage = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? 0, reasoning: u.completion_tokens_details?.reasoning_tokens ?? null };
          actual = costUsd({ provider: "openai", model: model! }, { input: rec.usage.input, output: rec.usage.output, cached: rec.usage.cached });
        } else rec.usage = null;
      }
      rec.chargedUsd = opts.ledger.settle(reservation, actual);
      calls.push(rec);
      return res;
    } catch (error) {
      rec.upstreamMs = Date.now() - t0; rec.error = (error instanceof Error ? error.name + ": " + error.message : String(error)).slice(0, 160);
      rec.chargedUsd = opts.ledger.settle(reservation, null);
      calls.push(rec);
      throw error;
    }
  }) as typeof fetch;
  target.fetch = guarded;
  return { calls, uninstall: () => { if (target.fetch === guarded) target.fetch = original; } };
}
