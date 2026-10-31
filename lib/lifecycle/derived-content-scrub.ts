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
 *   - a saved answer made since the deleted document was added is kept ONLY when every document it refers to (any
 *     document id in its citations or saved answer) is still on file in this household, and it refers to at least
 *     one. Anything else (it cites the deleted document, cites nothing, or names it some other way) is replaced by the
 *     notice the chat already shows for an answer about a deleted document, with no quotes, figures, people or
 *     citations left. This is an allow-list on purpose: losing an old answer costs the person a re-ask; keeping one
 *     could keep deleted content. The person's own questions are kept: they are the person's words.
 *   - a chat whose saved working state or last answer, changed since the document was added, fails the same test has
 *     its last answer cleared and its state reset to what the person typed themselves (their own facts, such as nights
 *     in hospital or a bill amount, their question, a planned operation); everything worked out by the system or read
 *     from documents goes. Its messages stay, with the answers redacted as above.
 *   - a question DearPolicy asked to gather facts that names no document and states no figure is kept.
 *   - a finished background answer since then that fails the same test loses its result.
 *   - every cached chat analysis of that household is dropped (they are keyed by a hash, so which document each one
 *     came from cannot be told; they are only a 24-hour cache and are rebuilt on the next question).
 *   - its ledger rows are deleted.
 *   - one content-free audit entry records that this was done (who, what, when and a status key; nothing else). That entry is also what marks the
 *     document as done, so each document is handled once.
 *
 * It runs when a deletion finishes (lib/lifecycle/coordinator.ts) and on every request drain
 * (lib/jobs/request-drain.ts), so a failure is retried and documents deleted before this existed are caught up.
 * It never throws.
 *
 * Not covered here: claim calculation snapshots (claim_composition_snapshots), which are the claim's own record and
 * carry amounts and names from the documents they used (an open privacy-notice item).
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
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Chat state the person typed themselves (never read from a document), kept when a chat's state is reset. */
const USER_TEXT_STATE_KEYS = ["intent", "activeQuery", "activeClaimQuery", "personContext", "plannedEvent", "outsideSubject", "propertyEvent", "claimSessionId", "claimSetAside"] as const;

/**
 * What a chat's saved state keeps when it is reset because of a deleted document: the facts the person told
 * DearPolicy themselves (source "user": nights in hospital, a bill amount, a date) and the other things they typed (their
 * question, a planned operation, a what-if and their replies to it). Everything worked out by the system or read from
 * documents goes: derived facts, event candidates, pending questions, document lists, claim sources.
 */
export function userTypedChatState(state: unknown): Record<string, unknown> {
  const st = (state && typeof state === "object" ? state : {}) as Record<string, unknown>;
  const subjects: Record<string, Record<string, unknown>> = {};
  for (const [person, facts] of Object.entries((st.subjects && typeof st.subjects === "object" ? st.subjects : {}) as Record<string, unknown>)) {
    if (!facts || typeof facts !== "object") continue;
    const own = Object.fromEntries(Object.entries(facts as Record<string, unknown>).filter(([, f]) => (f as { source?: unknown } | null)?.source === "user"));
    if (Object.keys(own).length) subjects[person] = own;
  }
  const kept: Record<string, unknown> = { subjects };
  for (const k of USER_TEXT_STATE_KEYS) if (st[k] !== undefined) kept[k] = st[k];
  const whatIf = st.whatIf as { query?: unknown; answers?: unknown } | undefined;
  if (whatIf && typeof whatIf.query === "string") kept.whatIf = { query: whatIf.query, answers: whatIf.answers && typeof whatIf.answers === "object" ? whatIf.answers : {} };
  return kept;
}

/**
 * A question DearPolicy asked to gather facts ("When were you admitted?"), which refers to no document and states no
 * figure, carries nothing from any document and is kept.
 */
