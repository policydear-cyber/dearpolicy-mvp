/**
 * Deleting a document really removes what was read from it (privacy).
 *
 * A deleted document keeps its policies row as a tombstone, so the lifecycle and its audit trail still work. Before this
 * module, everything read from the document stayed in the database behind that tombstone: the page text, passages,
 * benefit lines, detected names, the filename, insurer, policy number and the whole extraction. Its search passages
 * also stayed in Pinecone whenever the first removal attempt failed, and the row never left "pending_deletion", so
 * its stored file was never even queued for removal (lib/storage/purge.ts only takes deleted rows).
 *
 * scrubDeletedDocuments() makes deletion real, for any household and any document:
 *   1. A document whose deletion has finished becomes soft_deleted (its deletion request completed, or it has sat in
 *      pending_deletion for over an hour, which only a crashed request leaves behind; nothing moves it back to active).
 *   2. Its search passages are removed from Pinecone when Pinecone is set up. If that fails, nothing else happens to
 *      the document in this pass, and the next pass tries again: content is never scrubbed while passages remain.
 *   3. In one transaction: its stored file is queued for removal (lib/storage/purge.ts removes it and retries), every
 *      row read from it is hard-deleted (pages, passages, benefit lines, conditions, detected people, corrections,
 *      member links, claim definition matches), its audit entries keep only who/what/when plus the status keys, and
 *      the tombstone keeps only ids, kind, states and timestamps. The filename becomes "(deleted document)" and the
 *      storage key "deleted/<id>".
 *   4. Once a stored file has been removed, the purge queue forgets its key (which carried the filename).
 *
 * It runs right after each deletion finishes and again on every request drain (lib/jobs/request-drain.ts), so a
 * failure is retried automatically. It is idempotent: a scrubbed row is never picked again. It never throws.
 */
import { pool } from "@/lib/db/client";
import { withServiceTransaction } from "@/lib/db/authz-client";
import { deletePolicyPassages, pineconeEnabled } from "@/lib/rag/pinecone";
import { enqueueStoragePurge } from "@/lib/storage/purge";
import { DERIVED_SCRUB_ACTION } from "./derived-content-scrub";

type Db = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> };

/** What a scrubbed document's filename becomes. */
export const DELETED_FILENAME = "(deleted document)";
/** States in which a document's content is scrubbed. pending_deletion is first moved on to soft_deleted (step 1). */
const DELETED_STATES = ["soft_deleted", "permanently_deleted", "audit_tombstone"];
/** How long a document may sit in pending_deletion before its deletion counts as finished anyway (a crashed request). */
export const STUCK_PENDING_MINUTES = 60;
/**
 * A deleted document's content is scrubbed only once lib/lifecycle/derived-content-scrub.ts has finished with it (its
 * done marker exists): that scrub reads the document's product name, plans and policy number to find chat text that
 * names it, and this scrub clears them. If the derived scrub keeps failing, content goes anyway after this long, so a
 * failure there never keeps deleted content on file.
 */
export const DERIVED_SCRUB_WAIT_MINUTES = 60;

/**
 * Every table holding rows read from a document, with the column naming the document. Each is deleted for a scrubbed
 * document; one missing in this deployment is skipped.
 */
export const DOCUMENT_CONTENT_TABLES: ReadonlyArray<readonly [table: string, column: string]> = [
  ["policy_pages", "policy_id"], ["policy_chunks", "policy_id"], ["policy_coverages", "policy_id"],
  ["policy_reference_coverages", "policy_id"], ["policy_benefits", "policy_id"], ["benefit_readings", "policy_id"],
  ["coverage_rules", "policy_id"], ["policy_cover_conditions", "policy_id"], ["policy_detected_people", "policy_id"],
  ["policy_corrections", "policy_id"], ["policy_name_dismissals", "policy_id"], ["policy_member_exclusions", "policy_id"],
  ["policy_members", "policy_id"], ["claim_cause_definition_matches", "contract_id"],
  ["claim_ci_definition_matches", "contract_id"], ["claim_disability_definition_matches", "contract_id"],
];

