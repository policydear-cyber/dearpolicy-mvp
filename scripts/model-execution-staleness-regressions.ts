/**
 * Regression suite for lib/ai/staleness-alert.ts / lib/jobs/model-
 * execution-staleness-processor.ts (checkpoint 14i, claude/v1-launch-
 * hardening) -- the real caller model_prompt_schema_governance requires
 * for lib/ai/staleness.ts's staleExecutionSummary() worklist.
 *
 * Deliberately does NOT spin up PGlite (this branch's other suites
 * already document PGlite's own ~300-400MB RSS floor as a genuine
 * sandbox memory risk) -- staleExecutionSummary()'s only DB dependency is
 * one SELECT through lib/db/client's exported `pool.query`, which this
 * suite fakes directly with a fixture function, exactly like scripts/
 * claim-workflow-regressions.ts's own pool.query fixture-mock convention
 * (a real PGlite-backed suite for the *storage/persistence* side of this
 * exact operation already exists in scripts/model-provenance-
 * regressions.ts; this suite is about the ALERT/wiring behavior on top
 * of whatever staleExecutionSummary() returns, not about proving
 * Postgres GROUP BY semantics again).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter, getTelemetryAdapter } from "@/lib/telemetry";
import { CapturingTelemetryAdapter } from "@/lib/telemetry/adapters";
import { runModelExecutionStalenessAudit } from "@/lib/ai/staleness-alert";
import { MODEL_EXECUTION_STALENESS_AUDIT_JOB_TYPE, processModelExecutionStalenessAuditJob } from "@/lib/jobs/model-execution-staleness-processor";
import type { BackgroundJobRow } from "@/lib/jobs/queue";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    console.error(`FAILED: ${name}`);
    throw error;
  }
}

type FixtureRow = { operation: string; schema_version: string | null; verified: boolean; row_count: string };

function withFixtureRows(rows: FixtureRow[], capturedParams: { last?: unknown[] }) {
  const originalQuery = pool.query;
  (pool as unknown as { query: typeof pool.query }).query = (async (sql: string, params?: unknown[]) => {
    // lib/db/client's query() runs ensureDevAccountRow() once per process
    // whenever DATABASE_URL is set (CI sets it). That bootstrap INSERT is not
    // part of the staleness audit under test, so it is acknowledged as a
    // no-op here; every other unexpected statement still fails loudly.
    if (/^INSERT INTO accounts\(id, name\) VALUES \(\$1, 'Household'\) ON CONFLICT \(id\) DO NOTHING$/.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    capturedParams.last = params;
    if (/FROM model_executions/.test(sql)) return { rows, rowCount: rows.length };
    throw new Error(`Unexpected fixture SQL in model-execution-staleness-regressions: ${sql}`);
  }) as typeof pool.query;
  return () => {
    (pool as unknown as { query: typeof pool.query }).query = originalQuery;
  };
}

function fakeJob(payload: unknown): BackgroundJobRow {
  return {
    id: "job-1",
    account_id: null,
    job_type: MODEL_EXECUTION_STALENESS_AUDIT_JOB_TYPE,
    idempotency_key: "test",
    correlation_id: null,
    payload,
    status: "processing",
    attempt_count: 1,
    max_attempts: 5,
    available_at: new Date(),
    lease_owner: "test-worker",
    lease_expires_at: new Date(Date.now() + 60_000),
    last_heartbeat_at: null,
    last_error_message: null,
    last_error_category: null,
    cancel_requested: false,
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
  };
}

async function main() {
  await testAsync("runModelExecutionStalenessAudit returns an empty worklist and records a success event when nothing is stale", async () => {
    const restore = withFixtureRows(
      [{ operation: "claim_evidence_extraction", schema_version: "claim-evidence-extract-v1", verified: true, row_count: "7" }],
      {},
    );
    const previousAdapter = getTelemetryAdapter();
    const capturing = new CapturingTelemetryAdapter();
    setTelemetryAdapter(capturing);
    try {
      const summary = await runModelExecutionStalenessAudit(24);
      assert.deepEqual(summary, []);
      const events = capturing.events.filter((e) => e.name === "ai.model_execution.staleness_audit_executed");
      assert.equal(events.length, 1);
      assert.equal(events[0].status, "success");
      assert.equal((events[0].extra as { totalStaleExecutions: number }).totalStaleExecutions, 0);
    } finally {
      setTelemetryAdapter(previousAdapter);
      restore();
    }
  });

  await testAsync("runModelExecutionStalenessAudit surfaces both unverified and schema-stale groups, and records a failure event with real counts", async () => {
    const restore = withFixtureRows(
      [
        { operation: "claim_evidence_extraction", schema_version: "claim-evidence-extract-v1", verified: true, row_count: "5" },
        { operation: "claim_evidence_extraction", schema_version: "claim-evidence-extract-v0", verified: true, row_count: "3" },
        { operation: "claim_evidence_extraction", schema_version: null, verified: false, row_count: "2" },
      ],
      {},
    );
    const previousAdapter = getTelemetryAdapter();
    const capturing = new CapturingTelemetryAdapter();
    setTelemetryAdapter(capturing);
    try {
      const summary = await runModelExecutionStalenessAudit(24);
      assert.equal(summary.length, 2, "the current-schema/verified group must be excluded; the other two must both be reported");
      assert.ok(summary.some((row) => row.verified === true && row.staleCount === 3));
      assert.ok(summary.some((row) => row.verified === false && row.staleCount === 2));
      const events = capturing.events.filter((e) => e.name === "ai.model_execution.staleness_audit_executed");
      assert.equal(events.length, 1);
      assert.equal(events[0].status, "failure");
      assert.equal(events[0].errorCategory, "model_provider");
      assert.equal((events[0].extra as { totalStaleExecutions: number }).totalStaleExecutions, 5);
      assert.equal((events[0].extra as { staleGroupCount: number }).staleGroupCount, 2);
    } finally {
      setTelemetryAdapter(previousAdapter);
      restore();
    }
  });

  await testAsync("processModelExecutionStalenessAuditJob honors an explicit sinceHours from the job payload", async () => {
    const captured: { last?: unknown[] } = {};
    const restore = withFixtureRows([], captured);
    const previousAdapter = getTelemetryAdapter();
    setTelemetryAdapter(new CapturingTelemetryAdapter());
    try {
      await processModelExecutionStalenessAuditJob(fakeJob({ sinceHours: 72 }));
      assert.equal(captured.last?.[0], "72", "the processor must pass the job payload's sinceHours through to the real query, not a hardcoded default");
    } finally {
      setTelemetryAdapter(previousAdapter);
      restore();
    }
  });

  await testAsync("processModelExecutionStalenessAuditJob defaults to 24 hours when the payload omits sinceHours", async () => {
    const captured: { last?: unknown[] } = {};
    const restore = withFixtureRows([], captured);
    const previousAdapter = getTelemetryAdapter();
    setTelemetryAdapter(new CapturingTelemetryAdapter());
    try {
      await processModelExecutionStalenessAuditJob(fakeJob({}));
      assert.equal(captured.last?.[0], "24");
    } finally {
      setTelemetryAdapter(previousAdapter);
      restore();
    }
  });

  await testAsync("model_execution_staleness_audit is really registered in PRODUCTION_JOB_TYPES with the real processor (source-checked, no heavy processors.ts import)", async () => {
    const processorsSource = await readFile("lib/jobs/processors.ts", "utf8");
    const codeOnly = processorsSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.match(
      codeOnly,
      /\{\s*jobType:\s*MODEL_EXECUTION_STALENESS_AUDIT_JOB_TYPE,\s*process:\s*processModelExecutionStalenessAuditJob\s*\}/,
      "model_execution_staleness_audit must be registered in PRODUCTION_JOB_TYPES with the real processor so scripts/worker.ts actually runs it",
    );
  });

  console.log(`Model-execution-staleness regressions passed (${cases} cases).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
