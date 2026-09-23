/**
 * Checkpoint 11 (claude/v1-launch-hardening): stale-data invalidation.
 *
 * A record produced by a governed AI operation (Checkpoint 10's
 * model_executions row, or by extension any derived business record that
 * carries the schema_version it was produced under) can be VERIFIED --
 * Checkpoint 10's own gate, a confirmed resolved model identity -- and
 * still be STALE: produced under a prompt/schema contract this codebase no
 * longer considers current, even though it was accepted as compatible (or
 * had no compatibility check at all) at the time it ran.
 *
 * This is deliberately a distinct table from lib/ai/provenance.ts's
 * MINIMUM_SCHEMA_VERSION. That one answers "is this old version still even
 * ACCEPTABLE to persist as compatible right now" (a floor, with a
 * deliberate grace period while callers migrate). This one answers "is this
 * the CURRENT version" (a target) -- a record can be above the minimum and
 * still be stale relative to current, which is exactly the population a
 * controlled rollout needs to identify and re-process once a new prompt/
 * schema version has been validated and promoted.
 */
import type { KnownOperation } from "./provenance";

const CURRENT_SCHEMA_VERSION: Partial<Record<KnownOperation, string>> = {
  claim_evidence_extraction: "claim-evidence-extract-v1",
};

export type StalenessCheckInput = {
  operation: KnownOperation;
  schemaVersion: string | null;
  verified: boolean;
};

export type StalenessResult = { stale: true; reason: string } | { stale: false; reason?: undefined };

/** The one place "is this record still good enough to rely on" is decided.
 * An UNVERIFIED record is stale unconditionally, independent of schema
 * version -- there is nothing to compare a schema version against if the
 * call that produced it cannot even be confirmed to have executed as
 * claimed (Checkpoint 10's assertVerifiedForMonetaryUse() already refuses
 * an unverified record outright; this function must never disagree with
 * that refusal by calling an unverified record merely "not current"). An
 * operation with no CURRENT_SCHEMA_VERSION entry does not yet participate
 * in version-staleness tracking -- never stale on that ground, never
 * "trust it forever without ever checking" either, since the verified gate
 * above still applies to it. */
export function checkStaleness(input: StalenessCheckInput): StalenessResult {
  if (!input.verified) {
    return { stale: true, reason: "not verified -- no confirmed resolved model identity for this record" };
  }
  const current = CURRENT_SCHEMA_VERSION[input.operation];
  if (!current) return { stale: false };
  if (input.schemaVersion !== current) {
    return {
      stale: true,
      reason: `schema_version ${input.schemaVersion ? `"${input.schemaVersion}"` : "(none)"} is not the current "${current}" for "${input.operation}"`,
    };
  }
  return { stale: false };
}

export function currentSchemaVersionFor(operation: KnownOperation): string | null {
  return CURRENT_SCHEMA_VERSION[operation] ?? null;
}

/** Reads recent model_executions rows for operations that participate in
 * version-staleness tracking and classifies each with checkStaleness(),
 * returning counts grouped by operation + schema_version -- an operational
 * worklist ("X verified-but-stale claim_evidence_extraction executions in
 * the last 24h need re-processing"), not a record-level invalidation queue:
 * model_executions' household_ref/resource_ref are pseudonymized
 * (Checkpoint 9's keyed HMAC), by design, and cannot be reversed back to a
 * real policy_benefits/claim_evidence row from here. Actually invalidating
 * a specific real record has to happen at a call site that still holds the
 * real id alongside the schema_version it used -- this function tells an
 * operator how much of that work exists, not which exact rows they are. */
export async function staleExecutionSummary(
  sinceHours = 24,
): Promise<{ operation: string; schemaVersion: string | null; verified: boolean; staleCount: number; reason: string }[]> {
  const { query } = await import("@/lib/db/client");
  const trackedOperations = Object.keys(CURRENT_SCHEMA_VERSION);
  if (trackedOperations.length === 0) return [];
  const rows = await query<{ operation: string; schema_version: string | null; verified: boolean; row_count: string }>(
    `SELECT operation, schema_version, verified, count(*) AS row_count
       FROM model_executions
      WHERE created_at >= now() - ($1 || ' hours')::interval
        AND operation = ANY($2::text[])
      GROUP BY operation, schema_version, verified`,
    [String(sinceHours), trackedOperations],
  );
  const summary: { operation: string; schemaVersion: string | null; verified: boolean; staleCount: number; reason: string }[] = [];
  for (const row of rows.rows) {
    const operation = row.operation as KnownOperation;
    const result = checkStaleness({ operation, schemaVersion: row.schema_version, verified: row.verified });
    if (result.stale) {
      summary.push({
        operation: row.operation,
        schemaVersion: row.schema_version,
        verified: row.verified,
        staleCount: Number(row.row_count),
        reason: result.reason,
      });
    }
  }
  return summary;
}
