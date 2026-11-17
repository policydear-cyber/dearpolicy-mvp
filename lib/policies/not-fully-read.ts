import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import { DOCUMENT_READ_IN_PART_MESSAGES } from "@/lib/documents/processing-errors";
import { READ_FAILURE_KEYS, readingCacheReady } from "@/lib/policies/read-failures";
import { UNSURE_KEY } from "@/lib/policies/upload-owner";
import { documentCardTitle } from "@/lib/policies/document-name";
import { SCAN_GOES_ON } from "@/lib/benefit-table/service";

/** A person's documents (linked to them, or uploaded for them and not linked to anyone yet) whose reading did not
 * finish. Cover in them may be missing from Home and Coverage, so "Not found" there must say so instead of reading as
 * "you have no such cover". Counted: a failed read; a document read in part (pages that could not be checked give no
 * amounts) or whose cover reading stopped; one intake has not finished with and that Home no longer shows as being read
 * (no change for 30 minutes, the window Home's reading count uses: stalled, or held for its scan) or whose upload the
 * scan rejected; a ready document with no pages; and any document the benefit table says is stalled, held, not readable
 * or waiting for Read again (its states, passed in by the caller, cover misfiled packs). Not counted: a superseded or
 * deleted copy, and a receipt or letter, which intake never reads cover from (unless the table says it is a misfiled
 * pack). */
/** `coverUnknown`: of those, the documents whose kinds of cover are not known either (every one except a document whose
 * cover was read and only some amounts could not be checked, "Read in part." alone). While any is left, Home names no
 * gap: an unread travel schedule must never read as "no Travel cover found" (design review 2, Critic finding 2). */
export type NotFullyRead = { count: number; names: string[]; ids: string[]; coverUnknown: number };
/** Benefit-table states that mean the document's cover was not read (lib/benefit-table/service.ts documentState). */
const UNREAD_STATES = new Set(["stalled", "held", "not_readable", "table_unread", "read_in_part"]);
/** The person's own documents: linked to them, or uploaded for them and linked to no one. `p` is the policies alias. */
/** `cache`: the policies.reading_cache column exists (readingCacheReady). Then an upload whose person was "Not sure"
 * (lib/policies/upload-owner.ts) and that nobody is linked to yet is nobody's: its placeholder owner never counts. */
export const OWNED_BY_MEMBER = (member: string, cache = false) => `(EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=${member})
  OR (p.family_member_id=${member} AND NOT EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id)${cache ? ` AND NOT coalesce(p.reading_cache ? '${UNSURE_KEY}',false)` : ""}))`;

/** A ready document's page note (lib/documents/processing-errors.ts unreadablePagesNote, notReadPagesNote): a page that
 * could not be read, or a scanned page not read yet. Such a document is never fully read, whatever leads its message. */
const UNREAD_PAGE_NOTE_SQL = String.raw`(could not be read|not been read yet), so anything printed only there is not available\.`;
/** A failed read of either kind (lib/policies/read-failures.ts READ_FAILURE_KEYS): the Documents page shows the latest
 * of both as "Benefits not read yet", so both count here (a read resting until its retry time counted 1 of 4, design
 * review 2). `$4` is the list of keys. */
const FAILED_READ_SQL = (cache: boolean) => cache ? "p.reading_cache ?| $4::text[]" : "($4::text[] IS NULL AND false)";
/** The reading-did-not-finish rule (the caller adds activePredicate inline, where the lifecycle guard reads it) shared by a person's count and the household's unlinked "Not sure" uploads.
 * Parameters: $1 account, $3 read-in-part notes (exact, or followed by more text), $4 benefit read failure key, $5 no-cover roles, $6 Read again ids,
 * $7 scan-goes-on states, $8 unread ids. */
const NOT_FULLY_READ = (cache: boolean) => `p.account_id=$1 AND p.superseded_at IS NULL
          AND (p.id::text=ANY($6::text[]) OR (NOT (coalesce(p.document_role,'')=ANY($5::text[])) AND (
            p.id::text=ANY($8::text[]) OR p.processing_status='failed'
            OR (p.processing_status IN ('uploaded','queued','extracting','indexing') AND (p.updated_at<=now()-interval '30 minutes'
              OR NOT (coalesce(p.quarantine_status,'')=ANY($7::text[]))))
            OR (p.processing_status='ready' AND (p.processing_message ~ '^Read in part\\M' OR p.processing_message ~ '${UNREAD_PAGE_NOTE_SQL}' OR EXISTS(SELECT 1 FROM unnest($3::text[]) AS note(m) WHERE p.processing_message=note.m OR left(p.processing_message,length(note.m)+1)=note.m||' ')
              OR NOT EXISTS(SELECT 1 FROM policy_pages pp WHERE pp.policy_id=p.id AND pp.account_id=p.account_id)
              OR ${FAILED_READ_SQL(cache)})))))`;
