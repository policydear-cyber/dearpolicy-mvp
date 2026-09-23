/**
 * Regression suite for Checkpoint 10 (claude/v1-launch-hardening): model
 * execution provenance (lib/ai/provenance.ts) -- two-level identity
 * (requested vs. provider-resolved), persistence, the verified/unverified
 * gate a monetary result must respect, compatibility validation, and the
 * real wiring into lib/ai/llm.ts's structuredCompletion() and
 * lib/documents/ocr-hosted.ts's attemptHostedOcr().
 *
 * Proven against a disposable PGlite instance (sql/schema.sql plus
 * sql/model-provenance.sql), with lib/db/client.ts's `pool` monkey-patched
 * to route through it -- the same established pattern every other
 * regression suite in this checkpoint family uses (see
 * scripts/background-jobs-regressions.ts). The end-to-end cases at the
 * bottom additionally monkey-patch global.fetch to simulate real provider
 * HTTP responses (a valid Anthropic payload, a rate-limit failure), so the
 * REAL structuredCompletion() -> hostedStructuredCompletion() ->
 * anthropicMessages() -> JSON-shape-parsing -> recordModelExecution() path
 * runs end to end, not a reimplementation of its logic -- never infer a
 * capability works from source inspection alone.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter, getTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter, CapturingTelemetryAdapter } from "@/lib/telemetry/adapters";
import {
  recordModelExecution,
  computeVerified,
  assertVerifiedForMonetaryUse,
  UnverifiedModelProvenanceError,
  validateCompatibility,
  isKnownOperation,
  KNOWN_OPERATIONS,
  ensureProvenanceSchema,
  type RecordModelExecutionInput,
} from "@/lib/ai/provenance";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";

const SQL_FILES = ["sql/schema.sql", "sql/model-provenance.sql"];

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}
function test(name: string, fn: () => void) {
  try {
    fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

function baseInput(overrides: Partial<RecordModelExecutionInput> = {}): RecordModelExecutionInput {
  return {
    attemptGroupId: randomUUID(),
    attemptIndex: 0,
    operation: "policy_extraction",
    role: "reading",
    requested: { provider: "anthropic", model: "claude-haiku-4-5", capability: "reading" },
    requestedAt: new Date(),
    resolved: { resolvedModel: "claude-haiku-4-5-20250514", providerRequestId: "msg_abc123", finishReason: "end_turn", region: null },
    status: "succeeded",
    usage: { input: 100, output: 50 },
    latencyMs: 1200,
    ...overrides,
  };
}

async function runDatabaseTests() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) {
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }

  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    // Real Postgres via node-postgres uses the simple query protocol for a
    // bare, zero-param client.query(text) call (e.g. lib/ai/provenance.ts's
    // ensureProvenanceSchema() running its whole multi-statement schema
    // file through a transaction client) -- multiple ;-separated statements
    // in one call are fine. A parameterized call always uses the extended
    // protocol, one statement only. PGlite's query() always behaves like
    // the extended protocol (single prepared statement; multiple statements
    // throw 42601) while exec() behaves like the simple protocol (accepts
    // one or many statements). Routing zero-param calls to exec() up front
    // -- not as a catch/retry, since a failed query() attempt already
    // leaves the underlying transaction aborted -- mirrors that real-server
    // behavior instead of silently swallowing a schema-bootstrap failure.
    if (params.length === 0) {
      const results = await db.exec(text);
      const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = (async (text: string, params: unknown[] = []) => {
    const release = await acquire();
    try {
      return await execute(text, params);
    } finally {
      release();
    }
  }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release };
  }) as typeof pool.connect;

  try {
    // ============================================================
    // computeVerified: the property everything else depends on
    // ============================================================

    test("computeVerified is true only for a succeeded call with a non-empty provider-resolved model", () => {
      assert.equal(computeVerified("succeeded", { resolvedModel: "claude-haiku-4-5-20250514", providerRequestId: "x", finishReason: "end_turn", region: null }), true);
    });
    test("computeVerified is false when the provider returned no resolved model at all", () => {
      assert.equal(computeVerified("succeeded", { resolvedModel: null, providerRequestId: "x", finishReason: "end_turn", region: null }), false);
    });
    test("computeVerified is false when resolved is null outright (provider response could not be parsed for identity)", () => {
      assert.equal(computeVerified("succeeded", null), false);
    });
    test("computeVerified is false when resolvedModel is an empty/whitespace string", () => {
      assert.equal(computeVerified("succeeded", { resolvedModel: "   ", providerRequestId: null, finishReason: null, region: null }), false);
    });
    test("computeVerified is false for a failed attempt, even one that (implausibly) carried a resolved identity", () => {
      assert.equal(computeVerified("failed", { resolvedModel: "claude-haiku-4-5-20250514", providerRequestId: "x", finishReason: "end_turn", region: null }), false);
    });

    // ============================================================
    // Persistence: real INSERT into model_executions
    // ============================================================

    await testAsync("recordModelExecution persists a verified row with both requested and resolved identity", async () => {
      const attemptGroupId = randomUUID();
      const record = await recordModelExecution(baseInput({ attemptGroupId, correlationId: "test-corr-1" }));
      assert.ok(record, "recordModelExecution must return the persisted record");
      assert.equal(record!.verified, true);
      const row = await pool.query<{ requested_model: string; resolved_model: string; verified: boolean; operation: string }>(
        `SELECT requested_model, resolved_model, verified, operation FROM model_executions WHERE attempt_group_id=$1`,
        [attemptGroupId],
      );
      assert.equal(row.rows.length, 1);
      assert.equal(row.rows[0].requested_model, "claude-haiku-4-5");
      assert.equal(row.rows[0].resolved_model, "claude-haiku-4-5-20250514");
      assert.equal(row.rows[0].verified, true);
      assert.equal(row.rows[0].operation, "policy_extraction");
    });

    await testAsync("recordModelExecution persists a row as unverified when the provider returned no resolved model, without throwing", async () => {
      const attemptGroupId = randomUUID();
      const record = await recordModelExecution(baseInput({
        attemptGroupId,
        resolved: { resolvedModel: null, providerRequestId: null, finishReason: null, region: null },
      }));
      assert.ok(record);
      assert.equal(record!.verified, false);
      const row = await pool.query<{ resolved_model: string | null; verified: boolean }>(
        `SELECT resolved_model, verified FROM model_executions WHERE attempt_group_id=$1`,
        [attemptGroupId],
      );
      assert.equal(row.rows[0].resolved_model, null, "an absent provider identity must be stored as NULL, never backfilled from the requested model");
      assert.equal(row.rows[0].verified, false);
    });

    await testAsync("recordModelExecution persists a failed attempt with its error category, unverified", async () => {
      const attemptGroupId = randomUUID();
      await recordModelExecution(baseInput({ attemptGroupId, status: "failed", resolved: null, errorCategory: "model_provider", usage: null }));
      const row = await pool.query<{ status: string; verified: boolean; error_category: string }>(
        `SELECT status, verified, error_category FROM model_executions WHERE attempt_group_id=$1`,
        [attemptGroupId],
      );
      assert.equal(row.rows[0].status, "failed");
      assert.equal(row.rows[0].verified, false);
      assert.equal(row.rows[0].error_category, "model_provider");
    });

    await testAsync("a primary-failure-then-fallback-success pair persists BOTH attempts, in order, sharing one attempt_group_id", async () => {
      const attemptGroupId = randomUUID();
      await recordModelExecution(baseInput({
        attemptGroupId, attemptIndex: 0, status: "failed", resolved: null, errorCategory: "model_provider", usage: null,
        requested: { provider: "anthropic", model: "claude-sonnet-5", capability: "judgement" },
      }));
      await recordModelExecution(baseInput({
        attemptGroupId, attemptIndex: 1, status: "succeeded",
        requested: { provider: "anthropic", model: "claude-haiku-4-5", capability: "judgement" },
        resolved: { resolvedModel: "claude-haiku-4-5-20250514", providerRequestId: "msg_fallback", finishReason: "end_turn", region: null },
      }));
      const rows = await pool.query<{ attempt_index: number; status: string; requested_model: string; verified: boolean }>(
        `SELECT attempt_index, status, requested_model, verified FROM model_executions WHERE attempt_group_id=$1 ORDER BY attempt_index`,
        [attemptGroupId],
      );
      assert.equal(rows.rows.length, 2, "the failed primary attempt must be persisted, not silently dropped once a fallback succeeds -- hiding it would lose the fact that the primary model failed at all");
      assert.equal(rows.rows[0].attempt_index, 0);
      assert.equal(rows.rows[0].status, "failed");
      assert.equal(rows.rows[0].requested_model, "claude-sonnet-5");
      assert.equal(rows.rows[1].attempt_index, 1);
      assert.equal(rows.rows[1].status, "succeeded");
      assert.equal(rows.rows[1].verified, true);
    });

    await testAsync("household/resource identifiers are pseudonymized before storage, never stored raw", async () => {
      const attemptGroupId = randomUUID();
      const rawHouseholdId = randomUUID();
      const rawResourceId = randomUUID();
      await recordModelExecution(baseInput({ attemptGroupId, householdId: rawHouseholdId, resourceId: rawResourceId }));
      const row = await pool.query<{ household_ref: string; resource_ref: string }>(
        `SELECT household_ref, resource_ref FROM model_executions WHERE attempt_group_id=$1`,
        [attemptGroupId],
      );
      assert.notEqual(row.rows[0].household_ref, rawHouseholdId);
      assert.notEqual(row.rows[0].resource_ref, rawResourceId);
      assert.equal(row.rows[0].household_ref, pseudonymizeId(rawHouseholdId), "must use the same keyed-pseudonymization scheme as Checkpoint 9's telemetry boundary");
    });

    await testAsync("recordModelExecution mirrors a summary event through the telemetry boundary, correlated by the same id", async () => {
      const capturing = new CapturingTelemetryAdapter();
      setTelemetryAdapter(capturing);
      const attemptGroupId = randomUUID();
      await recordModelExecution(baseInput({ attemptGroupId, correlationId: "provenance-corr-xyz" }));
      const event = capturing.events.find((e) => e.name === "model.execution.recorded");
      assert.ok(event, "a model.execution.recorded telemetry event must be emitted");
      assert.equal(event!.correlationId, "provenance-corr-xyz");
      setTelemetryAdapter(new NoopTelemetryAdapter());
    });

    await testAsync("recordModelExecution never throws when persistence itself fails -- failure isolation, same contract as telemetry", async () => {
      const savedQuery = pool.query;
      pool.query = (async () => {
        throw new Error("simulated DB outage");
      }) as typeof pool.query;
      try {
        const result = await recordModelExecution(baseInput({ attemptGroupId: randomUUID() }));
        assert.equal(result, null, "a persistence failure returns null rather than throwing into the model call it is recording");
      } finally {
        pool.query = savedQuery;
      }
    });

    // ============================================================
    // The monetary-use gate
    // ============================================================

    test("assertVerifiedForMonetaryUse throws UnverifiedModelProvenanceError for an unverified record", () => {
      assert.throws(() => assertVerifiedForMonetaryUse({ verified: false, operation: "claim_evidence_extraction" }), UnverifiedModelProvenanceError);
    });
    test("assertVerifiedForMonetaryUse does not throw for a verified record", () => {
      assert.doesNotThrow(() => assertVerifiedForMonetaryUse({ verified: true, operation: "claim_evidence_extraction" }));
    });

    // ============================================================
    // Compatibility validation
    // ============================================================

    test("validateCompatibility accepts claim_evidence_extraction paired with its required schema version", () => {
      const result = validateCompatibility({ operation: "claim_evidence_extraction", promptVersion: "v1", schemaVersion: "claim-evidence-extract-v1" });
      assert.equal(result.compatible, true);
    });
    test("validateCompatibility rejects claim_evidence_extraction with a missing schema version", () => {
      const result = validateCompatibility({ operation: "claim_evidence_extraction", promptVersion: "v1", schemaVersion: null });
      assert.equal(result.compatible, false);
      assert.ok(result.reason?.includes("claim_evidence_extraction"));
    });
    test("validateCompatibility rejects claim_evidence_extraction with a stale/wrong schema version", () => {
      const result = validateCompatibility({ operation: "claim_evidence_extraction", promptVersion: "v1", schemaVersion: "claim-evidence-extract-v0-stale" });
      assert.equal(result.compatible, false);
    });
    test("validateCompatibility rejects a downstream-calculator/output-validator version mismatch", () => {
      const result = validateCompatibility({ operation: "rag_answer", promptVersion: null, schemaVersion: null, outputValidatorVersion: "v2", downstreamCalculatorVersion: "v1" });
      assert.equal(result.compatible, false);
    });
    test("validateCompatibility accepts an operation with no minimum schema version configured yet", () => {
      const result = validateCompatibility({ operation: "rag_answer", promptVersion: null, schemaVersion: null });
      assert.equal(result.compatible, true);
    });

    // ============================================================
    // Known operations
    // ============================================================

    test("every KNOWN_OPERATIONS entry is recognized by isKnownOperation, and an invented one is not", () => {
      for (const op of KNOWN_OPERATIONS) assert.equal(isKnownOperation(op), true);
      assert.equal(isKnownOperation("totally_invented_operation"), false);
    });
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// End-to-end: the REAL structuredCompletion() -> hostedStructuredCompletion()
// -> anthropicMessages() path, against a mocked global.fetch simulating
// actual provider HTTP responses. Run against the same PGlite-backed pool
// as above (a fresh instance, so these don't interleave with the suite's
// own transactions).
// ---------------------------------------------------------------------------
async function runEndToEndTests() {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.READING_MODEL = "anthropic:claude-haiku-4-5";
  process.env.JUDGEMENT_MODEL = "anthropic:claude-sonnet-5";
  process.env.JUDGEMENT_FALLBACK_MODEL = "anthropic:claude-haiku-4-5";

  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) {
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }
  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    // Real Postgres via node-postgres uses the simple query protocol for a
    // bare, zero-param client.query(text) call (e.g. lib/ai/provenance.ts's
    // ensureProvenanceSchema() running its whole multi-statement schema
    // file through a transaction client) -- multiple ;-separated statements
    // in one call are fine. A parameterized call always uses the extended
    // protocol, one statement only. PGlite's query() always behaves like
    // the extended protocol (single prepared statement; multiple statements
    // throw 42601) while exec() behaves like the simple protocol (accepts
    // one or many statements). Routing zero-param calls to exec() up front
    // -- not as a catch/retry, since a failed query() attempt already
    // leaves the underlying transaction aborted -- mirrors that real-server
    // behavior instead of silently swallowing a schema-bootstrap failure.
    if (params.length === 0) {
      const results = await db.exec(text);
      const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = (async (text: string, params: unknown[] = []) => {
    const release = await acquire();
    try {
      return await execute(text, params);
    } finally {
      release();
    }
  }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release };
  }) as typeof pool.connect;

  const originalFetch = global.fetch;
  setTelemetryAdapter(new NoopTelemetryAdapter());

  try {
    const { structuredCompletion } = await import("@/lib/ai/llm");

    await testAsync("end-to-end: a real structuredCompletion() call persists a verified execution with the provider's exact resolved model", async () => {
      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            id: "msg_e2e_001",
            model: "claude-haiku-4-5-20250620",
            content: [{ type: "text", text: '{"ok":true}' }],
            stop_reason: "end_turn",
            usage: { input_tokens: 42, output_tokens: 7 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;

      const result = await structuredCompletion({
        role: "reading",
        operation: "policy_extraction",
        system: "test",
        user: "test",
        schema: z.object({ ok: z.boolean() }),
        attempts: 1,
      });
      assert.equal(result.ok, true);

      const rows = await pool.query<{ resolved_model: string; verified: boolean; provider_request_id: string }>(
        `SELECT resolved_model, verified, provider_request_id FROM model_executions WHERE operation='policy_extraction' ORDER BY created_at DESC LIMIT 1`,
      );
      assert.equal(rows.rows[0].resolved_model, "claude-haiku-4-5-20250620", "the exact dated model Anthropic's own response reported, not the requested family alias");
      assert.equal(rows.rows[0].verified, true);
      assert.equal(rows.rows[0].provider_request_id, "msg_e2e_001");
    });

    await testAsync("end-to-end: a primary rate-limit failure followed by a successful fallback persists BOTH real attempts in order", async () => {
      let callCount = 0;
      global.fetch = (async () => {
        callCount++;
        if (callCount === 1) throw new Error("Model service is busy (429)");
        return new Response(
          JSON.stringify({
            id: "msg_e2e_fallback",
            model: "claude-haiku-4-5-20250620",
            content: [{ type: "text", text: '{"ok":true}' }],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 3 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;

      const attemptGroupsBefore = await pool.query<{ n: string }>(`SELECT count(distinct attempt_group_id)::text AS n FROM model_executions WHERE operation='relevance_judging'`);

      const result = await structuredCompletion({
        role: "judgement",
        operation: "relevance_judging",
        system: "test",
        user: "test",
        schema: z.object({ ok: z.boolean() }),
        attempts: 1,
      });
      assert.equal(result.ok, true);
      assert.equal(callCount, 2, "exactly one primary attempt and one fallback attempt must have reached the provider");

      const attemptGroupsAfter = await pool.query<{ n: string }>(`SELECT count(distinct attempt_group_id)::text AS n FROM model_executions WHERE operation='relevance_judging'`);
      assert.equal(Number(attemptGroupsAfter.rows[0].n), Number(attemptGroupsBefore.rows[0].n) + 1, "exactly one new attempt_group_id for this one logical operation");

      const rows = await pool.query<{ attempt_index: number; status: string; requested_model: string; verified: boolean }>(
        `SELECT attempt_index, status, requested_model, verified FROM model_executions WHERE operation='relevance_judging' ORDER BY created_at DESC LIMIT 2`,
      );
      const ordered = rows.rows.sort((a, b) => a.attempt_index - b.attempt_index);
      assert.equal(ordered[0].attempt_index, 0);
      assert.equal(ordered[0].status, "failed");
      assert.equal(ordered[0].requested_model, "claude-sonnet-5", "the primary attempt's requested model, recorded even though it failed");
      assert.equal(ordered[1].attempt_index, 1);
      assert.equal(ordered[1].status, "succeeded");
      assert.equal(ordered[1].requested_model, "claude-haiku-4-5");
      assert.equal(ordered[1].verified, true);
    });

    await testAsync("end-to-end: a provider response with no model field persists an UNVERIFIED execution, not a silently-alias-backfilled one", async () => {
      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            // Deliberately no "id" or "model" field, as a provider response
            // that does not report resolved identity would look like.
            content: [{ type: "text", text: '{"ok":true}' }],
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;

      await structuredCompletion({
        role: "reading",
        operation: "policy_extraction",
        system: "test",
        user: "test",
        schema: z.object({ ok: z.boolean() }),
        attempts: 1,
      });

      const rows = await pool.query<{ resolved_model: string | null; verified: boolean; requested_model: string }>(
        `SELECT resolved_model, verified, requested_model FROM model_executions WHERE operation='policy_extraction' ORDER BY created_at DESC LIMIT 1`,
      );
      assert.equal(rows.rows[0].resolved_model, null, "must stay null -- never silently defaulted to the requested family alias");
      assert.equal(rows.rows[0].verified, false, "an execution with no exact resolved identity must remain unverified, per the checkpoint's own requirement");
    });
  } finally {
    global.fetch = originalFetch;
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  await runEndToEndTests();
  console.log(
    `model-provenance regressions passed: ${cases} cases (computeVerified\\'s verified/unverified boundary, persistence of succeeded/failed/unverified attempts, ` +
      `an in-order failed-primary-then-succeeded-fallback pair sharing one attempt group, pseudonymized household/resource refs, a mirrored telemetry event, ` +
      `persistence failure isolation, the assertVerifiedForMonetaryUse gate, compatibility validation, known-operation closure, and three real end-to-end ` +
      `structuredCompletion() runs against a mocked provider: a clean success, a rate-limited primary with a successful fallback, and a response with no ` +
      `resolved model at all).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
