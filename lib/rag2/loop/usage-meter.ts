/**
 * Conversational RAG: every model call the loop makes goes through this meter -- tool-loop steps, retries of failed
 * calls, and any verification call -- BEFORE it reaches the model. Per call it:
 *  - refuses to call once a limit is reached (lib/ai/usage.ts loopLimits): calls per turn (failed attempts and retries
 *    count), tokens per turn (checked against an estimate of the next call before it is made), US$ per turn, the
 *    turn's model time, the household's plan hard stop (lib/ai/ledger.ts assertUnderSpendCap), the household's monthly
 *    loop allowance, and this process's bounded run budget (an evaluation run or a Preview instance);
 *  - gives the call a timeout (the smaller of the per-call timeout, what is left of the turn, and the chat's own model
 *    time budget) and aborts it -- the provider request is cancelled through its AbortSignal -- when it runs out, or
 *    when the turn is cancelled;
 *  - records every attempt of a hosted model, succeeded or failed, in the ledger (model_usage, recordUsage) and the
 *    provenance table (model_executions, operation rag_answer, prompt version rag2-loop-*), with tokens and priced
 *    cost; a model with no priced provider (the test-only scripted model) is recorded in model_executions at zero
 *    cost (provider "scripted"), so its calls and tokens are counted too (agent F, D22).
 * Nothing here is a provider-side spend cap: these are DearPolicy's own limits, kept beneath the owner's budget.
 */
import { randomUUID } from "node:crypto";
import { costUsd } from "@/lib/ai/providers";
import { recordUsage, assertUnderSpendCap, SpendCapReached } from "@/lib/ai/ledger";
import { recordModelExecution } from "@/lib/ai/provenance";
import { addLoopRunUsage, budgetCostUsd, loopHouseholdSpendThisMonth, loopRunUsage, remainingModelTimeMs, SCRIPTED_PROVIDER, type LoopLimits } from "@/lib/ai/usage";
import type { LoopModel, ModelTurnInput, ModelTurnOutput, TraceTurn } from "./types";

export type MeterStopKind = "turn_calls" | "turn_tokens" | "turn_tokens_used" | "turn_usd" | "turn_time" | "household_allowance" | "household_spend_cap" | "run_budget" | "timeout" | "cancelled" | "model_error";
export type MeterStop = { kind: MeterStopKind; detail: string };
export type MeterResult = { ok: true; out: ModelTurnOutput } | { ok: false; stop: MeterStop };
type Call = NonNullable<TraceTurn["calls"]>[number];

/** The fewest output tokens a call is ever offered (a call that cannot even answer is not worth making). */
const MIN_OUTPUT_TOKENS = 256;
class CallTimeout extends Error { constructor(ms: number) { super(`model call timed out after ${ms} ms`); this.name = "CallTimeout"; } }
class CallCancelled extends Error { constructor() { super("model call cancelled"); this.name = "CallCancelled"; } }
const RETRYABLE = /timed out|connection|ECONNRESET|ECONNREFUSED|fetch failed|socket|busy|\(429\)|\(5\d\d\)/i;
const NOT_RETRYABLE = /quota|spend|api key|authentication|\(40[0134]\)/i;

/** A rough token count for a request (about 3.5 characters a token, rounded up): used only to refuse a call that would
 * clearly overrun the turn's token limit; the provider-reported counts are what is recorded. */
export function estimateTokens(input: Pick<ModelTurnInput, "messages" | "tools">): number {
  return Math.ceil((JSON.stringify(input.messages).length + JSON.stringify(input.tools).length) / 3.5);
}

export class LoopUsageMeter {
  readonly calls: Call[] = [];
  readonly usage = { input: 0, output: 0 };
  usd = 0;
  private readonly attemptGroupId = randomUUID();
  private householdUsd: number | null = null;
  constructor(private readonly o: { model: LoopModel; accountId: string; limits: LoopLimits; startedAt: number; promptVersion: string; signal?: AbortSignal | null; now?: () => number }) {}
  private now() { return this.o.now ? this.o.now() : Date.now(); }
  private get hosted() { return this.o.model.kind === "hosted"; }

