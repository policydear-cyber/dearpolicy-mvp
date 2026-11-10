/**
 * Checkpoint 10 (claude/v1-launch-hardening): model execution provenance.
 *
 * The single place production code persists a record of a model call --
 * requested identity, resolved identity, outcome, and whether the record is
 * VERIFIED enough to let a monetary result depend on it. Wired into the two
 * functions that actually reach a provider (lib/ai/llm.ts's
 * structuredCompletion(), lib/documents/ocr-hosted.ts's attemptHostedOcr()),
 * which between them are the only two call paths every one of this
 * codebase's AI operations (policy/coverage/benefit extraction, claim-
 * evidence extraction, chat, catalog building, condition matching,
 * relevance judging, RAG answering, hosted OCR) goes through -- see
 * lib/ai/providers.ts's hostedStructuredCompletion()/hostedDocumentToText()
 * for the provider-specific response parsing this module consumes.
 *
 * Two-level identity, mirroring lib/ai/providers.ts's ResolvedModelIdentity:
 *   requested -- what modelFor()/a caller asked for. May legitimately be a
 *                family alias ("flash", "haiku") a provider resolves
 *                server-side to a specific dated model.
 *   resolved  -- what the PROVIDER'S OWN RESPONSE reported for this exact
 *                call. A family alias is never treated as a resolved
 *                identity, and nothing here ever copies requested.model
 *                into resolved.model as a fallback: if the provider did not
 *                return one, resolved.model is null and the row is
 *                unverified.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool, query } from "@/lib/db/client";
import type { ModelChoice, ModelRole, Provider } from "./providers";
import type { ResolvedModelIdentity } from "./providers";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { recordEvent } from "@/lib/telemetry";

// ---------------------------------------------------------------------------
// Schema bootstrap -- same ensure-schema-once-per-process pattern as
// lib/ai/ledger.ts's ensureLedgerSchema() and lib/jobs/queue.ts's
// background_jobs table: additive, idempotent SQL run inside an advisory
// lock, never a tracked migration list. A distinct advisory-lock key from
// the ledger's (73499203) and background-jobs' own, so concurrent bootstrap
// of unrelated schemas never contends on the same lock.
// ---------------------------------------------------------------------------
type ProvenanceGlobals = { __dearpolicyProvenanceSchema?: Promise<void> };
export async function ensureProvenanceSchema() {
  const state = globalThis as ProvenanceGlobals;
  state.__dearpolicyProvenanceSchema ??= (async () => {
    const sql = await readFile(path.join(process.cwd(), "sql/model-provenance.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73499311)");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    delete state.__dearpolicyProvenanceSchema;
    throw error;
  });
  await state.__dearpolicyProvenanceSchema;
}

// ---------------------------------------------------------------------------
// Known operations. Deliberately a closed list, not a freeform string any
// caller can invent -- a typo'd operation name would silently fragment the
// provenance record for what should be one governed operation into two,
// and Checkpoint 11's compatibility matrix keys off this same list.
// ---------------------------------------------------------------------------
export const KNOWN_OPERATIONS = [
  "policy_extraction",
  "coverage_extraction",
  "benefit_extraction",
  "condition_catalog_extraction",
  "claim_evidence_extraction",
  "claim_fact_finding",
  "medical_evidence_extraction",
  "chat_reply",
  "chat_fact_finding",
  "relevance_judging",
  "rag_answer",
  "catalog_building",
  "ledger_extraction",
  "hosted_ocr",
] as const;
export type KnownOperation = (typeof KNOWN_OPERATIONS)[number];
export function isKnownOperation(value: string): value is KnownOperation {
  return (KNOWN_OPERATIONS as readonly string[]).includes(value);
}

/** Checkpoint 14b: which KNOWN_OPERATIONS entries can feed a monetary
 * result, an evidence match, a claim-eligibility determination, a
 * composed decision packet, or a user-facing policy answer presented as
 * current -- exactly the surfaces assertVerifiedForMonetaryUse()'s own
 * doc comment names. Gated centrally at the two real chokepoints every
 * one of these operations already goes through (lib/ai/llm.ts's
 * structuredCompletion(), lib/documents/ocr-hosted.ts's
 * attemptHostedOcr()) rather than at each individual calculator/
 * evidence-matching call site -- those sites never see a raw model
 * response or a ModelExecutionRecord to check in the first place, only
 * the already-extracted structured data, so the chokepoint is the only
 * place a "was this actually verified" decision can be made before that
 * data starts propagating. relevance_judging is deliberately excluded:
 * it only narrows which candidates get considered downstream (a ranking
 * aid), it is never itself persisted as a fact, a monetary figure, or a
 * user-facing answer. */
