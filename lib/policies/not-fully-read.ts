import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import { DOCUMENT_READ_IN_PART_MESSAGE } from "@/lib/documents/processing-errors";
import { BENEFIT_READ_FAILURE_KEY, readingCacheReady } from "@/lib/policies/read-failures";
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
export type NotFullyRead = { count: number; names: string[]; ids: string[] };
/** Benefit-table states that mean the document's cover was not read (lib/benefit-table/service.ts documentState). */
const UNREAD_STATES = new Set(["stalled", "held", "not_readable", "table_unread"]);
/** The person's own documents: linked to them, or uploaded for them and linked to no one. `p` is the policies alias. */
/** `cache`: the policies.reading_cache column exists (readingCacheReady). Then an upload whose person was "Not sure"
 * (lib/policies/upload-owner.ts) and that nobody is linked to yet is nobody's: its placeholder owner never counts. */
export const OWNED_BY_MEMBER = (member: string, cache = false) => `(EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=${member})
  OR (p.family_member_id=${member} AND NOT EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id)${cache ? ` AND NOT coalesce(p.reading_cache ? '${UNSURE_KEY}',false)` : ""}))`;

/** The reading-did-not-finish rule shared by a person's count and the household's unlinked "Not sure" uploads.
 * Parameters: $1 account, $3 read-in-part note, $4 benefit read failure key, $5 no-cover roles, $6 Read again ids,
 * $7 scan-goes-on states, $8 unread ids. */
const NOT_FULLY_READ = (cache: boolean) => `p.account_id=$1 AND ${activePredicate("p")} AND p.superseded_at IS NULL
          AND (p.id::text=ANY($6::text[]) OR (NOT (coalesce(p.document_role,'')=ANY($5::text[])) AND (
            p.id::text=ANY($8::text[]) OR p.processing_status='failed'
            OR (p.processing_status IN ('uploaded','queued','extracting','indexing') AND (p.updated_at<=now()-interval '30 minutes'
              OR NOT (coalesce(p.quarantine_status,'')=ANY($7::text[]))))
            OR (p.processing_status='ready' AND (p.processing_message ~ '^Read in part\\M' OR p.processing_message=$3
              OR NOT EXISTS(SELECT 1 FROM policy_pages pp WHERE pp.policy_id=p.id AND pp.account_id=p.account_id)
              ${cache ? "OR p.reading_cache ? $4" : "OR ($4::text IS NULL AND false)"})))))`;

/** `owner` limits the rows to whose documents they are ($2 is the person, or null for the household's unowned ones). */
async function unread(accountId: string, owner: (cache: boolean) => string | null, member: string | null, tableDocuments: { id: string; state: string }[]): Promise<NotFullyRead> {
  try {
    const cache = await readingCacheReady();
    const who = owner(cache);
    if (!who) return { count: 0, names: [], ids: [] };
    // Waiting for Read again holds cover whatever its stored role (a misfiled pack); the other states follow the role rule.
    const readAgain = tableDocuments.filter((d) => d.state === "table_unread").map((d) => d.id);
    const unreadIds = tableDocuments.filter((d) => UNREAD_STATES.has(d.state)).map((d) => d.id);
    const rows = await query<{ id: string; product_name: string | null; original_filename: string | null; insurer: string | null; document_role: string | null; policy_number: string | null }>(
      `SELECT p.id::text AS id,p.product_name,p.original_filename,p.insurer,p.document_role,p.policy_number FROM policies p
        WHERE ${NOT_FULLY_READ(cache)} AND ${who}
        ORDER BY p.created_at`,
      [accountId, member, DOCUMENT_READ_IN_PART_MESSAGE, cache ? BENEFIT_READ_FAILURE_KEY : "", [...NO_COVER_READING_ROLES], readAgain, [...SCAN_GOES_ON], unreadIds]);
    return { count: rows.rows.length, names: rows.rows.map((r) => documentCardTitle(r)), ids: rows.rows.map((r) => r.id) };
  } catch (error) {
    console.warn("Could not count documents not fully read:", error instanceof Error ? error.message : error);
    return { count: 0, names: [], ids: [] };
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
