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

type Db = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> };

/** What a scrubbed document's filename becomes. */
export const DELETED_FILENAME = "(deleted document)";
/** States in which a document's content is scrubbed. pending_deletion is first moved on to soft_deleted (step 1). */
const DELETED_STATES = ["soft_deleted", "permanently_deleted", "audit_tombstone"];
/** How long a document may sit in pending_deletion before its deletion counts as finished anyway (a crashed request). */
export const STUCK_PENDING_MINUTES = 60;
/** How long after its scrub a deleted document is still checked for late writes. A reading stops at its next step
 * once the document is deleted (lib/rag/ingest.ts) and no reading runs anywhere near this long; each re-scrub restarts
 * the window. Keeps the per-pass check to recently deleted documents. */
export const LEFTOVER_WINDOW_HOURS = 24;

/**
 * Every table holding rows read from a document, with the column naming the document. Each is deleted for a scrubbed
 * document; one missing in this deployment is skipped.
 */
export const DOCUMENT_CONTENT_TABLES: ReadonlyArray<readonly [table: string, column: string]> = [
  ["policy_pages", "policy_id"], ["policy_chunks", "policy_id"], ["policy_coverages", "policy_id"],
  ["policy_reference_coverages", "policy_id"], ["policy_benefits", "policy_id"], ["benefit_readings", "policy_id"],
  ["benefit_figure_confirmations", "policy_id"],
  ["coverage_rules", "policy_id"], ["policy_cover_conditions", "policy_id"], ["policy_detected_people", "policy_id"],
  ["policy_corrections", "policy_id"], ["policy_name_dismissals", "policy_id"], ["policy_member_exclusions", "policy_id"],
  ["policy_members", "policy_id"], ["claim_cause_definition_matches", "contract_id"],
  ["claim_ci_definition_matches", "contract_id"], ["claim_disability_definition_matches", "contract_id"],
  // Raw failure detail kept for support (lib/diagnostics/processing-failures.ts): a reading service's own error text,
  // which can name the stored file. Its resource_id is the document's id for document and scan failures.
  ["processing_failure_diagnostics", "resource_id"],
  // Premiums read from it (counted on Home); the deletion request removes them at once, a late reading can add more.
  ["premium_records", "source_document_id"],
];

/**
 * Rows read from another document still on file that only point at the deleted document: they stay on file and are
 * unlinked from it. (A premium filed against it with no source is deleted first: DearPolicy always records the source,
 * so an empty one cannot be shown to come from anywhere but the deleted document.) A premium from a renewal receipt filed against the
 * deleted policy still counts on Home.
 */
export const DOCUMENT_LINK_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [["premium_records", "policy_id"]];

/**
 * The tombstone keeps ids, kind, states and timestamps; every column read from the document is cleared. A column this
 * deployment does not have (some are added by later migrations) is skipped.
 */
export const DOCUMENT_CONTENT_COLUMNS = [
  "insurer", "product_name", "policy_number", "group_policy_number", "page_count", "extracted_json", "reading_cache",
  "processing_error", "processing_message", "review_reason", "scan_result_detail", "document_authority_label", "file_hash",
  "effective_date", "renewal_or_expiry_date", "document_date",
];
async function presentContentColumns(db: Db): Promise<string[]> {
  const r = await db.query<{ name: string }>(
    `SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='policies' AND column_name=ANY($1::text[])`,
    [DOCUMENT_CONTENT_COLUMNS]);
  const present = new Set(r.rows.map((x) => x.name));
  return DOCUMENT_CONTENT_COLUMNS.filter((c) => present.has(c));
}
function scrubPolicyRowSql(columns: string[]): string {
  const cleared = columns.map((c) => c + "=NULL");
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
  /** How far back scrubbed documents are re-checked for late writes. Default LEFTOVER_WINDOW_HOURS; null checks every
   * deleted document, whenever it was scrubbed (the one-off catch-up, scripts/lifecycle/deleted-leftovers-sweep.ts). */
  leftoverWindowHours?: number | null;
  /** Documents to leave out of this pass (the catch-up skips ones that already failed in an earlier round). */
  skipPolicyIds?: string[];
};
export type ScrubResult = { finished: number; scrubbed: number; searchIndexPending: string[]; failed: number; failedIds: string[]; forgottenKeys: number };

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
  const names = [...DOCUMENT_CONTENT_TABLES.map(([t]) => t), ...DOCUMENT_LINK_COLUMNS.map(([t]) => t), "policy_document_audit_log"];
  const r = await db.query<{ name: string }>(`SELECT n AS name FROM unnest($1::text[]) n WHERE to_regclass('public.'||n) IS NOT NULL`, [names]);
  return new Set(r.rows.map((x) => x.name));
}

