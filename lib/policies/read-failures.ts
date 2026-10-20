import { query } from "@/lib/db/client";

/** Why a document's reading did not finish, kept per document so the Coverage
 * and Benefits pages can say which document is stuck and why, instead of
 * "still being read" forever. Stored as a note in policies.reading_cache (an
 * existing jsonb column, see ensureEvidenceSchema), so no migration is needed.
 * Only a code is stored: a raw error can carry provider detail that must
 * never reach the household. */
export type ReadFailureCode = "timeout" | "reader_unavailable" | "unreadable_reply" | "no_pages" | "unknown";
export type ReadFailureNote = { attempts: number; reasonCode: ReadFailureCode; lastFailedAt: string | null; retryAfter?: string | null };

export const BENEFIT_READ_FAILURE_KEY = "benefit_read_failure";

export const READ_FAILURE_REASON: Record<ReadFailureCode, string> = {
  timeout: "Reading this document took too long and was stopped.",
  reader_unavailable: "The reading service was unavailable when DearPolicy tried to read this document.",
  unreadable_reply: "DearPolicy could not make sense of what was read from this document.",
  no_pages: "This document has no readable pages stored. Re-analyse it on the Documents page.",
  unknown: "DearPolicy could not finish reading this document.",
};

export function readFailureCode(error: unknown): ReadFailureCode {
  if (error instanceof Error && error.message === "no_pages") return "no_pages";
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  if (/timed? ?out|timeout|abort|deadline/i.test(text)) return "timeout";
  if (/quota|rate.?limit|\b429\b|\b5\d\d\b|unavailable|overloaded|api.?key|not configured|ECONN|fetch failed|network/i.test(text)) return "reader_unavailable";
  if (/json|schema|parse|zod|invalid|unexpected token/i.test(text)) return "unreadable_reply";
  return "unknown";
}

let column: Promise<boolean> | null = null;
export function readingCacheReady(): Promise<boolean> {
  column ??= query<{ ok: boolean }>("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='policies' AND column_name='reading_cache') AS ok")
    .then((r) => !!r.rows[0]?.ok).catch(() => { column = null; return false; });
  return column;
}

/** Records a failed read under `key`: attempts go up by one, the reason and time are replaced. */
export async function noteReadFailure(accountId: string, policyId: string, key: string, error: unknown): Promise<void> {
  try {
    if (!await readingCacheReady()) return;
    await query(
      `UPDATE policies SET reading_cache=coalesce(reading_cache,'{}'::jsonb)||jsonb_build_object($3::text,coalesce(reading_cache->$3::text,'{}'::jsonb)||jsonb_build_object(
         'attempts',coalesce((reading_cache->$3::text->>'attempts')::int,0)+1,'reasonCode',$4::text,
         'lastFailedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
       WHERE id=$1 AND account_id=$2`,
      [policyId, accountId, key, readFailureCode(error)]);
  } catch { /* Never let the note fail the read it describes. */ }
}

/** Clears the note once the document has been read. */
export async function clearReadFailure(accountId: string, policyId: string, key: string): Promise<void> {
  try {
    if (!await readingCacheReady()) return;
    await query(`UPDATE policies SET reading_cache=reading_cache-$3::text WHERE id=$1 AND account_id=$2 AND reading_cache ? $3::text`, [policyId, accountId, key]);
  } catch { /* best effort */ }
}

/** The notes under `key` for these documents of one household. */
export async function readFailureNotes(accountId: string, policyIds: string[], key: string): Promise<Map<string, ReadFailureNote>> {
  const out = new Map<string, ReadFailureNote>();
  if (!policyIds.length || !await readingCacheReady()) return out;
  const rows = (await query<{ id: string; note: Record<string, unknown> | null }>(
    `SELECT id::text AS id, reading_cache->$3::text AS note FROM policies WHERE account_id=$1 AND id::text=ANY($2::text[]) AND reading_cache ? $3::text`,
    [accountId, policyIds, key]).catch(() => ({ rows: [] as { id: string; note: Record<string, unknown> | null }[] }))).rows;
  for (const r of rows) {
    if (!r.note) continue;
    const code = String(r.note.reasonCode ?? "unknown");
    out.set(r.id, {
      attempts: Number(r.note.attempts ?? 1) || 1,
      reasonCode: (code in READ_FAILURE_REASON ? code : "unknown") as ReadFailureCode,
      lastFailedAt: typeof r.note.lastFailedAt === "string" ? r.note.lastFailedAt : null,
      ...(r.note.retryAfter !== undefined ? { retryAfter: typeof r.note.retryAfter === "string" ? r.note.retryAfter : null } : {}),
    });
  }
  return out;
}
