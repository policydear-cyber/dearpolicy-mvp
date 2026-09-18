import { z } from "zod";
import { describeChoice, fullyHosted, hostedStructuredCompletion, modelFor, type ModelRole } from "./providers";
import { assertUnderSpendCap, recordUsage, SpendCapReached } from "./ledger";
import { modelIsResident, ollamaFetch, residentKeepAlive, unloadOllamaModelDirect, withOllamaLock, withResidentModel } from "./ollama-runtime";

const OllamaChatResponseSchema = z.object({
  message: z.object({ content: z.string() }),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});
function ledgerAccountId() { return process.env.DEV_ACCOUNT_ID ?? "00000000-0000-0000-0000-000000000001"; }

type CompletionRuntimeOptions = {
  timeoutMs?: number;
  attempts?: number;
  numCtx?: number;
  maxOutputTokens?: number;
};

function baseUrl() {
  return (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
}

function llmModel() {
  const model = process.env.LLM_MODEL;
  if (!model) throw new Error("LLM_MODEL is not configured in .env.local");
  return model;
}

/**
 * DearPolicy uses Ollama's native endpoint so model lifetime and context size
 * can be controlled explicitly on local GPUs.
 */
export async function chatCompletion(args: {
  system: string;
  user: string;
  temperature?: number;
} & CompletionRuntimeOptions): Promise<string> {
  const base = baseUrl();
  const model = llmModel();

  return withOllamaLock(async () => {
    try {
      const response = await ollamaFetch(
        `${base}/api/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            think: false,
            keep_alive: residentKeepAlive(),
            options: {
              temperature: args.temperature ?? 0.1,
              num_ctx: args.numCtx ?? Number(process.env.LLM_CONTEXT_SIZE ?? 4096),
              num_batch: Number(process.env.LLM_NUM_BATCH ?? 256),
              ...(args.maxOutputTokens?{num_predict:args.maxOutputTokens}:{}),
            },
            messages: [
              { role: "system", content: args.system },
              { role: "user", content: args.user },
            ],
          }),
        },
        { label: `${model} chat`, timeoutMs: args.timeoutMs ?? 300_000, attempts: args.attempts ?? 2 },
      );

      if (!response.ok) throw new Error(`LLM request failed (${response.status}): ${await response.text()}`);
      const parsed = OllamaChatResponseSchema.parse(await response.json());
      return parsed.message.content ?? "";
    } finally {
      // Inside a model session the phase owner unloads once at the end.
      if (!modelIsResident()) await unloadOllamaModelDirect(base, model);
    }
  });
}

/** Close a JSON document that the model stopped emitting mid-way.
 *
 * A local model that runs out of output budget returns syntactically valid
 * JSON up to the cut, then nothing. Rather than discarding the whole turn, cut
 * back to the last complete element and close the open containers. Returns null
 * when the text is not recoverable. */
export function repairTruncatedJson(text: string): string | null {
  const source = text.trim();
  if (!source.startsWith("{") && !source.startsWith("[")) return null;
  const open: string[] = [];
  let inString = false, escaped = false;
  let safe: { end: number; closers: string[] } | null = null;
  const closers = () => open.map(ch => (ch === "{" ? "}" : "]")).reverse();
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") { open.push(ch); continue; }
    if (ch === "}" || ch === "]") {
      open.pop();
      if (open.length) safe = { end: i + 1, closers: closers() };
      continue;
    }
    // Only a comma directly inside an ARRAY marks a complete element. A comma
    // inside an object separates key/value pairs, so cutting there would leave a
    // half-built object behind.
    if (ch === "," && open.at(-1) === "[") safe = { end: i, closers: closers() };
  }
  if (!open.length) return null;   // Already balanced; the failure was not truncation.
  if (!safe) return null;
  return source.slice(0, safe.end) + safe.closers.join("");
}

/** Structured extraction with bounded context/memory. */
export async function structuredCompletion<T>(args: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  /** Which job this is, and so which model does it: reading (a document,
   * once), judgement (interpreting a message, deciding relevance) or narration
   * (two sentences around computed figures). Each is a setting. */
  role?: ModelRole;
  /** Repairs predictable shape mistakes (a lone object where an array belongs,
   * a stray string in a list) before validation. The schema still decides what
   * is acceptable; this only stops one malformed field discarding a whole
   * section of a reply that was otherwise correct. */
  coerce?: (value: unknown) => unknown;
} & CompletionRuntimeOptions): Promise<T> {
  const jsonSchema = z.toJSONSchema(args.schema);
  const budget = args.maxOutputTokens;

  const role: ModelRole = args.role ?? "chat";
  const choice = modelFor(role);
  if (choice.provider !== "ollama") {
    await assertUnderSpendCap(ledgerAccountId());
    const started = Date.now();
    let reply;
    try {
      reply = await hostedStructuredCompletion(choice, { system: args.system, user: args.user, jsonSchema,
        temperature: args.temperature, maxOutputTokens: budget, timeoutMs: args.timeoutMs, attempts: args.attempts });
    } catch (error) {
      await recordUsage({ role, choice, input: 0, output: 0, durationMs: Date.now() - started, ok: false });
      throw error;
    }
    await recordUsage({ role, choice, input: reply.usage.input, output: reply.usage.output, cached: reply.usage.cached, durationMs: Date.now() - started, ok: true });
    let json: unknown;
    try { json = JSON.parse(reply.content); }
    catch {
      const repaired = repairTruncatedJson(reply.content);
      if (repaired === null) throw new Error(`Model returned invalid structured JSON: ${reply.content.slice(0, 200)}`);
      try { json = JSON.parse(repaired); }
      catch { throw new TruncatedModelOutput("The " + describeChoice(choice) + " model stopped part-way through its structured output.", reply.content, true); }
    }
    try { return args.schema.parse(args.coerce ? args.coerce(json) : json); }
    catch (error) {
      throw new TruncatedModelOutput(reply.truncated ? "The " + describeChoice(choice) + " model stopped part-way through its structured output."
        : "The " + describeChoice(choice) + " model's reply did not match the expected structure.", reply.content, reply.truncated, error instanceof Error ? error : undefined);
    }
  }

  const base = baseUrl();
  const model = llmModel();
  const run = async (outputTokens?: number) =>
    withOllamaLock(async () => {
    const startedLocal = Date.now();
    try {
      const response = await ollamaFetch(
        `${base}/api/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            think: false,
            keep_alive: residentKeepAlive(),
            format: jsonSchema,
            options: {
              temperature: args.temperature ?? 0,
              num_ctx: args.numCtx ?? Number(process.env.LLM_CONTEXT_SIZE ?? 4096),
              num_batch: Number(process.env.LLM_NUM_BATCH ?? 256),
              ...(outputTokens?{num_predict:outputTokens}:{}),
            },
            messages: [
              { role: "system", content: args.system },
              { role: "user", content: args.user },
            ],
          }),
        },
        { label: `${model} structured extraction`, timeoutMs: args.timeoutMs ?? 240_000, attempts: args.attempts ?? 1 },
      );

      if (!response.ok) throw new Error(`Structured LLM request failed (${response.status}): ${await response.text()}`);
      const payload = OllamaChatResponseSchema.parse(await response.json());
      void recordUsage({ role, choice: { provider: "ollama", model }, input: payload.prompt_eval_count ?? 0, output: payload.eval_count ?? 0,
        durationMs: Date.now() - startedLocal, ok: true });
      const content = payload.message.content;
      let json: unknown;
      let wasTruncated = false;
      try {
        json = JSON.parse(content);
      } catch {
        // Distinguish "stopped mid-JSON" (worth retrying with more room) from
        // plain malformed output (retrying the same call will not help).
        const repaired = repairTruncatedJson(content);
        if (repaired === null) throw new Error(`Model returned invalid structured JSON: ${content.slice(0, 200)}`);
        wasTruncated = true;
        try { json = JSON.parse(repaired); }
        catch { throw new TruncatedModelOutput("The local model stopped part-way through its structured output.", content, true); }
      }
      try { return args.schema.parse(args.coerce ? args.coerce(json) : json); }
      catch (error) {
        // Distinguish a reply cut short (worth more room) from one that was
        // complete but the wrong shape (more room will not help).
        throw new TruncatedModelOutput(
          wasTruncated ? "The local model stopped part-way through its structured output."
            : "The local model's reply did not match the expected structure.",
          content, wasTruncated, error instanceof Error ? error : undefined);
      }
    } finally {
      // Inside a model session the phase owner unloads once at the end.
      if (!modelIsResident()) await unloadOllamaModelDirect(base, model);
    }
  });

  try {
    return await run(budget);
  } catch (error) {
    // Only a reply that actually ran out of room benefits from more room.
    // Retrying a complete but misshapen reply just spends the time twice.
    if (!(error instanceof TruncatedModelOutput) || !error.truncated || !budget) throw error;
    return await run(Math.min(4096, Math.ceil(budget * 2)));
  }
}