/** Of those, a document whose cover was read and only some amounts could not be checked ("Read in part." alone): its kinds
 * of cover are known. Every other not-fully-read document may hold a kind of cover nothing shows yet. */
const KINDS_KNOWN = (cache: boolean) => `(p.processing_status='ready' AND p.processing_message ~ '^Read in part\\M' AND p.processing_message !~ '${UNREAD_PAGE_NOTE_SQL}'
          AND NOT p.id::text=ANY($6::text[]) AND NOT p.id::text=ANY($8::text[]) AND NOT coalesce(${FAILED_READ_SQL(cache)},false)
          AND EXISTS(SELECT 1 FROM policy_pages pp WHERE pp.policy_id=p.id AND pp.account_id=p.account_id))`;

/** `owner` limits the rows to whose documents they are ($2 is the person, or null for the household's unowned ones). */
async function unread(accountId: string, owner: (cache: boolean) => string | null, member: string | null, tableDocuments: { id: string; state: string }[]): Promise<NotFullyRead> {
  try {
    const cache = await readingCacheReady();
    const who = owner(cache);
    if (!who) return { count: 0, names: [], ids: [], coverUnknown: 0 };
    // Waiting for Read again holds cover whatever its stored role (a misfiled pack); the other states follow the role rule.
    const readAgain = tableDocuments.filter((d) => d.state === "table_unread").map((d) => d.id);
    const unreadIds = tableDocuments.filter((d) => UNREAD_STATES.has(d.state)).map((d) => d.id);
    const rows = await query<{ id: string; product_name: string | null; original_filename: string | null; insurer: string | null; document_role: string | null; policy_number: string | null; kinds_known: boolean }>(
      `SELECT p.id::text AS id,${KINDS_KNOWN(cache)} AS kinds_known,p.product_name,p.original_filename,p.insurer,p.document_role,p.policy_number FROM policies p
        WHERE ${activePredicate("p")} AND ${NOT_FULLY_READ(cache)} AND ${who}
        ORDER BY p.created_at`,
      [accountId, member, [...DOCUMENT_READ_IN_PART_MESSAGES], cache ? [...READ_FAILURE_KEYS] : null, [...NO_COVER_READING_ROLES], readAgain, [...SCAN_GOES_ON], unreadIds]);
    return { count: rows.rows.length, names: rows.rows.map((r) => documentCardTitle(r)), ids: rows.rows.map((r) => r.id), coverUnknown: rows.rows.filter((r) => r.kinds_known !== true).length };
  } catch (error) {
    console.warn("Could not count documents not fully read:", error instanceof Error ? error.message : error);
    return { count: 0, names: [], ids: [], coverUnknown: 0 };
  }
}

export async function notFullyRead(accountId: string, familyMemberId: string, tableDocuments: { id: string; state: string }[] = []): Promise<NotFullyRead> {
  return unread(accountId, (cache) => OWNED_BY_MEMBER("$2", cache), familyMemberId, tableDocuments);
}

/** Uploads whose person was "Not sure" and that nobody is linked to yet (nobody's, so no person counts them) whose
 * reading did not finish. Home names them once for the household, so a failed or stalled one never vanishes. */
export async function unownedNotFullyRead(accountId: string, tableDocuments: { id: string; state: string }[] = []): Promise<NotFullyRead> {
  return unread(accountId, (cache) => cache ? `$2::uuid IS NULL AND coalesce(p.reading_cache ? '${UNSURE_KEY}',false)
          AND NOT EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id)` : null, null, tableDocuments);
}

/** The line a "Not found" tile (short) or Coverage answer adds when some of the person's documents were not fully read. */
export function notFullyReadNote(n: Pick<NotFullyRead, "count">, person: string, short = false): string | null {
  if (!n.count) return null;
  const head = `${n.count === 1 ? "One" : n.count} of ${person}’s documents ${n.count === 1 ? "was" : "were"} not fully read`;
  return short ? head + "." : `${head}, so cover in ${n.count === 1 ? "it" : "them"} may be missing here. Documents shows which and what to do.`;
}
