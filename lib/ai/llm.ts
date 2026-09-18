import { z } from "zod";
import { describeChoice, fallbackModelFor, hostedStructuredCompletion, modelFor, type ModelRole } from "./providers";
import { assertUnderSpendCap, recordUsage, SpendCapReached } from "./ledger";
function ledgerAccountId() { return process.env.DEV_ACCOUNT_ID ?? "00000000-0000-0000-0000-000000000001"; }

type CompletionRuntimeOptions = {
  timeoutMs?: number;
  attempts?: number;
  maxOutputTokens?: number;
};

/** Close a JSON document that the model stopped emitting mid-way.
 *
 * A model that runs out of output budget returns syntactically valid JSON up
 * to the cut, then nothing. Rather than discarding the whole turn, cut
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
  await assertUnderSpendCap(ledgerAccountId());
    const call = async (target: typeof choice) => {
      const started = Date.now();
      try {
        const reply = await hostedStructuredCompletion(target, { system: args.system, user: args.user, jsonSchema,
          temperature: args.temperature, maxOutputTokens: budget, timeoutMs: args.timeoutMs, attempts: args.attempts });
        await recordUsage({ role, choice: target, input: reply.usage.input, output: reply.usage.output, cached: reply.usage.cached, durationMs: Date.now() - started, ok: true });
        return reply;
      } catch (error) {
        await recordUsage({ role, choice: target, input: 0, output: 0, durationMs: Date.now() - started, ok: false });
        throw error;
      }
    };
    let usedChoice = choice;
    let reply;
    try {
      reply = await call(choice);
    } catch (error) {
      // A rate limit is specific to the model, not to the household's
      // question -- when a cheaper tier of the same provider exists for this
      // role, one attempt there beats surfacing "try again in a minute" for
      // a quota the fallback tier does not share.
      const fallback = /\(429\)|busy|rate limit|quota/i.test(error instanceof Error ? error.message : String(error)) ? fallbackModelFor(role) : null;
      if (!fallback) throw error;
      usedChoice = fallback;
      reply = await call(fallback);
    }
    let json: unknown;
    try { json = JSON.parse(reply.content); }
    catch {
      const repaired = repairTruncatedJson(reply.content);
      if (repaired === null) throw new Error(`Model returned invalid structured JSON: ${reply.content.slice(0, 200)}`);
      try { json = JSON.parse(repaired); }
      catch { throw new TruncatedModelOutput("The " + describeChoice(usedChoice) + " model stopped part-way through its structured output.", reply.content, true); }
    }
    try { return args.schema.parse(args.coerce ? args.coerce(json) : json); }
    catch (error) {
      throw new TruncatedModelOutput(reply.truncated ? "The " + describeChoice(usedChoice) + " model stopped part-way through its structured output."
        : "The " + describeChoice(usedChoice) + " model's reply did not match the expected structure.", reply.content, reply.truncated, error instanceof Error ? error : undefined);
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
  const who = describeChoice(modelFor("judgement"));
  // A hosted provider's own explanation is usually the fix, said in its words.
  const enable = message.match(/has not been used in project (\d+)|is disabled\. Enable it/i);
  if (enable) {
    const project = message.match(/project (\d+)/)?.[1];
    return "Google has not switched on the API for this project yet. Open https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview" + (project ? "?project=" + project : "") + ", click Enable, wait a minute and try again";
  }
  if (/\(401\)|\(403\)|invalid.*api key|api key not valid|authentication/i.test(message)) {
    // The provider's sentence is the diagnosis; keep it, minus the noise.
    const said = message.replace(/^Model request failed \(\d+\):\s*/, "").trim();
    return who + " refused the request: " + (said || "the API key was not accepted") + ". Check the API key in the hosting dashboard's environment variables and its API restrictions in Google Cloud";
  }
  if (/\(404\)|not found|does not exist|unknown model|is not supported/i.test(message)) return who + " does not recognise the model name set in the hosting environment variables";
  if (/\(429\)|busy|rate limit|quota/i.test(message)) return who + " is rate-limited right now; it usually clears in under a minute";
  if (/timed out/i.test(message)) return who + " timed out on that section";
  if (/invalid structured JSON/i.test(message)) return who + " did not return usable structured output for that section";
  if (/connection error|stopped responding|ECONNREFUSED|fetch failed/i.test(message)) return "the connection to " + who + " could not be made — check the internet connection";
  return who + " could not complete that section";
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