/**
 * The tombstone keeps ids, kind, states and timestamps; every column read from the document is cleared. A column this
 * deployment does not have (some are added by later migrations) is skipped.
 */
export const DOCUMENT_CONTENT_COLUMNS = [
  "insurer", "product_name", "policy_number", "group_policy_number", "page_count", "extracted_json", "reading_cache",
  "processing_error", "processing_message", "review_reason", "scan_result_detail", "document_authority_label", "file_hash",
  "effective_date", "renewal_or_expiry_date", "document_date",
];
async function scrubPolicyRowSql(db: Db): Promise<string> {
  const r = await db.query<{ name: string }>(
    `SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='policies' AND column_name=ANY($1::text[])`,
    [DOCUMENT_CONTENT_COLUMNS]);
  const present = new Set(r.rows.map((x) => x.name));
  const cleared = DOCUMENT_CONTENT_COLUMNS.filter((c) => present.has(c)).map((c) => c + "=NULL");
  return `UPDATE policies SET original_filename=$3, storage_key='deleted/'||id::text, ${[...cleared, "updated_at=now()"].join(", ")}
    WHERE id=$1 AND account_id=$2 AND lifecycle_state=ANY($4::text[])`;
}

/** Audit entries keep actor, action, time and reason code; their payloads keep only the status keys. */
const STATUS_KEYS = ["quarantineStatus", "status", "scanStatus"];
const SCRUB_AUDIT = `UPDATE policy_document_audit_log SET reason=NULL,
    previous_value=CASE WHEN previous_value IS NULL THEN NULL ELSE (SELECT jsonb_object_agg(k, previous_value->k) FROM unnest($3::text[]) k WHERE previous_value ? k) END,
    new_value=CASE WHEN new_value IS NULL THEN NULL ELSE (SELECT jsonb_object_agg(k, new_value->k) FROM unnest($3::text[]) k WHERE new_value ? k) END
  WHERE account_id=$1 AND policy_id=$2`;

export type PineconeCleanup = { enabled: () => boolean; deletePassages: (args: { accountId: string; policyId: string }) => Promise<unknown> };
export type ScrubOptions = {
  db?: Db;
  /** Runs fn in one transaction. Defaults to the trusted server connection. */
  transaction?: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  pinecone?: PineconeCleanup;
  /** Only these documents (right after a deletion); otherwise every deleted document not yet scrubbed. */
  policyIds?: string[];
  /** Set by the deletion flows once their deletion request has completed: these documents' deletion is finished. */
  deletionFinished?: boolean;
  limit?: number;
};
export type ScrubResult = { finished: number; scrubbed: number; searchIndexPending: string[]; failed: number; forgottenKeys: number };

const defaultPinecone: PineconeCleanup = { enabled: pineconeEnabled, deletePassages: deletePolicyPassages };
const defaultTransaction = <T>(fn: (db: Db) => Promise<T>) => withServiceTransaction((client) => fn(client as unknown as Db));

/**
 * Moves documents whose deletion has finished from pending_deletion to soft_deleted (step 1).
 *
 * The "stuck over STUCK_PENDING_MINUTES" rule is safe only because no code today moves a document from
 * pending_deletion back to active (lib/lifecycle/types.ts allows that transition, but nothing performs it). If a
 * "cancel deletion", restore or undo feature is ever added, it must also change this
 * rule (for example, only finish rows whose deletion request is not cancelled), or a cancelled deletion an hour old
 * would still be scrubbed.
 */
export async function finishDeletedDocuments(db: Db, policyIds?: string[], deletionFinished = false): Promise<number> {
  const r = await db.query(
    `UPDATE policies p SET lifecycle_state='soft_deleted', lifecycle_version=lifecycle_version+1, updated_at=now()
      WHERE p.lifecycle_state='pending_deletion' AND ($1::uuid[] IS NULL OR p.id=ANY($1::uuid[]))
        AND ($3::boolean OR p.updated_at < now() - make_interval(mins => $2::int)
             OR EXISTS (SELECT 1 FROM deletion_requests d WHERE d.resource_id=p.id AND d.resource_type IN ('policy_document','policy')
                          AND d.lifecycle_state IN ('soft_deleted','permanently_deleted','audit_tombstone')))`,
    [policyIds?.length ? policyIds : null, STUCK_PENDING_MINUTES, deletionFinished && !!policyIds?.length]);
  return r.rowCount ?? 0;
}

