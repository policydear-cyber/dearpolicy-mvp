/**
 * Deleting a document also removes what claim calculations took from it (privacy).
 *
 * Every claim calculation is kept as an audit snapshot (claim_composition_snapshots, written by
 * lib/claims/composition/store.ts). A snapshot holds the full calculation: per-policy sections with amounts, caps,
 * plan names, quotes and page references, plus the coverage versions it used. When a document it used is deleted,
 * that content stayed behind, although the claim itself is already invalidated (lib/lifecycle/coordinator.ts).
 *
 * scrubDeletedDocumentClaimSnapshots() handles every snapshot that refers to a deleted document of its own household,
 * for any household:
 *   - its result becomes { redacted: { reason: "policy_deleted" }, calculationId, engineVersion }: which calculation it
 *     was, never what it said;
 *   - its coverage versions are emptied;
 *   - its facts keep what the person told DearPolicy about the event (dates, nights, bills), less any fact that refers
 *     to a deleted document (a policy-specific definition match).
 * The row itself, its claim, person and timestamps stay, so the claim's history still shows a calculation was made.
 *
 * "Refers to" means the document's id appears anywhere in the snapshot. A snapshot that refers to deleted and kept
 * documents is redacted whole: its totals combined both and are no longer true.
 *
 * It runs right after each deletion finishes and on every request drain (lib/jobs/request-drain.ts), so a failure
 * is retried and snapshots of documents deleted before this existed are caught up. It is idempotent (a redacted
 * snapshot is never picked again), bounded, and never throws.
 */
import { pool } from "@/lib/db/client";

type Db = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> };

/** Every state a deleted document can be in (pending_deletion included: its deletion has been asked for). */
const DELETED_STATES = ["pending_deletion", "soft_deleted", "permanently_deleted", "audit_tombstone"];
export const SNAPSHOT_REDACTED_REASON = "policy_deleted";

export type ClaimSnapshotScrubOptions = { db?: Db; policyIds?: string[]; limit?: number };
export type ClaimSnapshotScrubResult = { snapshotsRedacted: number; failed: number };

/** The facts minus every fact whose value refers to one of the deleted documents. */
export function factsWithoutDeleted(facts: unknown, deletedIds: string[]): unknown {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return facts;
  const ids = deletedIds.map((x) => x.toLowerCase());
  const refers = (v: unknown) => { const t = JSON.stringify(v ?? null).toLowerCase(); return ids.some((id) => t.includes(id)); };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(facts as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x) => !refers(x));
    else if (!refers(v)) out[k] = v;
    else out[k] = null;
  }
  return out;
}

export async function scrubDeletedDocumentClaimSnapshots(opts: ClaimSnapshotScrubOptions = {}): Promise<ClaimSnapshotScrubResult> {
  const db = opts.db ?? (pool as unknown as Db);
  const result: ClaimSnapshotScrubResult = { snapshotsRedacted: 0, failed: 0 };
  try {
    const exists = await db.query<{ ok: boolean }>(`SELECT to_regclass('public.claim_composition_snapshots') IS NOT NULL AS ok`);
    if (!exists.rows[0]?.ok) return result;
    const due = await db.query<{ id: string; account_id: string; facts_snapshot: unknown; deleted: string[] }>(
      `SELECT s.id::text AS id, s.account_id::text AS account_id, s.facts_snapshot, d.ids AS deleted
         FROM claim_composition_snapshots s
         CROSS JOIN LATERAL (
           SELECT array_agg(p.id::text) AS ids FROM policies p
            WHERE p.account_id=s.account_id AND p.lifecycle_state=ANY($1::text[])
              AND ($2::uuid[] IS NULL OR p.id=ANY($2::uuid[]))
              AND (s.coverage_versions::text ILIKE '%'||p.id::text||'%' OR s.result::text ILIKE '%'||p.id::text||'%'
                   OR s.facts_snapshot::text ILIKE '%'||p.id::text||'%')
         ) d
        WHERE d.ids IS NOT NULL AND s.result->'redacted' IS NULL
        ORDER BY s.created_at LIMIT $3`,
      [DELETED_STATES, opts.policyIds?.length ? opts.policyIds : null, opts.limit ?? 100]);
    for (const s of due.rows) {
      try {
        const r = await db.query(
          `UPDATE claim_composition_snapshots
              SET result=jsonb_build_object('redacted', jsonb_build_object('reason', $3::text), 'calculationId', calculation_id, 'engineVersion', engine_version),
                  coverage_versions='[]'::jsonb, facts_snapshot=$4::jsonb
            WHERE id=$1 AND account_id=$2 AND result->'redacted' IS NULL`,
          [s.id, s.account_id, SNAPSHOT_REDACTED_REASON, JSON.stringify(factsWithoutDeleted(s.facts_snapshot, s.deleted) ?? {})]);
        result.snapshotsRedacted += r.rowCount ?? 0;
      } catch (error) {
        result.failed++;
        console.warn("claim snapshot scrub will be retried:", error instanceof Error ? error.name : "unknown");
      }
    }
  } catch (error) {
    console.warn("claim snapshot scrub pass failed:", error instanceof Error ? error.name : "unknown");
  }
  return result;
}