function isPlainFactFindingQuestion(answer: unknown, content: string, refersToAnyDocument: boolean): boolean {
  const a = answer as { mode?: unknown; summary?: unknown; details?: unknown; questions?: unknown; claimItems?: unknown; potentialPayoutTotals?: unknown } | null;
  if (!a || a.mode !== "fact_finding" || refersToAnyDocument) return false;
  const empty = (x: unknown) => !Array.isArray(x) || x.length === 0;
  if (!empty(a.claimItems) || !empty(a.potentialPayoutTotals)) return false;
  const text = [content, a.summary, JSON.stringify(a.details ?? []), JSON.stringify(a.questions ?? [])].join(" ");
  return !/\d/.test(text);
}

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
    const due = await db.query<{ id: string; account_id: string; added_at: string }>(
      `SELECT p.id::text AS id, p.account_id::text AS account_id, p.created_at::text AS added_at FROM policies p
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

/** Shortest product or plan name, and policy number, matched in kept text (shorter ones are ordinary words or figures). */
const MIN_NAME_LENGTH = 4;
const MIN_NUMBER_LENGTH = 5;
const escapeRegExp = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when the text names the deleted document: its product name, a plan name on it, or its policy number, as a whole
 * word (no letter or digit right before or after), ignoring case. Names another document still on file shares (a
 * renewal) are not counted.
 */
export function namesDocumentMatcher(names: string[], numbers: string[], sharedWithKept: Set<string>): (...parts: unknown[]) => boolean {
  const norm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
  const wanted = [...new Set([
    ...names.map(norm).filter((n) => n.length >= MIN_NAME_LENGTH),
    ...numbers.map(norm).filter((n) => n.length >= MIN_NUMBER_LENGTH),
  ])].filter((n) => !sharedWithKept.has(n));
  if (!wanted.length) return () => false;
  const re = new RegExp("(?<![\\p{L}\\p{N}])(?:" + wanted.map((n) => escapeRegExp(n).replace(/ /g, "\\s+")).join("|") + ")(?![\\p{L}\\p{N}])", "iu");
  return (...parts: unknown[]) => re.test(parts.map((x) => (x == null ? "" : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
}

/** Removes from the person's typed chat state anything that names the deleted document. */
function withoutNamed(state: Record<string, unknown>, names: (...parts: unknown[]) => boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    if (k === "subjects") {
      const subjects: Record<string, Record<string, unknown>> = {};
      for (const [person, facts] of Object.entries((v ?? {}) as Record<string, unknown>)) {
        if (!facts || typeof facts !== "object" || Array.isArray(facts)) { if (!names(facts)) subjects[person] = facts as Record<string, unknown>; continue; }
        const keptFacts = Object.fromEntries(Object.entries(facts).filter(([, f]) => !names(f)));
        if (Object.keys(keptFacts).length) subjects[person] = keptFacts;
      }
      out.subjects = subjects;
    } else if (!names(v)) out[k] = v;
  }
  return out;
}

/**
 * The allow-list test: stored text (an answer, a chat's state, a background result) may stay only when it refers to at
 * least one of the household's documents and every one it refers to is still on file.
 */
function referencesIn(known: Set<string>, parts: unknown[]): string[] {
  const text = parts.map((x) => (x == null ? "" : typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  return [...new Set((text.match(UUID_IN_TEXT) ?? []).map((x) => x.toLowerCase()))].filter((id) => known.has(id));
}
function staysWith(active: Set<string>, known: Set<string>) {
  return (...parts: unknown[]) => {
    const refs = referencesIn(known, parts);
    return refs.length > 0 && refs.every((id) => active.has(id));
  };
}

async function scrubOne(tx: Db, tables: Set<string>, doc: { id: string; account_id: string; added_at: string }) {
  const counts = { answersRedacted: 0, chatsReset: 0, jobsCleared: 0, cacheDropped: 0, ledgerRowsRemoved: 0 };
  // Every document of the household, in every state, named explicitly: the test needs to know which ids are this
  // household's documents (deleted ones too) and which of them are still on file.
  const docs = await tx.query<{ id: string; active: boolean }>(
    `SELECT id::text AS id, lifecycle_state='active' AS active FROM policies WHERE account_id=$1 AND lifecycle_state=ANY($2::text[])`,
    [doc.account_id, ["active", ...DELETED_STATES]]);
  const known = new Set(docs.rows.map((r) => r.id.toLowerCase()));
  const active = new Set(docs.rows.filter((r) => r.active).map((r) => r.id.toLowerCase()));
  active.delete(doc.id.toLowerCase());
  const refsStay = staysWith(active, known);
  // What names the deleted document in words (read before its own fields may be cleared by the content scrub).
  const own = await tx.query<{ product: string | null; number: string | null; plans: string[] | null }>(
    `SELECT to_jsonb(p)->>'product_name' AS product, to_jsonb(p)->>'policy_number' AS number,
            (SELECT array_agg(DISTINCT c.product_name) FROM policy_coverages c WHERE c.policy_id=p.id AND c.product_name IS NOT NULL) AS plans
       FROM policies p WHERE p.id=$1 AND p.account_id=$2 AND p.lifecycle_state=ANY($3::text[])`, [doc.id, doc.account_id, DELETED_STATES]);
  const kept = await tx.query<{ name: string }>(
    `SELECT lower(regexp_replace(btrim(n), '\\s+', ' ', 'g')) AS name FROM (
       SELECT to_jsonb(p)->>'product_name' AS n FROM policies p WHERE p.account_id=$1 AND p.id<>$2 AND p.lifecycle_state='active'
       UNION SELECT to_jsonb(p)->>'policy_number' FROM policies p WHERE p.account_id=$1 AND p.id<>$2 AND p.lifecycle_state='active'
       UNION SELECT c.product_name FROM policy_coverages c JOIN policies p ON p.id=c.policy_id AND p.lifecycle_state='active' WHERE c.account_id=$1 AND c.policy_id<>$2
     ) x WHERE n IS NOT NULL`, [doc.account_id, doc.id]);
  const o = own.rows[0];
  const namesDoc = namesDocumentMatcher([o?.product ?? "", ...(o?.plans ?? [])].filter(Boolean), [o?.number ?? ""].filter(Boolean), new Set(kept.rows.map((r) => r.name)));
  const stays = (...parts: unknown[]) => refsStay(...parts) && !namesDoc(...parts);

  if (tables.has("chat_messages")) {
    const rows = await tx.query<{ id: string; citations: unknown; answer_json: unknown; content: string }>(
      `SELECT id::text AS id, citations, answer_json, content FROM chat_messages
        WHERE account_id=$1 AND role='assistant' AND created_at >= $2::timestamptz AND content IS DISTINCT FROM $3
        FOR UPDATE`, [doc.account_id, doc.added_at, STALE_ANSWER_NOTICE]);
    for (const m of rows.rows) {
      if (refsStay(m.citations, m.answer_json) && !namesDoc(m.content, m.citations, m.answer_json)) continue;
      if (isPlainFactFindingQuestion(m.answer_json, m.content ?? "", referencesIn(known, [m.citations, m.answer_json]).length > 0) && !namesDoc(m.content, m.answer_json)) continue;
      await tx.query(`UPDATE chat_messages SET content=$1, citations='[]'::jsonb, answer_json=CASE WHEN answer_json IS NULL THEN NULL ELSE $2::jsonb END WHERE id=$3 AND account_id=$4`,
        [STALE_ANSWER_NOTICE, JSON.stringify(redactedStoredAnswer(m.answer_json)), m.id, doc.account_id]);
      counts.answersRedacted++;
    }
  }
  if (tables.has("chat_conversations")) {
    const rows = await tx.query<{ id: string; state: unknown; last_answer: unknown }>(
      `SELECT id::text AS id, state, last_answer FROM chat_conversations WHERE account_id=$1 AND updated_at >= $2::timestamptz FOR UPDATE`,
      [doc.account_id, doc.added_at]);
    for (const c of rows.rows) {
      if (stays(c.state, c.last_answer)) continue;
      // The person's own facts stay, less anything that names the deleted document (by id or in words).
      let typed = withoutNamed(userTypedChatState(c.state), namesDoc);
      if (referencesIn(known, [typed]).some((id) => !active.has(id))) typed = { ...typed, subjects: {} };
      if (JSON.stringify(typed) === JSON.stringify(c.state) && c.last_answer == null) continue;
      await tx.query(`UPDATE chat_conversations SET state=$3::jsonb, last_answer=NULL, revision=revision+1, updated_at=now() WHERE account_id=$1 AND id=$2`,
        [doc.account_id, c.id, JSON.stringify(typed)]);
      counts.chatsReset++;
    }
  }
  if (tables.has("chat_analysis_jobs")) {
    // A job still waiting or running is left alone: it reads the household's documents when it runs, and a deleted
    // document is no longer among them (every chat read filters to active documents).
    const rows = await tx.query<{ id: string; result_json: unknown }>(
      `SELECT id::text AS id, result_json FROM chat_analysis_jobs
        WHERE account_id=$1 AND status NOT IN ('queued','running') AND result_json IS NOT NULL AND updated_at >= $2::timestamptz FOR UPDATE`,
      [doc.account_id, doc.added_at]);
    for (const j of rows.rows) {
      if (stays(j.result_json)) continue;
      await tx.query(`UPDATE chat_analysis_jobs SET result_json=NULL, request_json='{}'::jsonb, updated_at=now() WHERE account_id=$1 AND id=$2`, [doc.account_id, j.id]);
      counts.jobsCleared++;
    }
  }
  if (tables.has("policy_analysis_cache")) {
    // Hash-keyed chat analyses can't be traced to a document, so all of this household's are dropped. The document's
    // own catalogue checkpoints (keyed by its id) go too.
    const r = await tx.query(
      `DELETE FROM policy_analysis_cache WHERE account_id=$1 AND (cache_key ~ '^[0-9a-f]{64}$' OR cache_key LIKE $2)`,
      [doc.account_id, "%" + doc.id + "%"]);
    counts.cacheDropped = r.rowCount ?? 0;
  }
  if (tables.has("coverage_rules")) {
    const r = await tx.query(`DELETE FROM coverage_rules WHERE account_id=$1 AND policy_id=$2`, [doc.account_id, doc.id]);
    counts.ledgerRowsRemoved = r.rowCount ?? 0;
  }
  // The content-free record: who, what and when, and a status key only (the counts are returned, not stored, so the
  // entry stays as it is when the document's own audit payloads are reduced to status keys).
  await tx.query(
    `INSERT INTO policy_document_audit_log(account_id,actor,action,previous_value,new_value,policy_id,reason,reason_code)
     VALUES($1,'system',$2,NULL,$3::jsonb,$4,NULL,'DERIVED_CONTENT_SCRUBBED')`,
    [doc.account_id, DERIVED_SCRUB_ACTION, JSON.stringify({ status: DERIVED_SCRUB_ACTION }), doc.id]);
  return counts;
}
