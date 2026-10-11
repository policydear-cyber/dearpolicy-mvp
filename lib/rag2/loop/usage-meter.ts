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
 * Agent H (run cap): before EVERY hosted call -- retries included -- the worst case of that call is RESERVED against the
 * run budget: (estimated input tokens + the call's max output tokens) x the model's price on file (lib/ai/providers.ts
 * priceFor; the deliberately high fallback price when none is on file, or a refusal when
 * DEARPOLICY_RAG_LOOP_REQUIRE_PRICE=1). The call is refused when spent + reserved + this reservation would pass the run
 * cap. After the call the reservation is settled at the priced cost the provider's usage gives; a failed call, or one
 * whose provider reported no usage, keeps its whole reservation as spent (never 0).
 * Nothing here is a provider-side spend cap: these are DearPolicy's own limits, kept beneath the owner's budget.
 */
import { randomUUID } from "node:crypto";
import { costUsd, priceFor, type Price } from "@/lib/ai/providers";
import { recordUsage, assertUnderSpendCap, SpendCapReached } from "@/lib/ai/ledger";
import { recordModelExecution } from "@/lib/ai/provenance";
import { addLoopRunUsage, budgetCostUsd, loopHouseholdSpendThisMonth, loopRunUsage, remainingModelTimeMs, SCRIPTED_PROVIDER, type LoopLimits } from "@/lib/ai/usage";
import type { LoopModel, ModelTurnInput, ModelTurnOutput, TraceTurn } from "./types";

export type MeterStopKind = "turn_calls" | "turn_tokens" | "turn_tokens_used" | "turn_usd" | "turn_time" | "household_allowance" | "household_spend_cap" | "run_budget" | "timeout" | "cancelled" | "model_error";
export type MeterStop = { kind: MeterStopKind; detail: string };
export type MeterResult = { ok: true; out: ModelTurnOutput } | { ok: false; stop: MeterStop };
type Call = NonNullable<TraceTurn["calls"]>[number];

/** A1: the cached input tokens a provider reported for a call (part of its input tokens; 0 when none reported). */
export function cachedTokensOf(usage: { input: number; output: number; cached?: number } | null | undefined): number {
  const c = usage?.cached;
  return typeof c === "number" && Number.isFinite(c) && c > 0 ? Math.min(Math.floor(c), Math.max(0, usage!.input)) : 0;
}
/** A1: the ACTUAL estimated cost of a call -- the provider-reported usage at the model's price on file, cached input at
 * the cached-input rate (full input price when none is on file); null when the model has no price. Distinct from the
 * pre-call RESERVATION (maxCallCostUsd: every estimated input token and every allowed output token at full price),
 * which only guards the run cap and is settled down to this figure. */
export function actualCallCostUsd(choice: Parameters<typeof costUsd>[0], usage: { input: number; output: number; cached?: number }): number | null {
  return costUsd(choice, { input: usage.input, output: usage.output, cached: cachedTokensOf(usage) });
}

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

/** Agent H: the input tokens a call's cost RESERVATION assumes -- deliberately above estimateTokens (2.5 characters a
 * token rather than 3.5), so a JSON-heavy prompt that tokenizes densely is still covered by its reservation. */
export function reserveInputTokens(input: Pick<ModelTurnInput, "messages" | "tools">): number {
  return Math.ceil((JSON.stringify(input.messages).length + JSON.stringify(input.tools).length) / 2.5);
}

/** Agent H: the most one call can cost at `price` (US$ per million tokens): every estimated input token and every output
 * token it is allowed. */
export function maxCallCostUsd(price: Price, estInputTokens: number, maxOutputTokens: number): number {
  return (Math.max(0, estInputTokens) * price.input + Math.max(0, maxOutputTokens) * price.output) / 1_000_000;
}

export type CostReservation = { id: number; usd: number; estInputTokens: number; maxOutputTokens: number };
/** Agent H: a run budget kept by reservation. reserve() before a call (refused when spent + reserved + the call's worst
 * case would pass the cap); settle() after it with the priced actual cost, or null when the provider reported no usage
 * (or the call failed) -- the reservation is then kept as spent. Used by the meter's process-wide run budget and by the
 * live harness's own guard (e2e/support/rag2-live-guard.ts, its own instance). */
export class RunCostLedger {
  spentUsd = 0;
  reservedUsd = 0;
  calls = 0;
  refusals = 0;
  private seq = 0;
  private readonly open = new Map<number, CostReservation>();
  constructor(readonly capUsd: number) {
    if (!Number.isFinite(capUsd) || capUsd < 0) throw new Error("run cap must be a non-negative number of US$");
  }
  get remainingUsd() { return Math.max(0, this.capUsd - this.spentUsd - this.reservedUsd); }
  reserve(usd: number, estInputTokens: number, maxOutputTokens: number): CostReservation | { refused: string } {
    if (!Number.isFinite(usd) || usd < 0) { this.refusals++; return { refused: "the call's cost could not be estimated" }; }
    if (this.spentUsd + this.reservedUsd + usd > this.capUsd + 1e-12) {
      this.refusals++;
      return { refused: `run cap US$${this.capUsd.toFixed(2)}: US$${this.spentUsd.toFixed(6)} spent + US$${this.reservedUsd.toFixed(6)} reserved; the next call may cost up to US$${usd.toFixed(6)}` };
    }
    const r: CostReservation = { id: ++this.seq, usd, estInputTokens, maxOutputTokens };
    this.open.set(r.id, r);
    this.reservedUsd += usd;
    return r;
  }
  /** Settles a reservation; returns what was charged (the actual cost, else the whole reservation). */
  settle(r: CostReservation, actualUsd: number | null): number {
    if (!this.open.delete(r.id)) return 0;
    this.reservedUsd = Math.max(0, this.reservedUsd - r.usd);
    const charged = actualUsd != null && Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : r.usd;
    this.spentUsd += charged;
    this.calls += 1;
    return charged;
  }
  snapshot() { return { capUsd: this.capUsd, spentUsd: this.spentUsd, reservedUsd: this.reservedUsd, remainingUsd: this.remainingUsd, calls: this.calls, refusals: this.refusals, open: this.open.size }; }
}
/** Agent H (live runs): ONE run ledger for the whole process. When a test server installs it (the live smoke's fetch
 * guard, e2e/support/rag2-live-fetch-guard.ts, reserves and settles every provider request on it), the meter refuses a
 * call whose worst case no longer fits what that ledger has left -- it does not reserve a second time; the request
 * itself is reserved where it is sent. */
const SHARED_LEDGER = Symbol.for("dearpolicy.rag2.live.run-ledger");
export function installSharedRunLedger(ledger: RunCostLedger | null): void { (globalThis as { [SHARED_LEDGER]?: RunCostLedger | null })[SHARED_LEDGER] = ledger; }
export function sharedRunLedger(): RunCostLedger | null {
  const l = (globalThis as { [SHARED_LEDGER]?: unknown })[SHARED_LEDGER];
  return l && typeof (l as RunCostLedger).reserve === "function" ? (l as RunCostLedger) : null;
}
/** What the meter's in-flight calls in this process have reserved against the run budget (shared by every turn). */
const RUN_RESERVED = Symbol.for("dearpolicy.rag2.loop.run-reserved");
function runReserved(): { usd: number } { const g = globalThis as { [RUN_RESERVED]?: { usd: number } }; return (g[RUN_RESERVED] ??= { usd: 0 }); }
/** Agent H: the price a hosted call is reserved and budgeted at; null = refuse (no price on file and
 * DEARPOLICY_RAG_LOOP_REQUIRE_PRICE=1: fail closed). */
export function budgetPriceFor(model: LoopModel, fallback: Price, env: NodeJS.ProcessEnv = process.env): Price | null {
  const price = model.choice ? priceFor(model.choice) : null;
  if (price) return price;
  return env.DEARPOLICY_RAG_LOOP_REQUIRE_PRICE === "1" ? null : fallback;
}

export class LoopUsageMeter {
  readonly calls: Call[] = [];
  readonly usage = { input: 0, output: 0 };
  usd = 0;
  private readonly attemptGroupId = randomUUID();
  private householdUsd: number | null = null;
  /** Round 9: one model call granted beyond the turn's call limit for the turn's single bounded repair (the token,
   * time and spend limits still apply). */
  private repairCall = 0;
  grantRepairCall() { this.repairCall = 1; }
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
  private async refusal(input: ModelTurnInput, reservationUsd = 0): Promise<MeterStop | null> {
    const L = this.o.limits;
    if (this.o.signal?.aborted) return { kind: "cancelled", detail: "the turn was cancelled" };
    if (this.calls.length >= L.maxCallsPerTurn + this.repairCall) return { kind: "turn_calls", detail: `${this.calls.length} of ${L.maxCallsPerTurn} model calls for this turn used` };
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
    // Agent H: the call's worst case is reserved first; refused when it could pass the run cap.
    const reserved = runReserved().usd;
    if (run.usd + reserved + reservationUsd > L.runMaxUsd + 1e-12) return { kind: "run_budget", detail: `run budget: US$${run.usd.toFixed(6)} spent + US$${reserved.toFixed(6)} reserved of US$${L.runMaxUsd}; the next call may cost up to US$${reservationUsd.toFixed(6)}` };
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
        usage: { input: call.input, output: call.output, cached: cachedTokensOf(out?.usage) }, costUsd: 0, latencyMs: call.latencyMs,
      }).catch(() => null);
      return;
    }
    const cached = call.ok ? cachedTokensOf(out?.usage) : 0;
    await recordUsage({ accountId: this.o.accountId, role: "chat", choice, input: call.input, output: call.output, cached, durationMs: call.latencyMs, ok: call.ok });
    await recordModelExecution({
      attemptGroupId: this.attemptGroupId, attemptIndex, operation: "rag_answer", role: "chat", householdId: this.o.accountId,
      requested: { provider: choice.provider, model: choice.model, capability: "chat", promptVersion: this.o.promptVersion },
      requestedAt, resolved: out ? { resolvedModel: out.resolvedModel ?? null, providerRequestId: out.providerRequestId ?? null, finishReason: null, region: null } : null,
      status: call.ok ? "succeeded" : "failed", errorCategory: call.ok ? null : error instanceof CallTimeout ? "timeout" : error instanceof CallCancelled ? "cancelled" : /quota/i.test(String((error as Error)?.message ?? error)) ? "provider_quota" : "model_provider",
      usage: { input: call.input, output: call.output, cached }, costUsd: call.costUsd, latencyMs: call.latencyMs,
    });
  }

  /** One model step, with up to `retries` retries of a retryable failure; every attempt is checked, counted and recorded. */
  async next(input: Omit<ModelTurnInput, "signal">): Promise<MeterResult> {
    for (let attempt = 0; ; attempt++) {
      // Agent D23 / H: the call's output allowance (never more than the turn has left) is fixed before the call, so its
      // worst-case cost can be reserved against the run budget.
      const est = estimateTokens(input);
      const left = this.o.limits.maxTokensPerTurn - (this.usage.input + this.usage.output) - est;
      const maxOutputTokens = Math.max(MIN_OUTPUT_TOKENS, Math.min(input.maxOutputTokens, left));
      let reservationUsd = 0;
      if (this.hosted) {
        const price = budgetPriceFor(this.o.model, this.o.limits.fallbackPrice);
        if (!price) return { ok: false, stop: { kind: "run_budget", detail: `no price on file for ${this.o.model.id}: refused (DEARPOLICY_RAG_LOOP_REQUIRE_PRICE=1)` } };
        reservationUsd = maxCallCostUsd(price, reserveInputTokens(input), maxOutputTokens);
      }
      const shared = this.hosted ? sharedRunLedger() : null;
      if (shared && reservationUsd > shared.remainingUsd + 1e-12) return { ok: false, stop: { kind: "run_budget", detail: `run ledger: US$${shared.spentUsd.toFixed(6)} spent + US$${shared.reservedUsd.toFixed(6)} reserved of US$${shared.capUsd}; the next call may cost up to US$${reservationUsd.toFixed(6)}` } };
      const stop = await this.refusal(input, shared ? 0 : reservationUsd);
      if (stop) return { ok: false, stop };
      if (shared) reservationUsd = 0; // reserved and settled on the shared ledger where the request is sent
      runReserved().usd += reservationUsd;
      let held = reservationUsd > 0;
      const release = () => { if (held) { runReserved().usd = Math.max(0, runReserved().usd - reservationUsd); held = false; } };
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
        const out = await Promise.race([this.o.model.next({ ...input, maxOutputTokens, signal: controller.signal }), aborted]);
        // A1: the actual estimated cost, from the provider-reported usage (cached input at the cached rate).
        const actualCostUsd = this.hosted && this.o.model.choice ? actualCallCostUsd(this.o.model.choice, out.usage) : null;
        const call: Call = { attempt: attempt + 1, ok: true, input: out.usage.input, output: out.usage.output, costUsd: actualCostUsd, latencyMs: this.now() - t0, ...(attempt ? { retry: true } : {}) };
        this.calls.push(call); this.usage.input += call.input; this.usage.output += call.output;
        const cost = this.hosted ? budgetCostUsd(actualCostUsd, out.usage, this.o.limits.fallbackPrice) : 0;
        // Agent H: the run budget is settled at the priced cost; a call whose provider reported no usage keeps its whole
        // reservation as spent there. (The turn's own US$ limit counts the priced usage, as before.)
        const reported = out.usage.input > 0 || out.usage.output > 0;
        release();
        this.usd += cost;
        if (this.hosted) addLoopRunUsage(1, reported ? cost : reservationUsd);
        await this.record(call, out, null, requestedAt, attemptIndex);
        return { ok: true, out };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const call: Call = { attempt: attempt + 1, ok: false, input: 0, output: 0, costUsd: null, latencyMs: this.now() - t0, error: message.slice(0, 200), ...(attempt ? { retry: true } : {}) };
        this.calls.push(call);
        // Agent H: a failed call reports no usage: its whole reservation is kept as spent against the RUN budget (never
        // booked as 0). (The turn's own US$ limit counts priced usage only, as before, so one retry stays possible.)
        release();
        if (this.hosted) addLoopRunUsage(1, reservationUsd);
        await this.record(call, null, error, requestedAt, attemptIndex);
        if (error instanceof CallTimeout) return { ok: false, stop: { kind: "timeout", detail: message } };
        if (error instanceof CallCancelled) return { ok: false, stop: { kind: "cancelled", detail: message } };
        if (attempt < this.o.limits.retries && RETRYABLE.test(message) && !NOT_RETRYABLE.test(message)) continue;
        return { ok: false, stop: { kind: "model_error", detail: message } };
      } finally {
        release();
        if (timer) clearTimeout(timer);
        this.o.signal?.removeEventListener("abort", onCancel);
      }
    }
  }
}
