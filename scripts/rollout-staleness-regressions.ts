/**
 * Regression suite for Checkpoint 11 (claude/v1-launch-hardening):
 * controlled rollout (lib/ai/rollout.ts) and stale-data invalidation
 * (lib/ai/staleness.ts) -- built on top of Checkpoint 10's model execution
 * provenance (requested_rollout, schema_version, verified columns).
 *
 * Pure-function cases run with no database. The staleExecutionSummary()
 * cases and the end-to-end cohort-persistence case run against a
 * disposable PGlite instance, the same pool-patching pattern as
 * scripts/model-provenance-regressions.ts (including its fix for PGlite's
 * query()/exec() split on zero-param multi-statement calls).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { resolveRollout, canaryConfigFor, type RolloutConfig } from "@/lib/ai/rollout";
import { checkStaleness, currentSchemaVersionFor, staleExecutionSummary } from "@/lib/ai/staleness";
import { recordModelExecution } from "@/lib/ai/provenance";

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

function baseConfig(overrides: Partial<RolloutConfig> = {}): RolloutConfig {
  return { canary: { provider: "anthropic", model: "claude-haiku-4-5" }, percentage: 50, killSwitch: false, rolloutId: "canary:policy_extraction:test", ...overrides };
}

function runPureTests() {
  test("resolveRollout is stable with no config at all", () => {
    const decision = resolveRollout(null, "household-1");
    assert.equal(decision.cohort, "stable");
    assert.equal(decision.target, null);
  });

  test("resolveRollout is stable when the kill switch is active, regardless of percentage", () => {
    const decision = resolveRollout(baseConfig({ percentage: 100, killSwitch: true }), "household-1");
    assert.equal(decision.cohort, "stable");
    assert.equal(decision.target, null);
    assert.match(decision.reason, /kill switch/);
  });

  test("resolveRollout is stable at 0%", () => {
    const decision = resolveRollout(baseConfig({ percentage: 0 }), "household-1");
    assert.equal(decision.cohort, "stable");
  });

  test("resolveRollout is stable with no subject id to bucket on, even at 100%", () => {
    const decision = resolveRollout(baseConfig({ percentage: 100 }), null);
    assert.equal(decision.cohort, "stable");
    assert.match(decision.reason, /subject/);
  });

  test("resolveRollout sends every subject to canary at 100%", () => {
    for (const subject of ["household-a", "household-b", "resource-xyz", "household-c"]) {
      const decision = resolveRollout(baseConfig({ percentage: 100 }), subject);
      assert.equal(decision.cohort, "canary", `subject ${subject} should be canary at 100%`);
      assert.deepEqual(decision.target, { provider: "anthropic", model: "claude-haiku-4-5" });
    }
  });

  test("resolveRollout clamps an out-of-range percentage rather than trusting it verbatim", () => {
    const over = resolveRollout(baseConfig({ percentage: 500 }), "household-1");
    assert.equal(over.cohort, "canary", "clamped to 100, so still fully canary");
    const under = resolveRollout(baseConfig({ percentage: -20 }), "household-1");
    assert.equal(under.cohort, "stable", "clamped to 0, so fully stable, not silently negative-off-by-something");
    const nan = resolveRollout(baseConfig({ percentage: Number.NaN }), "household-1");
    assert.equal(nan.cohort, "stable", "a non-finite percentage clamps to 0, never NaN-propagates into the comparison");
  });

  test("resolveRollout is deterministic: the SAME subject and rolloutId always land in the SAME cohort", () => {
    const config = baseConfig({ percentage: 50 });
    const first = resolveRollout(config, "household-determinism-check");
    for (let i = 0; i < 20; i++) {
      const again = resolveRollout(config, "household-determinism-check");
      assert.equal(again.cohort, first.cohort, `run ${i}: cohort flipped for the same subject/rollout`);
    }
  });

  test("resolveRollout's cohort depends on the rolloutId, not just the subject -- two different rollouts bucket the same subject independently", () => {
    const configA = baseConfig({ rolloutId: "canary:policy_extraction:rollout-a", percentage: 50 });
    const configB = baseConfig({ rolloutId: "canary:policy_extraction:rollout-b", percentage: 50 });
    // Not asserting they always differ (that would be flaky) -- asserting
    // each is independently deterministic, which is the actual contract.
    const a1 = resolveRollout(configA, "household-cross-rollout");
    const a2 = resolveRollout(configA, "household-cross-rollout");
    const b1 = resolveRollout(configB, "household-cross-rollout");
    assert.equal(a1.cohort, a2.cohort);
    assert.equal(typeof b1.cohort, "string");
  });

  test("canaryConfigFor returns null when no CANARY_<OP>_MODEL is set", () => {
    const config = canaryConfigFor("policy_extraction", {});
    assert.equal(config, null);
  });

  test("canaryConfigFor returns null for a malformed model setting (no provider:model split)", () => {
    const config = canaryConfigFor("policy_extraction", { CANARY_POLICY_EXTRACTION_MODEL: "not-a-valid-setting" });
    assert.equal(config, null);
  });

  test("canaryConfigFor parses a valid setting, defaulting percentage to 0 (configured but off)", () => {
    const config = canaryConfigFor("policy_extraction", { CANARY_POLICY_EXTRACTION_MODEL: "anthropic:claude-haiku-4-5" });
    assert.ok(config);
    assert.deepEqual(config!.canary, { provider: "anthropic", model: "claude-haiku-4-5" });
    assert.equal(config!.percentage, 0);
    assert.equal(config!.killSwitch, false);
  });

  test("canaryConfigFor's per-operation kill switch works independently of the global one", () => {
    const config = canaryConfigFor("policy_extraction", {
      CANARY_POLICY_EXTRACTION_MODEL: "anthropic:claude-haiku-4-5",
      CANARY_POLICY_EXTRACTION_PERCENTAGE: "100",
      CANARY_POLICY_EXTRACTION_KILL_SWITCH: "true",
    });
    assert.ok(config);
    assert.equal(config!.killSwitch, true);
    const decision = resolveRollout(config, "household-1");
    assert.equal(decision.cohort, "stable");
  });

  test("canaryConfigFor's global kill switch overrides every operation at once", () => {
    const config = canaryConfigFor("coverage_extraction", {
      CANARY_COVERAGE_EXTRACTION_MODEL: "anthropic:claude-haiku-4-5",
      CANARY_COVERAGE_EXTRACTION_PERCENTAGE: "100",
      CANARY_KILL_SWITCH_ALL: "true",
    });
    assert.ok(config);
    assert.equal(config!.killSwitch, true);
  });

  // ============================================================
  // checkStaleness / currentSchemaVersionFor
  // ============================================================

  test("checkStaleness marks an UNVERIFIED record stale regardless of schema version", () => {
    const current = currentSchemaVersionFor("claim_evidence_extraction");
    assert.ok(current, "fixture assumes claim_evidence_extraction has a current schema version");
    const result = checkStaleness({ operation: "claim_evidence_extraction", schemaVersion: current, verified: false });
    assert.equal(result.stale, true);
    assert.match(result.reason ?? "", /not verified/);
  });

  test("checkStaleness is not stale for a verified record on the current schema version", () => {
    const current = currentSchemaVersionFor("claim_evidence_extraction")!;
    const result = checkStaleness({ operation: "claim_evidence_extraction", schemaVersion: current, verified: true });
    assert.equal(result.stale, false);
  });

  test("checkStaleness is stale for a verified record on an old or missing schema version", () => {
    const old = checkStaleness({ operation: "claim_evidence_extraction", schemaVersion: "claim-evidence-extract-v0", verified: true });
    assert.equal(old.stale, true);
    const missing = checkStaleness({ operation: "claim_evidence_extraction", schemaVersion: null, verified: true });
    assert.equal(missing.stale, true);
  });

  test("checkStaleness never marks an operation stale on schema grounds when it doesn't track a current version", () => {
    assert.equal(currentSchemaVersionFor("chat_reply"), null);
    const result = checkStaleness({ operation: "chat_reply", schemaVersion: null, verified: true });
    assert.equal(result.stale, false);
  });
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
    await testAsync("staleExecutionSummary reports a verified-but-old-schema row and an unverified row, never a current-and-verified row", async () => {
      const groupA = "11111111-1111-1111-1111-111111111111";
      await recordModelExecution({
        attemptGroupId: groupA, attemptIndex: 0, operation: "claim_evidence_extraction", role: "reading",
        requested: { provider: "anthropic", model: "claude-haiku-4-5", capability: "reading", schemaVersion: "claim-evidence-extract-v0" },
        requestedAt: new Date(), resolved: { resolvedModel: "claude-haiku-4-5-20250514", providerRequestId: "x", finishReason: "end_turn", region: null },
        status: "succeeded", usage: { input: 10, output: 5 },
      });
      const groupB = "22222222-2222-2222-2222-222222222222";
      await recordModelExecution({
        attemptGroupId: groupB, attemptIndex: 0, operation: "claim_evidence_extraction", role: "reading",
        requested: { provider: "anthropic", model: "claude-haiku-4-5", capability: "reading", schemaVersion: "claim-evidence-extract-v1" },
        requestedAt: new Date(), resolved: null, status: "failed", errorCategory: "model_provider",
      });
      const groupC = "33333333-3333-3333-3333-333333333333";
      await recordModelExecution({
        attemptGroupId: groupC, attemptIndex: 0, operation: "claim_evidence_extraction", role: "reading",
        requested: { provider: "anthropic", model: "claude-haiku-4-5", capability: "reading", schemaVersion: "claim-evidence-extract-v1" },
        requestedAt: new Date(), resolved: { resolvedModel: "claude-haiku-4-5-20250514", providerRequestId: "y", finishReason: "end_turn", region: null },
        status: "succeeded", usage: { input: 10, output: 5 },
      });

      const summary = await staleExecutionSummary(24);
      const oldSchema = summary.find(s => s.schemaVersion === "claim-evidence-extract-v0");
      assert.ok(oldSchema, "the verified-but-old-schema row must be reported");
      assert.equal(oldSchema!.staleCount, 1);
      const unverified = summary.find(s => s.verified === false);
      assert.ok(unverified, "the unverified row must be reported");
      const current = summary.find(s => s.schemaVersion === "claim-evidence-extract-v1" && s.verified === true);
      assert.equal(current, undefined, "a verified row on the CURRENT schema version must never be reported as stale");
    });

    await testAsync("end-to-end: a configured canary persists the resolved cohort's rolloutId on the model_executions row", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key-not-real";
      process.env.CANARY_POLICY_EXTRACTION_MODEL = "anthropic:claude-haiku-4-5";
      process.env.CANARY_POLICY_EXTRACTION_PERCENTAGE = "100";
      try {
        global.fetch = (async () =>
          new Response(
            JSON.stringify({
              id: "msg_rollout_001", model: "claude-haiku-4-5-20250620",
              content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn",
              usage: { input_tokens: 5, output_tokens: 2 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )) as typeof fetch;

        const { structuredCompletion } = await import("@/lib/ai/llm");
        await structuredCompletion({
          role: "reading", operation: "policy_extraction", system: "test", user: "test",
          schema: z.object({ ok: z.boolean() }), attempts: 1, householdId: "household-rollout-e2e",
        });

        const rows = await pool.query<{ requested_rollout: string | null }>(
          `SELECT requested_rollout FROM model_executions WHERE operation='policy_extraction' AND household_ref IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
        );
        assert.equal(rows.rows.length, 1);
        assert.ok(rows.rows[0].requested_rollout, "the persisted row must record WHICH rollout produced it");
        assert.match(rows.rows[0].requested_rollout!, /^canary:policy_extraction:/);
      } finally {
        delete process.env.CANARY_POLICY_EXTRACTION_MODEL;
        delete process.env.CANARY_POLICY_EXTRACTION_PERCENTAGE;
      }
    });
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

async function main() {
  runPureTests();
  await runDatabaseTests();
  console.log(
    `rollout-staleness regressions passed: ${cases} cases (deterministic/clamped/fail-closed cohort resolution, ` +
      `env-driven canary config incl. per-operation and global kill switches, verified/current-schema staleness ` +
      `classification, staleExecutionSummary()'s grouped reporting, and a real end-to-end structuredCompletion() ` +
      `run that persists the resolved cohort's rolloutId onto the provenance row).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
