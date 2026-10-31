/**
 * Deleting a document also removes what was worked out from it elsewhere (privacy).
 *
 * Besides the rows read straight from a document, two kinds of stored data carry what was taken from it:
 *   - the coverage ledger (coverage_rules): one row per cover read from the document, with its amounts, conditions
 *     and quotes. Every ledger row names the one document it was read from (policy_id), so rows of a deleted document
 *     are deleted; nothing else is built from them (answers read the ledger live, so they recompute without them).
 *   - stored chat: saved answers (chat_messages.content, citations, answer_json), each chat's last answer and its
 *     saved working state (chat_conversations.last_answer, state), finished background answers
 *     (chat_analysis_jobs.result_json) and the cached document analyses chat reuses (policy_analysis_cache).
 *     The chat already hides an answer that cites a deleted document when it is shown
 *     (lib/chat/stale-answers.ts), but the stored row kept every quote, amount and name.
 *
 * scrubDeletedDocumentDerivedContent() makes that removal real, for any household:
 *   - a saved answer that mentions the deleted document anywhere (its id in its citations or answer, or the
 *     document's policy number in its text) is replaced by the same notice the chat already shows for it, with no
 *     quotes, figures, people or citations left. The person's own questions are kept: they are the person's words.
 *   - a chat whose saved working state or last answer mentions the document has them cleared (the chat carries on
 *     from a fresh start; its messages stay, with the answers redacted as above).
 *   - a finished background answer that mentions it loses its result.
 *   - every cached chat analysis of that household is dropped (they are keyed by a hash, so which document each one
 *     came from cannot be told; they are only a 24-hour cache and are rebuilt on the next question).
 *   - its ledger rows are deleted.
 *   - one content-free audit entry records that this was done, with counts only. That entry is also what marks the
 *     document as done, so each document is handled once.
 *
 * It runs when a deletion finishes (lib/lifecycle/coordinator.ts) and on every request drain
 * (lib/jobs/request-drain.ts), so a failure is retried and documents deleted before this existed are caught up.
 * It never throws.
 *
 * Not covered here: claim calculation snapshots (claim_composition_snapshots), which are the claim's own record.
 */
import { pool } from "@/lib/db/client";
import { withServiceTransaction } from "@/lib/db/authz-client";
import { STALE_ANSWER_NOTICE, invalidatedAnswer } from "@/lib/chat/stale-answers";
import type { ChatAnswer } from "@/types";

type Db = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> };

/** The audit action that records (and marks) a document's derived content as removed. */
export const DERIVED_SCRUB_ACTION = "derived_content_scrubbed";
/** Every state a document is in once its deletion was asked for. Nothing moves a document back to active today; a
 * future "cancel deletion" feature must leave pending_deletion out of this list. */
const DELETED_STATES = ["pending_deletion", "soft_deleted", "permanently_deleted", "audit_tombstone"];
/** Shortest policy number matched in answer text; shorter strings could be ordinary words or figures. */
const MIN_POLICY_NUMBER_LENGTH = 6;
const FRESH_CHAT_STATE = { subjects: {} };

/** What a saved answer becomes: the chat's own "relied on a deleted document" notice and nothing else from it. */
export function redactedStoredAnswer(answer: unknown): ChatAnswer {
  const a = (answer && typeof answer === "object" ? answer : {}) as Partial<ChatAnswer> & Record<string, unknown>;
  const notice = invalidatedAnswer({} as ChatAnswer);
  // Only fields that say which chat and turn this was are kept; nothing that came from a document.
  const keep: Record<string, unknown> = {};
  for (const k of ["conversationId", "conversationRevision", "mode", "claimSessionId", "disclaimer"]) if (k in a) keep[k] = a[k];
  return { ...notice, ...keep, summary: STALE_ANSWER_NOTICE, confidence: "insufficient_evidence" } as ChatAnswer;
}

