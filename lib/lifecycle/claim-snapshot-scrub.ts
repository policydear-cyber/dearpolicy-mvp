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
 * is retried and documents deleted before this existed are caught up. Each deleted document is handled once and then
 * marked done with one content-free audit entry (a status key only), so a caught-up drain does almost nothing. It is
 * bounded and never throws.
 */
import { pool } from "@/lib/db/client";

type Db = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> };

/** Every state a deleted document can be in (pending_deletion included: its deletion has been asked for). */
const DELETED_STATES = ["pending_deletion", "soft_deleted", "permanently_deleted", "audit_tombstone"];
export const SNAPSHOT_REDACTED_REASON = "policy_deleted";

export type ClaimSnapshotScrubOptions = { db?: Db; policyIds?: string[]; limit?: number };
export type ClaimSnapshotScrubResult = { documents: number; snapshotsRedacted: number; failed: number };

/** The done marker: one content-free audit entry per deleted document (a status key only). */
export const CLAIM_SNAPSHOT_SCRUB_ACTION = "claim_snapshots_scrubbed";

/**
 * The facts minus everything that refers to one of the deleted documents: a list entry (a policy-specific definition
 * match), an entry of a per-policy map (keyed by the document's id, or whose value names it), or a single value.
 * Facts are what the person reported about the event; the only facts tied to a document carry its id.
 */
export function factsWithoutDeleted(facts: unknown, deletedIds: string[]): unknown {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return facts;
  const ids = deletedIds.map((x) => x.toLowerCase());
  const refers = (v: unknown) => { const t = JSON.stringify(v ?? null).toLowerCase(); return ids.some((id) => t.includes(id)); };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(facts as Record<string, unknown>)) {
    if (!refers(v)) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => !refers(x));
    else if (v && typeof v === "object") out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([kk, vv]) => !refers(kk) && !refers(vv)));
    else out[k] = null;
  }
  return out;
}

/**
 * Handles each deleted document once: its household's snapshots that refer to it are redacted, then a done marker is
 * written. The drain only takes deleted documents without the marker, so a pass is cheap once caught up.
 */
export async function scrubDeletedDocumentClaimSnapshots(opts: ClaimSnapshotScrubOptions = {}): Promise<ClaimSnapshotScrubResult> {
  const db = opts.db ?? (pool as unknown as Db);
  const result: ClaimSnapshotScrubResult = { documents: 0, snapshotsRedacted: 0, failed: 0 };
  try {
    const tables = await db.query<{ snapshots: boolean; audit: boolean }>(
      `SELECT to_regclass('public.claim_composition_snapshots') IS NOT NULL AS snapshots, to_regclass('public.policy_document_audit_log') IS NOT NULL AS audit`);
    if (!tables.rows[0]?.audit) return result;
    const docs = await db.query<{ id: string; account_id: string }>(
      `SELECT p.id::text AS id, p.account_id::text AS account_id FROM policies p
        WHERE p.lifecycle_state=ANY($1::text[]) AND ($2::uuid[] IS NULL OR p.id=ANY($2::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM policy_document_audit_log a WHERE a.account_id=p.account_id AND a.policy_id=p.id AND a.action=$3)
        ORDER BY p.updated_at LIMIT $4`,
      [DELETED_STATES, opts.policyIds?.length ? opts.policyIds : null, CLAIM_SNAPSHOT_SCRUB_ACTION, opts.limit ?? 25]);
    for (const doc of docs.rows) {
      try {
        if (tables.rows[0].snapshots) {
          const due = await db.query<{ id: string; facts_snapshot: unknown }>(
            `SELECT id::text AS id, facts_snapshot FROM claim_composition_snapshots
              WHERE account_id=$1
                AND (coverage_versions::text ILIKE '%'||$2||'%' OR result::text ILIKE '%'||$2||'%' OR facts_snapshot::text ILIKE '%'||$2||'%')`,
            [doc.account_id, doc.id]);
          for (const s of due.rows) {
            const r = await db.query(
              `UPDATE claim_composition_snapshots
                  SET result=jsonb_build_object('redacted', jsonb_build_object('reason', $3::text), 'calculationId', calculation_id, 'engineVersion', engine_version),
                      coverage_versions='[]'::jsonb, facts_snapshot=$4::jsonb
                WHERE id=$1 AND account_id=$2`,
              [s.id, doc.account_id, SNAPSHOT_REDACTED_REASON, JSON.stringify(factsWithoutDeleted(s.facts_snapshot, [doc.id]) ?? {})]);
            result.snapshotsRedacted += r.rowCount ?? 0;
          }
        }
        await db.query(
          `INSERT INTO policy_document_audit_log(account_id,actor,action,previous_value,new_value,policy_id,reason,reason_code)
           VALUES ($1,'system',$2,NULL,$3::jsonb,$4,NULL,'CLAIM_SNAPSHOTS_SCRUBBED')`,
          [doc.account_id, CLAIM_SNAPSHOT_SCRUB_ACTION, JSON.stringify({ status: CLAIM_SNAPSHOT_SCRUB_ACTION }), doc.id]);
        result.documents++;
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