/** Raised when the model's structured output was cut short or malformed. */
export class TruncatedModelOutput extends Error {
  readonly raw: string;
  /** True when the model ran out of output budget; false when the reply was
   * complete but did not match the schema. */
  readonly truncated: boolean;
  readonly validation?: Error;
  constructor(message: string, raw: string, truncated = true, validation?: Error) {
    super(message); this.name = "TruncatedModelOutput"; this.raw = raw; this.truncated = truncated; this.validation = validation;
  }
}
/** Plain-language cause for a failed model step.
 *
 * Validation errors and raw model output must never reach the chat: the user is
 * not debugging a schema, and a JSON dump in an insurance answer destroys trust
 * in everything around it. */
export function readableModelFailure(error: unknown) {
  if (error instanceof SpendCapReached) return error.message;
  if (error instanceof TruncatedModelOutput)
    return error.truncated ? "the model ran out of room part-way through that section" : "the model’s answer for that section was not in the expected form";
  const message = error instanceof Error ? error.message : String(error);
  const hosted = fullyHosted() || modelFor("judgement").provider !== "ollama";
  const who = hosted ? describeChoice(modelFor("judgement")) : "the local model";
  // A hosted provider's own explanation is usually the fix, said in its words.
  const enable = message.match(/has not been used in project (\d+)|is disabled\. Enable it/i);
  if (enable) {
    const project = message.match(/project (\d+)/)?.[1];
    return "Google has not switched on the API for this project yet. Open https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview" + (project ? "?project=" + project : "") + ", click Enable, wait a minute and try again";
  }
  if (/\(401\)|\(403\)|invalid.*api key|api key not valid|authentication/i.test(message)) {
    // The provider's sentence is the diagnosis; keep it, minus the noise.
    const said = message.replace(/^Model request failed \(\d+\):\s*/, "").trim();
    return who + " refused the request: " + (said || "the API key was not accepted") + (hosted ? ". Check the API key in the hosting dashboard's environment variables and its API restrictions in Google Cloud" : ". Check the key in .env.local and the key's API restrictions in Google Cloud");
  }
  if (/\(404\)|not found|does not exist|unknown model|is not supported/i.test(message)) return who + (hosted ? " does not recognise the model name set in the hosting environment variables" : " does not recognise the model name set in .env.local");
  if (/\(429\)|busy|rate limit|quota/i.test(message)) return who + " is rate-limited right now; it usually clears in under a minute";
  if (/timed out/i.test(message)) return who + " timed out on that section";
  if (/invalid structured JSON/i.test(message)) return who + " did not return usable structured output for that section";
  if (/connection error|stopped responding|ECONNREFUSED|fetch failed/i.test(message)) return hosted ? "the connection to " + who + " could not be made — check the internet connection" : "the connection to the local model dropped during that section";
  return who + " could not complete that section";
}

/** Runs a whole phase with the chat model held resident, then unloads once. */
export async function withModelSession<T>(task: () => Promise<T>): Promise<T> {
  // No local model in play: nothing to keep resident, nothing to unload, and
  // no 30-second knock on a door nobody is behind.
  if (fullyHosted()) return task();
  return withResidentModel(baseUrl(), llmModel(), task);
}

export function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Model returned an empty response instead of JSON.");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return JSON.parse(fenced);
  try { return JSON.parse(trimmed); } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error(`Model did not return JSON. Raw response: ${trimmed.slice(0, 300)}`);
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}