async function existingTables(db: Db): Promise<Set<string>> {
  const names = [...DOCUMENT_CONTENT_TABLES.map(([t]) => t), "policy_document_audit_log"];
  const r = await db.query<{ name: string }>(`SELECT n AS name FROM unnest($1::text[]) n WHERE to_regclass('public.'||n) IS NOT NULL`, [names]);
  return new Set(r.rows.map((x) => x.name));
}

export async function scrubDeletedDocuments(opts: ScrubOptions = {}): Promise<ScrubResult> {
  const db = opts.db ?? (pool as unknown as Db);
  const transaction = opts.transaction ?? defaultTransaction;
  const pinecone = opts.pinecone ?? defaultPinecone;
  const result: ScrubResult = { finished: 0, scrubbed: 0, searchIndexPending: [], failed: 0, forgottenKeys: 0 };
  try {
    result.finished = await finishDeletedDocuments(db, opts.policyIds, opts.deletionFinished === true);
    const due = await db.query<{ id: string; account_id: string; storage_key: string }>(
      `SELECT id::text AS id, account_id::text AS account_id, storage_key FROM policies
        WHERE lifecycle_state=ANY($1::text[]) AND original_filename<>$2 AND ($3::uuid[] IS NULL OR id=ANY($3::uuid[]))
          AND (EXISTS (SELECT 1 FROM policy_document_audit_log a WHERE a.account_id=policies.account_id AND a.policy_id=policies.id AND a.action=$5)
               OR updated_at < now() - make_interval(mins => $6::int))
        ORDER BY updated_at LIMIT $4`,
      [DELETED_STATES, DELETED_FILENAME, opts.policyIds?.length ? opts.policyIds : null, opts.limit ?? 25, DERIVED_SCRUB_ACTION, DERIVED_SCRUB_WAIT_MINUTES]);
    const tables = due.rows.length ? await existingTables(db) : new Set<string>();
    const scrubRow = due.rows.length ? await scrubPolicyRowSql(db) : "";
    for (const doc of due.rows) {
      if (pinecone.enabled()) {
        try { await pinecone.deletePassages({ accountId: doc.account_id, policyId: doc.id }); }
        catch { result.searchIndexPending.push(doc.id); continue; }
      }
      try {
        await transaction(async (tx) => {
          if (!doc.storage_key.startsWith("deleted/")) await enqueueStoragePurge([{ domain: "policy", storageKey: doc.storage_key }], "document_deleted", tx);
          for (const [table, column] of DOCUMENT_CONTENT_TABLES) {
            if (tables.has(table)) await tx.query(`DELETE FROM ${table} WHERE ${column}=$1`, [doc.id]);
          }
          if (tables.has("policy_document_audit_log")) await tx.query(SCRUB_AUDIT, [doc.account_id, doc.id, STATUS_KEYS]);
          await tx.query(scrubRow, [doc.id, doc.account_id, DELETED_FILENAME, DELETED_STATES]);
        });
        result.scrubbed++;
      } catch (error) {
        result.failed++;
        console.warn("deleted document content scrub will be retried:", error instanceof Error ? error.name : "unknown");
      }
    }
    result.forgottenKeys = await forgetPurgedKeys(db);
  } catch (error) {
    console.warn("deleted document content scrub pass failed:", error instanceof Error ? error.name : "unknown");
  }
  return result;
}

/**
 * Step 4: a stored file that has been removed no longer needs its key, which names the household, person, document
 * and the original filename. A key kept because an active document still uses it is left alone.
 */
export async function forgetPurgedKeys(db: Db): Promise<number> {
  const r = await db.query(
    `UPDATE storage_purge_queue SET storage_key='purged/'||id::text
      WHERE purged_at IS NOT NULL AND last_error IS NULL AND storage_key NOT LIKE 'purged/%'`).catch(() => ({ rowCount: 0 }));
  return r.rowCount ?? 0;
}