export type DerivedScrubOptions = {
  db?: Db;
  transaction?: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  /** Only these documents (right after a deletion); otherwise every deleted document not yet handled. */
  policyIds?: string[];
  limit?: number;
};
export type DerivedScrubResult = { documents: number; answersRedacted: number; chatsReset: number; jobsCleared: number; cacheDropped: number; ledgerRowsRemoved: number; failed: number };

const defaultTransaction = <T>(fn: (db: Db) => Promise<T>) => withServiceTransaction((client) => fn(client as unknown as Db));

async function present(db: Db, names: string[]): Promise<Set<string>> {
  const r = await db.query<{ name: string }>(`SELECT n AS name FROM unnest($1::text[]) n WHERE to_regclass('public.'||n) IS NOT NULL`, [names]);
  return new Set(r.rows.map((x) => x.name));
}

export async function scrubDeletedDocumentDerivedContent(opts: DerivedScrubOptions = {}): Promise<DerivedScrubResult> {
  const db = opts.db ?? (pool as unknown as Db);
  const transaction = opts.transaction ?? defaultTransaction;
  const result: DerivedScrubResult = { documents: 0, answersRedacted: 0, chatsReset: 0, jobsCleared: 0, cacheDropped: 0, ledgerRowsRemoved: 0, failed: 0 };
  try {
    const tables = await present(db, ["chat_messages", "chat_conversations", "chat_analysis_jobs", "policy_analysis_cache", "coverage_rules", "policy_document_audit_log"]);
    if (!tables.has("policy_document_audit_log")) return result;
    const due = await db.query<{ id: string; account_id: string; policy_number: string | null }>(
      `SELECT p.id::text AS id, p.account_id::text AS account_id, to_jsonb(p)->>'policy_number' AS policy_number FROM policies p
        WHERE p.lifecycle_state=ANY($1::text[]) AND ($2::uuid[] IS NULL OR p.id=ANY($2::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM policy_document_audit_log a WHERE a.account_id=p.account_id AND a.policy_id=p.id AND a.action=$3)
        ORDER BY p.updated_at LIMIT $4`,
      [DELETED_STATES, opts.policyIds?.length ? opts.policyIds : null, DERIVED_SCRUB_ACTION, opts.limit ?? 25]);
    for (const doc of due.rows) {
      try {
        const counts = await transaction((tx) => scrubOne(tx, tables, doc));
        result.documents++;
        result.answersRedacted += counts.answersRedacted; result.chatsReset += counts.chatsReset; result.jobsCleared += counts.jobsCleared;
        result.cacheDropped += counts.cacheDropped; result.ledgerRowsRemoved += counts.ledgerRowsRemoved;
      } catch (error) {
        result.failed++;
        console.warn("deleted document derived-content scrub will be retried:", error instanceof Error ? error.name : "unknown");
      }
    }
  } catch (error) {
    console.warn("deleted document derived-content scrub pass failed:", error instanceof Error ? error.name : "unknown");
  }
  return result;
}