  /** What is left of the turn's model time (ms). */
  private remainingMs(): number {
    const turnLeft = this.o.limits.turnTimeoutMs - (this.now() - this.o.startedAt);
    const chatLeft = remainingModelTimeMs();
    return Math.max(0, Math.min(turnLeft, chatLeft ?? Number.POSITIVE_INFINITY));
  }

  /** Why the next call may not be made (null when it may). */
  private async refusal(input: ModelTurnInput): Promise<MeterStop | null> {
    const L = this.o.limits;
    if (this.o.signal?.aborted) return { kind: "cancelled", detail: "the turn was cancelled" };
    if (this.calls.length >= L.maxCallsPerTurn) return { kind: "turn_calls", detail: `${this.calls.length} of ${L.maxCallsPerTurn} model calls for this turn used` };
    const used = this.usage.input + this.usage.output, next = estimateTokens(input) + input.maxOutputTokens;
    // Agent F (D23): a budget already spent (a call reported more than was left) is "used up"; a call that would pass
    // what is left is refused before it is made. Either way no further call is made.
    if (used >= L.maxTokensPerTurn) return { kind: "turn_tokens_used", detail: `${used} tokens used this turn: the limit of ${L.maxTokensPerTurn} is used up` };
    if (used + next > L.maxTokensPerTurn) return { kind: "turn_tokens", detail: `${used} tokens used this turn; the next call (about ${next}) would pass the limit of ${L.maxTokensPerTurn}` };
    if (this.remainingMs() < 1_000) return { kind: "turn_time", detail: "the time set aside for this turn's model calls is used up" };
    // Agent F (D21): the household's plan hard stop is checked before EVERY model call, whichever model it is.
    try { await assertUnderSpendCap(this.o.accountId); }
    catch (error) { if (error instanceof SpendCapReached) return { kind: "household_spend_cap", detail: error.message }; throw error; }
    if (!this.hosted) return null;
    if (this.usd >= L.maxTurnUsd) return { kind: "turn_usd", detail: `US$${this.usd.toFixed(4)} of US$${L.maxTurnUsd} for this turn used` };
    const run = loopRunUsage();
    if (run.calls >= L.runMaxCalls || run.usd >= L.runMaxUsd) return { kind: "run_budget", detail: `run budget used: ${run.calls} of ${L.runMaxCalls} calls, US$${run.usd.toFixed(4)} of US$${L.runMaxUsd}` };
    if (this.householdUsd == null) this.householdUsd = (await loopHouseholdSpendThisMonth(this.o.accountId, L.fallbackPrice).catch(() => ({ usd: Number.POSITIVE_INFINITY }))).usd;
    if (this.householdUsd + this.usd >= L.householdMonthlyUsd) return { kind: "household_allowance", detail: `this household's monthly conversation allowance (US$${L.householdMonthlyUsd}) is used up` };
    return null;
  }

  private async record(call: Call, out: ModelTurnOutput | null, error: unknown, requestedAt: Date, attemptIndex: number) {
    const choice = this.o.model.choice;
    if (!this.hosted || !choice) {
      // Agent F (D22): a model without a priced provider (the test-only scripted model) is still metered: each call
      // and its tokens are recorded in the provenance table (model_executions, rag_answer) at zero cost, so the
      // household's loop accounting sees every call. (The spend ledger, model_usage, holds priced provider calls.)
      await recordModelExecution({
        attemptGroupId: this.attemptGroupId, attemptIndex, operation: "rag_answer", role: "chat", householdId: this.o.accountId,
        requested: { provider: SCRIPTED_PROVIDER as unknown as NonNullable<LoopModel["choice"]>["provider"], model: this.o.model.id, capability: "chat", promptVersion: this.o.promptVersion },
        requestedAt, resolved: out ? { resolvedModel: out.resolvedModel ?? out.modelId ?? null, providerRequestId: null, finishReason: null, region: null } : null,
        status: call.ok ? "succeeded" : "failed", errorCategory: call.ok ? null : error instanceof CallTimeout ? "timeout" : error instanceof CallCancelled ? "cancelled" : "model_provider",
        usage: { input: call.input, output: call.output }, costUsd: 0, latencyMs: call.latencyMs,
      }).catch(() => null);
      return;
    }
    await recordUsage({ accountId: this.o.accountId, role: "chat", choice, input: call.input, output: call.output, durationMs: call.latencyMs, ok: call.ok });
    await recordModelExecution({
      attemptGroupId: this.attemptGroupId, attemptIndex, operation: "rag_answer", role: "chat", householdId: this.o.accountId,
      requested: { provider: choice.provider, model: choice.model, capability: "chat", promptVersion: this.o.promptVersion },
      requestedAt, resolved: out ? { resolvedModel: out.resolvedModel ?? null, providerRequestId: null, finishReason: null, region: null } : null,
      status: call.ok ? "succeeded" : "failed", errorCategory: call.ok ? null : error instanceof CallTimeout ? "timeout" : error instanceof CallCancelled ? "cancelled" : /quota/i.test(String((error as Error)?.message ?? error)) ? "provider_quota" : "model_provider",
      usage: { input: call.input, output: call.output }, costUsd: call.costUsd, latencyMs: call.latencyMs,
    });
  }

