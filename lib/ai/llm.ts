import { z } from "zod";
import { randomUUID } from "node:crypto";
import { costUsd, describeChoice, fallbackModelFor, hostedStructuredCompletion, modelFor, ProviderQuotaExhausted, type ModelRole } from "./providers";
import { currentModelHousehold, markProviderExhausted, providerExhaustedThisRequest } from "./usage";
import { assertUnderSpendCap, recordUsage, SpendCapReached } from "./ledger";
import { recordModelExecution, assertVerifiedForMonetaryUse, MONETARY_GATED_OPERATIONS, type KnownOperation, type ModelExecutionRecord } from "./provenance";
import { canaryConfigFor, resolveRollout } from "./rollout";
import { recordErrorEvent, recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";

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

/** The one JSON object or array in a reply that wrapped it in a code fence or
 * surrounded it with prose; undefined when there is no single complete one. */
export function unwrapJsonDocument(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidates = [fenced, trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)].filter((x): x is string => !!x && x.length > 1);
  for (const candidate of candidates) { try { return JSON.parse(candidate); } catch { /* next */ } }
  return undefined;
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
  /** Checkpoint 10: which governed operation this call is (see
   * lib/ai/provenance.ts's KNOWN_OPERATIONS). Every call site SHOULD pass
   * one; omitted defaults to "chat_reply" so existing callers keep working
   * while they are migrated one at a time, but an execution recorded
   * without an explicit operation is honestly a lower-fidelity provenance
   * record, not a gap this default is meant to paper over. */
  operation?: KnownOperation;
  promptVersion?: string;
  schemaVersion?: string;
  correlationId?: string;
  householdId?: string;
  resourceId?: string;
  /** Receives the exact persisted model_executions record for the attempt
   * whose output this call returns -- only after that output has parsed
   * and validated against `schema`, and only when the record was actually
   * persisted (a provenance-persistence failure yields no callback, so a
   * caller that needs provenance simply has none and must fail closed).
   * Never invoked for a failed attempt or for the failed primary of a
   * fallback pair. Optional: existing callers are unaffected. */
  onExecutionRecord?: (record: ModelExecutionRecord) => void;
} & CompletionRuntimeOptions): Promise<T> {
  // Checkpoint 14i: "Model completions" was named as a required
  // telemetry call site (scripts/launch-check.ts's privacy_safe_
  // observability capability) -- structuredCompletion() is the ONE
  // function every structured model call in this codebase goes
  // through (see this module's own doc comment), so one event at its
  // real success/failure boundary covers every caller, the same
  // "one call = one event" convention every other Checkpoint 14b/14i
  // call site uses. Deliberately separate from recordUsage()/
  // recordModelExecution() above (the ledger/provenance boundary) --
  // this is operational telemetry, not spend accounting or monetary-
  // use governance.
  const telemetryCorrelationId = args.correlationId ?? resolveCorrelationId(undefined);
  try {
    const jsonSchema = z.toJSONSchema(args.schema);
    const budget = args.maxOutputTokens;

    const role: ModelRole = args.role ?? "chat";
    const operation: KnownOperation = args.operation ?? "chat_reply";
    // Checkpoint 11: a configured canary (CANARY_<OPERATION>_MODEL etc., see
    // lib/ai/rollout.ts) can replace the primary target for a deterministic
    // slice of subjects. Bucketing prefers householdId, falling back to
    // resourceId, so the whole household/resource sees one consistent
    // cohort; with no subject at all (or no canary configured, the default
    // for every existing call site), this resolves to stable and `choice` is
    // exactly modelFor(role) -- unchanged behavior.
    // The household this call is for: named by the caller, or set for the
    // whole request by runWithModelHousehold() (lib/ai/usage.ts). Usage and
    // the per-household spend limit are keyed to it -- never to a
    // process-wide default account, which is how a real household's calls
    // used to be booked to the development account and its usage screen
    // said "No model calls yet".
    const householdId = args.householdId ?? currentModelHousehold() ?? undefined;
    const rollout = resolveRollout(canaryConfigFor(operation), householdId ?? args.resourceId ?? null);
    const choice = rollout.target ?? modelFor(role);
    const attemptGroupId = randomUUID();
    if (householdId) await assertUnderSpendCap(householdId);
      const call = async (target: typeof choice, attemptIndex: number) => {
        const started = Date.now();
        const requestedAt = new Date();
        let reply: Awaited<ReturnType<typeof hostedStructuredCompletion>>;
        let record: Awaited<ReturnType<typeof recordModelExecution>>;
        // Already refused for exhausted quota in this request: not called again.
        if (providerExhaustedThisRequest(target.provider)) throw new ProviderQuotaExhausted(429);
        try {
          reply = await hostedStructuredCompletion(target, { system: args.system, user: args.user, jsonSchema,
            temperature: args.temperature, maxOutputTokens: budget, timeoutMs: args.timeoutMs, attempts: args.attempts });
          const durationMs = Date.now() - started;
          if (householdId) await recordUsage({ accountId: householdId, role, choice: target, input: reply.usage.input, output: reply.usage.output, cached: reply.usage.cached, durationMs, ok: true });
          record = await recordModelExecution({
            correlationId: args.correlationId, attemptGroupId, attemptIndex, operation, role,
            householdId, resourceId: args.resourceId, costUsd: costUsd(target, reply.usage),
            requested: { provider: target.provider, model: target.model, capability: role, rollout: rollout.rolloutId, promptVersion: args.promptVersion ?? null, schemaVersion: args.schemaVersion ?? null },
            requestedAt, resolved: reply.resolved, status: "succeeded",
            usage: reply.usage, latencyMs: durationMs,
          });
        } catch (error) {
          const durationMs = Date.now() - started;
          if (error instanceof ProviderQuotaExhausted) markProviderExhausted(target.provider);
          if (householdId) await recordUsage({ accountId: householdId, role, choice: target, input: 0, output: 0, durationMs, ok: false });
          await recordModelExecution({
            correlationId: args.correlationId, attemptGroupId, attemptIndex, operation, role,
            householdId, resourceId: args.resourceId,
            requested: { provider: target.provider, model: target.model, capability: role, rollout: rollout.rolloutId, promptVersion: args.promptVersion ?? null, schemaVersion: args.schemaVersion ?? null },
            requestedAt, resolved: null, status: "failed", errorCategory: error instanceof ProviderQuotaExhausted ? "provider_quota" : "model_provider", latencyMs: durationMs,
          });
          throw error;
        }
        // Checkpoint 14b: this is the ONE place every monetary-relevant AI
        // operation's output becomes available to its caller -- gate here,
        // not in each calculator/evidence-matching call site downstream,
        // which never sees a ModelExecutionRecord to check in the first
        // place. Deliberately OUTSIDE the try/catch above: assertVerified-
        // ForMonetaryUse() rejecting a genuinely successful provider call
        // must never be re-caught and re-recorded as a second, misleading
        // "failed"/model_provider model_executions row for the same
        // attemptIndex -- the call itself succeeded; only its trustworthiness
        // for a monetary result did not. A record that failed to persist
        // (record === null) is a provenance-INFRASTRUCTURE failure, not an
        // identity problem, and deliberately does not block the caller
        // either -- the same failure-isolation contract recordModelExecution()'s
        // own doc comment describes. Throws UnverifiedModelProvenanceError,
        // which does not match the rate-limit-shaped fallback trigger below,
        // so an unverified primary attempt is rejected outright rather than
        // silently retried on a fallback model.
        if (record && MONETARY_GATED_OPERATIONS.has(operation)) {
          assertVerifiedForMonetaryUse(record);
        }
        return { reply, record };
      };
      let usedChoice = choice;
      let reply: Awaited<ReturnType<typeof hostedStructuredCompletion>>;
      let usedRecord: ModelExecutionRecord | null;
      try {
        ({ reply, record: usedRecord } = await call(choice, 0));
      } catch (error) {
        // A rate limit is specific to the model, not to the household's
        // question -- when a cheaper tier of the same provider exists for this
        // role, one attempt there beats surfacing "try again in a minute" for
        // a quota the fallback tier does not share.
        // Exhausted account quota is shared by every model on that account:
        // a second model would fail the same way, only later.
        const fallback = !(error instanceof ProviderQuotaExhausted) && /\(429\)|busy|rate limit/i.test(error instanceof Error ? error.message : String(error)) ? fallbackModelFor(role) : null;
        if (!fallback) throw error;
        usedChoice = fallback;
        ({ reply, record: usedRecord } = await call(fallback, 1));
      }
      let json: unknown;
      try { json = JSON.parse(reply.content); }
      catch {
        // A complete JSON document wrapped in a code fence or followed by
        // chatter ("Let me know if...") is still the model's answer; the
        // schema below decides whether it is acceptable.
        const wrapped = unwrapJsonDocument(reply.content);
        if (wrapped !== undefined) json = wrapped;
      }
      if (json === undefined) {
        const repaired = repairTruncatedJson(reply.content);
        if (repaired === null) throw new Error(`Model returned invalid structured JSON: ${reply.content.slice(0, 200)}`);
        try { json = JSON.parse(repaired); }
        catch { throw new TruncatedModelOutput("The " + describeChoice(usedChoice) + " model stopped part-way through its structured output.", reply.content, true); }
      }
      let parsed: T;
      try { parsed = args.schema.parse(args.coerce ? args.coerce(json) : json); }
      catch (error) {
        throw new TruncatedModelOutput(reply.truncated ? "The " + describeChoice(usedChoice) + " model stopped part-way through its structured output."
          : "The " + describeChoice(usedChoice) + " model's reply did not match the expected structure.", reply.content, reply.truncated, error instanceof Error ? error : undefined);
      }
      // Handed over only once the reply has parsed and validated, and only
      // for the attempt that produced it -- see onExecutionRecord's doc.
      if (usedRecord && args.onExecutionRecord) args.onExecutionRecord(usedRecord);
      void recordEvent({
        name: "ai.structured_completion.completed",
        correlationId: telemetryCorrelationId,
        status: "success",
        householdRef: householdId ? pseudonymizeId(householdId) : null,
        resourceRef: args.resourceId ? pseudonymizeId(args.resourceId) : null,
        resolvedModel: usedChoice.model,
        extra: { operation: args.operation ?? "chat_reply", role: args.role ?? "chat" },
      });
      return parsed;
  } catch (error) {
    void recordErrorEvent({
      name: "ai.structured_completion.failed",
      correlationId: telemetryCorrelationId,
      householdRef: args.householdId ? pseudonymizeId(args.householdId) : null,
      resourceRef: args.resourceId ? pseudonymizeId(args.resourceId) : null,
      error,
      extra: { operation: args.operation ?? "chat_reply", role: args.role ?? "chat" },
    });
    throw error;
  }
}