export const MONETARY_GATED_OPERATIONS: ReadonlySet<KnownOperation> = new Set([
  "policy_extraction",
  "coverage_extraction",
  "benefit_extraction",
  "condition_catalog_extraction",
  "claim_evidence_extraction",
  "claim_fact_finding",
  "medical_evidence_extraction",
  "chat_reply",
  "chat_fact_finding",
  "rag_answer",
  "catalog_building",
  "ledger_extraction",
  "hosted_ocr",
]);

export type RequestedModelIdentity = {
  provider: Provider;
  model: string;
  capability: ModelRole;
  rollout?: string | null;
  promptVersion?: string | null;
  schemaVersion?: string | null;
  inputArtifactType?: string | null;
  inputArtifactVersion?: string | null;
};

export type RecordModelExecutionInput = {
  correlationId?: string | null;
  attemptGroupId: string;
  attemptIndex: number;
  operation: KnownOperation;
  role: ModelRole;
  householdId?: string | null;
  resourceId?: string | null;
  requested: RequestedModelIdentity;
  requestedAt: Date;
  resolved: ResolvedModelIdentity | null;
  status: "succeeded" | "failed";
  errorCategory?: string | null;
  usage?: { input: number; output: number; cached?: number } | null;
  costUsd?: number | null;
  latencyMs?: number | null;
};

export type ModelExecutionRecord = RecordModelExecutionInput & {
  id: string;
  verified: boolean;
};

/** A resolved identity counts as verified ONLY when the provider's own
 * response reported a non-empty model string for THIS call and the call
 * succeeded. A family alias, an empty string, or a resolved identity taken
 * from a FAILED attempt (the fallback that follows it is what actually
 * produced the usable output, if anything did) can never verify. This is
 * the one function every "can this unlock a monetary result" decision
 * ultimately reduces to -- see assertVerifiedForMonetaryUse() below.
 *
 * Documented exception (owner decision, 10 Nov 2026): a Baidu PaddleOCR job (lib/documents/ocr-baidu.ts) carries the
 * exact versioned model it was submitted with plus Baidu's own job id, because Baidu's API does not report a model
 * name. See BAIDU_IDENTITY_EXCEPTION there; no other provider may fill resolvedModel from the request. */
export function computeVerified(status: "succeeded" | "failed", resolved: ResolvedModelIdentity | null): boolean {
  if (status !== "succeeded") return false;
  if (!resolved) return false;
  if (!resolved.resolvedModel || resolved.resolvedModel.trim() === "") return false;
  return true;
}

/** Persists one attempt. Never throws into the caller's own operation --
 * the same failure-isolation contract as lib/telemetry/index.ts's
 * recordEvent() (persistence failing must never fail or mask the model call
 * itself), and it also mirrors a summary telemetry event through
 * recordEvent() so provenance activity is visible in the same operational
 * stream Checkpoint 9 built, correlated by the same correlation id. */