async function scrubOne(tx: Db, tables: Set<string>, doc: { id: string; account_id: string; policy_number: string | null }) {
  const counts = { answersRedacted: 0, chatsReset: 0, jobsCleared: 0, cacheDropped: 0, ledgerRowsRemoved: 0 };
  // A policy number another active document of this household still carries (a renewal, a replacement) is not a sign
  // that an answer came from the deleted one, so then only the document's id is matched.
  let policyNumber = doc.policy_number?.trim() ?? "";
  if (policyNumber) {
    const shared = await tx.query(`SELECT 1 FROM policies WHERE account_id=$1 AND id<>$2 AND lifecycle_state='active' AND lower(btrim(to_jsonb(policies)->>'policy_number'))=lower($3) LIMIT 1`,
      [doc.account_id, doc.id, policyNumber]);
    if (shared.rows.length) policyNumber = "";
  }
  const numberPattern = policyNumber.length >= MIN_POLICY_NUMBER_LENGTH ? "%" + policyNumber.replace(/[\\%_]/g, (c) => "\\" + c) + "%" : null;
  const idPattern = "%" + doc.id + "%";

  if (tables.has("chat_messages")) {
    const hits = await tx.query<{ id: string; answer_json: unknown }>(
      `SELECT id::text AS id, answer_json FROM chat_messages
        WHERE account_id=$1 AND role='assistant'
          AND (coalesce(citations::text,'') LIKE $2 OR coalesce(answer_json::text,'') LIKE $2
               OR ($3::text IS NOT NULL AND (content ILIKE $3 OR coalesce(answer_json::text,'') ILIKE $3)))
        FOR UPDATE`, [doc.account_id, idPattern, numberPattern]);
    for (const m of hits.rows) {
      await tx.query(`UPDATE chat_messages SET content=$1, citations='[]'::jsonb, answer_json=CASE WHEN answer_json IS NULL THEN NULL ELSE $2::jsonb END WHERE id=$3 AND account_id=$4`,
        [STALE_ANSWER_NOTICE, JSON.stringify(redactedStoredAnswer(m.answer_json)), m.id, doc.account_id]);
      counts.answersRedacted++;
    }
  }
  if (tables.has("chat_conversations")) {
    const r = await tx.query(
      `UPDATE chat_conversations SET state=$3::jsonb, last_answer=NULL, revision=revision+1, updated_at=now()
        WHERE account_id=$1 AND (coalesce(state::text,'') LIKE $2 OR coalesce(last_answer::text,'') LIKE $2
              OR ($4::text IS NOT NULL AND (coalesce(state::text,'') ILIKE $4 OR coalesce(last_answer::text,'') ILIKE $4)))`,
      [doc.account_id, idPattern, JSON.stringify(FRESH_CHAT_STATE), numberPattern]);
    counts.chatsReset = r.rowCount ?? 0;
  }
  if (tables.has("chat_analysis_jobs")) {
    // A job still waiting or running is left to finish; its result is cleared on the next pass once it has.
    const r = await tx.query(
      `UPDATE chat_analysis_jobs SET result_json=NULL, request_json='{}'::jsonb, updated_at=now()
        WHERE account_id=$1 AND status NOT IN ('queued','running')
          AND (coalesce(result_json::text,'') LIKE $2 OR ($3::text IS NOT NULL AND coalesce(result_json::text,'') ILIKE $3))`,
      [doc.account_id, idPattern, numberPattern]);
    counts.jobsCleared = r.rowCount ?? 0;
  }
  if (tables.has("policy_analysis_cache")) {
    // Hash-keyed chat analyses can't be traced to a document, so all of this household's are dropped. The document's
    // own catalogue checkpoints (keyed by its id) go too.
    const r = await tx.query(
      `DELETE FROM policy_analysis_cache WHERE account_id=$1 AND (cache_key ~ '^[0-9a-f]{64}$' OR cache_key LIKE $2)`,
      [doc.account_id, idPattern]);
    counts.cacheDropped = r.rowCount ?? 0;
  }
  if (tables.has("coverage_rules")) {
    const r = await tx.query(`DELETE FROM coverage_rules WHERE account_id=$1 AND policy_id=$2`, [doc.account_id, doc.id]);
    counts.ledgerRowsRemoved = r.rowCount ?? 0;
  }
  // The content-free record: who/what/when and counts only.
  await tx.query(
    `INSERT INTO policy_document_audit_log(account_id,actor,action,previous_value,new_value,policy_id,reason,reason_code)
     VALUES($1,'system',$2,NULL,$3::jsonb,$4,NULL,'DERIVED_CONTENT_SCRUBBED')`,
    [doc.account_id, DERIVED_SCRUB_ACTION, JSON.stringify(counts), doc.id]);
  return counts;
}