/** A failure worth one more attempt: malformed or cut-off output, a timeout,
 * a dropped connection, a busy or failing provider. Never exhausted quota, a
 * spend limit or a configuration problem -- those fail the same way again. */
export function retryableModelFailure(error: unknown) {
  if (error instanceof SpendCapReached || error instanceof ProviderQuotaExhausted) return false;
  if (error instanceof TruncatedModelOutput) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (/\(40[0134]\)|api key|authentication|unsupported|does not support|not found|does not exist|unknown model/i.test(message)) return false;
  return /invalid structured JSON|timed out|stopped responding|connection|ECONNREFUSED|ECONNRESET|fetch failed|busy|\(429\)|\(5\d\d\)/i.test(message);
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
/** The same failure in words for the household reading the chat: no
 * provider or model names, no hosting or environment-variable advice, no
 * raw provider text. The operator-facing diagnosis is readableModelFailure,
 * which belongs in the logs. */
export const PROVIDER_UNAVAILABLE_TEXT = "DearPolicy’s reading service is unavailable right now because of a problem on our side, not with your documents";
export function householdModelFailure(error: unknown) {
  if (error instanceof SpendCapReached) return error.message;
  if (error instanceof ProviderQuotaExhausted) return PROVIDER_UNAVAILABLE_TEXT;
  if (error instanceof TruncatedModelOutput)
    return error.truncated ? "the model ran out of room part-way through that section" : "the model’s answer for that section was not in the expected form";
  const message = error instanceof Error ? error.message : String(error);
  if (/has not been used in project|is disabled\. Enable it|\(40[134]\)|invalid.*api key|api key not valid|authentication|unsupported (?:value|parameter)|does not support|not found|does not exist|unknown model|is not supported/i.test(message))
    return "DearPolicy’s reading service is unavailable because of a problem on our side, not with your documents";
  if (/\(429\)|busy|rate limit|quota/i.test(message)) return "DearPolicy’s reading service is busy right now; it usually clears in under a minute";
  if (/timed out/i.test(message)) return "DearPolicy’s reading service took too long on that section";
  if (/connection error|stopped responding|ECONNREFUSED|fetch failed/i.test(message)) return "DearPolicy could not reach its reading service";
  return "DearPolicy’s reading service could not finish that section";
}
export function readableModelFailure(error: unknown) {
  if (error instanceof SpendCapReached) return error.message;
  if (error instanceof ProviderQuotaExhausted) return "the model provider refused the call (" + error.status + "): the provider account's quota or billing limit is exhausted (not retried)";
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
  if (/unsupported (value|parameter)|does not support/i.test(message)) {
    const said = message.replace(/^Model request failed \(\d+\):\s*/, "").trim();
    return who + " rejected a request setting: " + said;
  }
  if (/\(404\)|not found|does not exist|unknown model|is not supported/i.test(message)) return who + " does not recognise the model name set in the hosting environment variables";
  if (/\(429\)|busy|rate limit|quota/i.test(message)) {
    const said = message.replace(/^Model request failed \(\d+\):\s*/, "").replace(/^Model service is busy \(\d+\):?\s*/, "").trim();
    return who + " is rate-limited right now" + (said ? ": " + said : "; it usually clears in under a minute");
  }
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
