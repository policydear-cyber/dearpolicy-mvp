import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool, query } from "@/lib/db/client";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimFacts } from "../types";
import type { ClaimCompositionResult } from "./types";

/** Lazily applies sql/claim-composition.sql, exactly the pattern used by
 * lib/claims/evidence/schema.ts (ensureClaimEvidenceSchema) and every other
 * lazy-migration module in this codebase: idempotent (CREATE ... IF NOT
 * EXISTS throughout), serialised across concurrent requests/processes with
 * an advisory lock so two warm instances racing to migrate at once cannot
 * conflict, and memoised on globalThis so it only actually runs once per
 * warm process. */
type ClaimCompositionGlobals = typeof globalThis & { __dearpolicyClaimCompositionSchema?: Promise<void> };

export async function ensureClaimCompositionSchema() {
  const state = globalThis as ClaimCompositionGlobals;
  state.__dearpolicyClaimCompositionSchema ??= (async () => {
    const sql = await readFile(path.join(process.cwd(), "sql/claim-composition.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // A lock number distinct from every other lazy migration in this
      // codebase (chat: 73499201, benefit-catalog: 73499202, ledger and
      // cover-conditions: 73499203, claim-evidence: 73499204).
      await client.query("SELECT pg_advisory_xact_lock(73499205)");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    delete state.__dearpolicyClaimCompositionSchema;
    throw error;
  });
  await state.__dearpolicyClaimCompositionSchema;
}

/** Persists an immutable audit snapshot of one composeClaim() result --
 * never called with anything other than a genuine composeClaim() output
 * (see lib/claims/orchestrator.ts, the only caller). Idempotent:
 * composeClaim()'s own `calculationId` already encodes every material
 * input (engine version, claim/family ids, and every benefit's own
 * calculation id, composition type, group, status, payable amount,
 * currency, blocked-reason codes and cap references -- see engine.ts), so
 * re-recording the same calculation because the user repeated a turn, or a
 * retried request, is a safe no-op via ON CONFLICT DO NOTHING rather than a
 * duplicate audit row for what is actually the same calculation. A
 * genuinely new calculation (any material input changed) always gets its
 * own row, since it hashes to a different calculationId. */
export async function recordCompositionSnapshot(args: {
  accountId: string; familyMemberId: string; claimSessionId: string;
  facts: ClaimFacts; coverages: OwnedCoverage[]; result: ClaimCompositionResult;
}): Promise<void> {
  await ensureClaimCompositionSchema();
  const coverageVersions = args.coverages.map((c) => ({
    policyId: c.policyId, coverageId: c.id, effectiveDate: c.effectiveDate, renewalOrExpiryDate: c.renewalOrExpiryDate,
  }));
  await query(
    `INSERT INTO claim_composition_snapshots(account_id,family_member_id,claim_session_id,calculation_id,engine_version,facts_snapshot,coverage_versions,result,calculated_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)
     ON CONFLICT (account_id,claim_session_id,calculation_id) DO NOTHING`,
    [
      args.accountId, args.familyMemberId, args.claimSessionId, args.result.calculationId, args.result.engineVersion,
      JSON.stringify(args.facts), JSON.stringify(coverageVersions), JSON.stringify(args.result), args.result.calculatedAt,
    ],
  );
}

const SNAPSHOT_COLUMNS = `id::text,account_id,family_member_id,claim_session_id,calculation_id,engine_version,facts_snapshot,coverage_versions,result,calculated_at::text,created_at::text`;

export type ClaimCompositionSnapshotRow = {
  id: string; account_id: string; family_member_id: string; claim_session_id: string; calculation_id: string;
  engine_version: string; facts_snapshot: unknown; coverage_versions: unknown; result: ClaimCompositionResult;
  calculated_at: string; created_at: string;
};

/** The most recently recorded snapshot for a claim session -- used to show
 * a stable "as calculated at" view even if the live composeClaim() result
 * would differ because underlying facts changed again since. */
export async function getLatestCompositionSnapshot(accountId: string, claimSessionId: string): Promise<ClaimCompositionSnapshotRow | null> {
  await ensureClaimCompositionSchema();
  const result = await query<ClaimCompositionSnapshotRow>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM claim_composition_snapshots WHERE account_id=$1 AND claim_session_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [accountId, claimSessionId],
  );
  return result.rows[0] ?? null;
}

/** Every snapshot ever recorded for a claim session, oldest first -- the
 * full audit trail of how the calculated total changed (or didn't) turn by
 * turn as facts and evidence were added. */
export async function listCompositionSnapshots(accountId: string, claimSessionId: string): Promise<{ id: string; calculation_id: string; created_at: string }[]> {
  await ensureClaimCompositionSchema();
  const result = await query<{ id: string; calculation_id: string; created_at: string }>(
    `SELECT id::text,calculation_id,created_at::text FROM claim_composition_snapshots WHERE account_id=$1 AND claim_session_id=$2 ORDER BY created_at ASC`,
    [accountId, claimSessionId],
  );
  return result.rows;
}