export async function recordModelExecution(input: RecordModelExecutionInput): Promise<ModelExecutionRecord | null> {
  const correlationId = resolveCorrelationId(input.correlationId ?? undefined);
  const verified = computeVerified(input.status, input.resolved);
  const id = randomUUID();
  const record: ModelExecutionRecord = { ...input, correlationId, id, verified };

  try {
    await ensureProvenanceSchema();
    await query(
      `INSERT INTO model_executions(
         id, correlation_id, attempt_group_id, attempt_index, operation, role, household_ref, resource_ref,
         requested_provider, requested_model, requested_capability, requested_rollout, prompt_version, schema_version,
         input_artifact_type, input_artifact_version, requested_at,
         resolved_provider, resolved_model, provider_request_id, region, finish_reason, resolved_at,
         status, error_category, input_tokens, output_tokens, cached_tokens, cost_usd, latency_ms, verified
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
      [
        id,
        correlationId,
        input.attemptGroupId,
        input.attemptIndex,
        input.operation,
        input.role,
        input.householdId ? pseudonymizeId(input.householdId) : null,
        input.resourceId ? pseudonymizeId(input.resourceId) : null,
        input.requested.provider,
        input.requested.model,
        input.requested.capability,
        input.requested.rollout ?? null,
        input.requested.promptVersion ?? null,
        input.requested.schemaVersion ?? null,
        input.requested.inputArtifactType ?? null,
        input.requested.inputArtifactVersion ?? null,
        input.requestedAt,
        // resolved_provider: the provider that actually served the call. It differs from requested.provider when scanned
        // pages were read by a document-capable fallback (lib/ai/providers.ts hostedDocumentToText, reply.servedBy).
        input.resolved?.resolvedProvider ?? input.requested.provider,
        input.resolved?.resolvedModel ?? null,
        input.resolved?.providerRequestId ?? null,
        input.resolved?.region ?? null,
        input.resolved?.finishReason ?? null,
        input.resolved ? new Date() : null,
        input.status,
        input.errorCategory ?? null,
        input.usage?.input ?? 0,
        input.usage?.output ?? 0,
        input.usage?.cached ?? 0,
        input.costUsd ?? null,
        input.latencyMs ?? null,
        verified,
      ],
    );
  } catch {
    // Provenance persistence must never fail the model call it is
    // recording -- same failure-isolation contract as telemetry.
    return null;
  }

  await recordEvent({
    name: "model.execution.recorded",
    correlationId,
    status: input.status === "succeeded" ? "success" : "failure",
    jobType: null,
    processingState: input.operation,
    requestedModel: input.requested.provider + ":" + input.requested.model,
    resolvedModel: input.resolved?.resolvedModel ? input.requested.provider + ":" + input.resolved.resolvedModel : null,
    promptVersion: input.requested.promptVersion ?? null,
    schemaVersion: input.requested.schemaVersion ?? null,
    householdRef: input.householdId ? pseudonymizeId(input.householdId) : null,
    resourceRef: input.resourceId ? pseudonymizeId(input.resourceId) : null,
    extra: { attemptGroupId: input.attemptGroupId, attemptIndex: input.attemptIndex, verified },
  });

  return record;
}

/** Thrown by assertVerifiedForMonetaryUse() -- a distinct class (not a bare
 * Error) so callers, and lib/telemetry/errors.ts's classification table,
 * can recognize this specific refusal. */
export class UnverifiedModelProvenanceError extends Error {
  constructor(operation: string) {
    super(`Model execution for "${operation}" is not verified (no exact resolved model identity from the provider) -- refusing to let it unlock a monetary result.`);
    this.name = "UnverifiedModelProvenanceError";
  }
}

/** The actual enforcement point: call this before letting a calculator or
 * evidence-linking step depend on a model-derived value for a monetary
 * result. Throws UnverifiedModelProvenanceError rather than returning a
 * boolean, so a caller cannot accidentally ignore a false return and
 * proceed anyway -- the same "fail closed, not silently" shape as
 * lib/lifecycle's authorization checks. NOT YET WIRED into the actual
 * calculator/evidence-linking call sites in this codebase (see PR body);
 * the primitive is built and sabotage-verified on its own, same as
 * Checkpoint 9's telemetry boundary was before every call site adopted it. */
export function assertVerifiedForMonetaryUse(record: Pick<ModelExecutionRecord, "verified" | "operation">): void {
  if (!record.verified) throw new UnverifiedModelProvenanceError(record.operation);
}

// ---------------------------------------------------------------------------
// Compatibility validation. A minimal, Checkpoint-10-scoped version of what
// Checkpoint 11's full governance registry will own -- this rejects an
// internally incoherent combination (e.g. a schema version paired with a
// validator that was never built to read it) BEFORE persistence, per the
// checkpoint's own requirement, rather than persisting first and hoping
// something downstream notices.
// ---------------------------------------------------------------------------
export type CompatibilityCheck = {
  operation: KnownOperation;
  promptVersion: string | null;
  schemaVersion: string | null;
  outputValidatorVersion?: string | null;
  downstreamCalculatorVersion?: string | null;
};
export type CompatibilityResult = { compatible: boolean; reason?: string };

/** Per-operation minimum schema version this codebase's own output
 * validators/downstream readers currently understand. A schema_version
 * older than this (or absent, once an operation has been migrated to
 * require one) is incompatible -- persisted as such, never silently
 * accepted. Empty for an operation not yet requiring a versioned schema
 * (most of them, honestly, since call-site migration to pass promptVersion/
 * schemaVersion is itself incremental -- see PR body). */
const MINIMUM_SCHEMA_VERSION: Partial<Record<KnownOperation, string>> = {
  claim_evidence_extraction: "claim-evidence-extract-v1",
};

export function validateCompatibility(check: CompatibilityCheck): CompatibilityResult {
  const minimum = MINIMUM_SCHEMA_VERSION[check.operation];
  if (minimum && check.schemaVersion !== minimum) {
    return { compatible: false, reason: `"${check.operation}" requires schema_version "${minimum}"; got ${check.schemaVersion ? `"${check.schemaVersion}"` : "none"}.` };
  }
  if (check.downstreamCalculatorVersion && check.outputValidatorVersion && check.downstreamCalculatorVersion !== check.outputValidatorVersion) {
    return { compatible: false, reason: `downstream calculator version "${check.downstreamCalculatorVersion}" does not match output validator version "${check.outputValidatorVersion}".` };
  }
  return { compatible: true };
}