  /** One model step, with up to `retries` retries of a retryable failure; every attempt is checked, counted and recorded. */
  async next(input: Omit<ModelTurnInput, "signal">): Promise<MeterResult> {
    for (let attempt = 0; ; attempt++) {
      const stop = await this.refusal(input);
      if (stop) return { ok: false, stop };
      const timeoutMs = Math.max(1, Math.min(this.o.limits.callTimeoutMs, this.remainingMs()));
      const controller = new AbortController();
      const onCancel = () => controller.abort(new CallCancelled());
      this.o.signal?.addEventListener("abort", onCancel, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const requestedAt = new Date(), t0 = this.now();
      const attemptIndex = this.calls.length;
      try {
        const aborted = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { const e = new CallTimeout(timeoutMs); controller.abort(e); reject(e); }, timeoutMs);
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason instanceof Error ? controller.signal.reason : new CallCancelled()), { once: true });
        });
        // Agent F (D23): no call may be given more output tokens than the turn has left.
        const left = this.o.limits.maxTokensPerTurn - (this.usage.input + this.usage.output) - estimateTokens(input);
        const maxOutputTokens = Math.max(MIN_OUTPUT_TOKENS, Math.min(input.maxOutputTokens, left));
        const out = await Promise.race([this.o.model.next({ ...input, maxOutputTokens, signal: controller.signal }), aborted]);
        const priced = this.hosted && this.o.model.choice ? costUsd(this.o.model.choice, out.usage) : null;
        const call: Call = { attempt: attempt + 1, ok: true, input: out.usage.input, output: out.usage.output, costUsd: priced, latencyMs: this.now() - t0, ...(attempt ? { retry: true } : {}) };
        this.calls.push(call); this.usage.input += call.input; this.usage.output += call.output;
        const cost = this.hosted ? budgetCostUsd(priced, out.usage, this.o.limits.fallbackPrice) : 0;
        this.usd += cost;
        if (this.hosted) addLoopRunUsage(1, cost);
        await this.record(call, out, null, requestedAt, attemptIndex);
        return { ok: true, out };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const call: Call = { attempt: attempt + 1, ok: false, input: 0, output: 0, costUsd: null, latencyMs: this.now() - t0, error: message.slice(0, 200), ...(attempt ? { retry: true } : {}) };
        this.calls.push(call);
        if (this.hosted) addLoopRunUsage(1, 0);
        await this.record(call, null, error, requestedAt, attemptIndex);
        if (error instanceof CallTimeout) return { ok: false, stop: { kind: "timeout", detail: message } };
        if (error instanceof CallCancelled) return { ok: false, stop: { kind: "cancelled", detail: message } };
        if (attempt < this.o.limits.retries && RETRYABLE.test(message) && !NOT_RETRYABLE.test(message)) continue;
        return { ok: false, stop: { kind: "model_error", detail: message } };
      } finally {
        if (timer) clearTimeout(timer);
        this.o.signal?.removeEventListener("abort", onCancel);
      }
    }
  }
}