/** SQL (on alias p) true when a scrubbed document has something read from it again, within the window (null: ever). */
function leftoverSql(tables: Set<string>, columns: string[], windowHours: number | null): string {
  const any = [
    ...[...DOCUMENT_CONTENT_TABLES, ...DOCUMENT_LINK_COLUMNS].filter(([t]) => tables.has(t)).map(([t, c]) => `EXISTS (SELECT 1 FROM ${t} x WHERE x.${c}=p.id)`),
    ...columns.map((c) => `p.${c} IS NOT NULL`),
  ];
  if (!any.length) return "false";
  const window = windowHours == null ? "" : `p.updated_at > now() - make_interval(hours => ${Math.max(0, Math.floor(windowHours))}) AND `;
  return `(p.original_filename=$2 AND ${window}(${any.join(" OR ")}))`;
}

/**
 * Read-only: how many deleted documents, already scrubbed at any time, still hold something read from them (the
 * one-off catch-up's dry run). Documents not yet scrubbed are left to the ordinary pass and not counted.
 */
export async function countDeletedDocumentLeftovers(db: Db = pool as unknown as Db): Promise<number> {
  const tables = await existingTables(db);
  const columns = await presentContentColumns(db);
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM policies p WHERE p.lifecycle_state=ANY($1::text[]) AND ${leftoverSql(tables, columns, null)}`,
    [DELETED_STATES, DELETED_FILENAME]);
  return Number(r.rows[0]?.n ?? 0);
}

export async function scrubDeletedDocuments(opts: ScrubOptions = {}): Promise<ScrubResult> {
  const db = opts.db ?? (pool as unknown as Db);
  const transaction = opts.transaction ?? defaultTransaction;
  const pinecone = opts.pinecone ?? defaultPinecone;
  const result: ScrubResult = { finished: 0, scrubbed: 0, searchIndexPending: [], failed: 0, failedIds: [], forgottenKeys: 0 };
  try {
    result.finished = await finishDeletedDocuments(db, opts.policyIds, opts.deletionFinished === true);
    const tables = await existingTables(db);
    const columns = await presentContentColumns(db);
    const scrubRow = scrubPolicyRowSql(columns);
    // Due: a deleted document not yet scrubbed, or one already scrubbed that has something read from it again. A
    // reading still running when the person deleted the document goes on writing pages, passages, benefit lines and
    // the document's own fields for a while (lib/rag/ingest.ts stops at its next step); scrubbing once is not enough.
    const leftovers = leftoverSql(tables, columns, opts.leftoverWindowHours === undefined ? LEFTOVER_WINDOW_HOURS : opts.leftoverWindowHours);
    const due = await db.query<{ id: string; account_id: string; storage_key: string }>(
      `SELECT p.id::text AS id, p.account_id::text AS account_id, p.storage_key FROM policies p
        WHERE p.lifecycle_state=ANY($1::text[]) AND ($3::uuid[] IS NULL OR p.id=ANY($3::uuid[]))
          AND (p.original_filename<>$2 OR ${leftovers}) AND NOT (p.id = ANY($5::uuid[]))
        ORDER BY p.updated_at LIMIT $4`,
      [DELETED_STATES, DELETED_FILENAME, opts.policyIds?.length ? opts.policyIds : null, opts.limit ?? 25, opts.skipPolicyIds ?? []]);
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
          // A premium of unknown source filed against it goes (it cannot be shown to come from another document).
          if (tables.has("premium_records")) await tx.query(`DELETE FROM premium_records WHERE policy_id=$1 AND source_document_id IS NULL`, [doc.id]);
          for (const [table, column] of DOCUMENT_LINK_COLUMNS) {
            if (tables.has(table)) await tx.query(`UPDATE ${table} SET ${column}=NULL WHERE ${column}=$1`, [doc.id]);
          }
          if (tables.has("policy_document_audit_log")) await tx.query(SCRUB_AUDIT, [doc.account_id, doc.id, STATUS_KEYS]);
          await tx.query(scrubRow, [doc.id, doc.account_id, DELETED_FILENAME, DELETED_STATES]);
        });
        result.scrubbed++;
      } catch (error) {
        result.failed++; result.failedIds.push(doc.id);
        console.warn("deleted document content scrub will be retried:", error instanceof Error ? error.name : "unknown");
      }
    }
    await stopDeletedDocumentJobs(db);
    result.forgottenKeys = await forgetPurgedKeys(db);
  } catch (error) {
    console.warn("deleted document content scrub pass failed:", error instanceof Error ? error.name : "unknown");
  }
  return result;
}

/** A staged copy's key as lib/storage/supabase.ts ocrHandoffObjectKey makes it (never ".."): only such a key is removed. */
const STAGED_COPY_KEY = /^(?!.*\.\.)[A-Za-z0-9._-]{1,80}\/ocr-handoff\/[A-Za-z0-9._-]{1,80}\/pages\.pdf$/;

/**
 * Every pass: a deleted document's reading jobs (its own, keyed by its id, and its later re-read, "<id>:retry-read")
 * keep no PDF password, file key or error text, and stay stopped. The deletion strips them once; a reading that was
 * running can schedule its re-read again afterwards, which brings the job back with the password.
 */
export async function stopDeletedDocumentJobs(db: Db): Promise<number> {
  // A reading that was waiting for Baidu (lib/documents/ocr-baidu.ts background reading) may have left a staged copy of
  // the scanned pages for Baidu to download: it is queued for removal, and the job forgets it.
  const staged = await db.query<{ key: string | null }>(
    `SELECT DISTINCT job->>'stagedKey' AS key
       FROM background_jobs j JOIN policies p ON j.account_id=p.account_id AND p.id::text=split_part(j.idempotency_key, ':', 1)
       CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.payload->'baiduWait'->'jobs')='array' THEN j.payload->'baiduWait'->'jobs' ELSE '[]'::jsonb END) job
      WHERE j.job_type='policy_processing' AND p.lifecycle_state=ANY($1::text[]) AND j.status <> 'processing'`,
    [DELETED_STATES]).catch(() => ({ rows: [] as { key: string | null }[] }));
  const keys = staged.rows.map((r) => r.key).filter((k): k is string => typeof k === "string" && STAGED_COPY_KEY.test(k));
  const queued = keys.length ? await enqueueStoragePurge(keys.map((storageKey) => ({ domain: "policy" as const, storageKey })), "ocr_handoff", db).then(() => true, () => false) : true;
  const r = await db.query(
    `UPDATE background_jobs j SET payload=j.payload-'pdfPassword'-'storageKey'${queued ? "-'baiduWait'" : ""}, last_error_message=NULL, cancel_requested=true,
            status=CASE WHEN j.status IN ('queued','failed_retryable') THEN 'cancelled' ELSE j.status END, updated_at=now()
       FROM policies p
      WHERE j.job_type='policy_processing' AND j.account_id=p.account_id AND p.id::text=split_part(j.idempotency_key, ':', 1)
        AND p.lifecycle_state=ANY($1::text[])
        AND (j.payload ?| ARRAY['pdfPassword','storageKey'${queued ? ",'baiduWait'" : ""}] OR NOT j.cancel_requested OR j.last_error_message IS NOT NULL
             OR j.status IN ('queued','failed_retryable'))`,
    [DELETED_STATES]).catch(() => ({ rowCount: 0 }));
  return r.rowCount ?? 0;
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
