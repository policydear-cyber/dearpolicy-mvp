import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import { DOCUMENT_READ_IN_PART_MESSAGES } from "@/lib/documents/processing-errors";
import { BENEFIT_READ_FAILURE_KEY, readingCacheReady } from "@/lib/policies/read-failures";
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
export const OWNED_BY_MEMBER = (member: string) => `(EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=${member})
  OR (p.family_member_id=${member} AND NOT EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id)))`;

export async function notFullyRead(accountId: string, familyMemberId: string, tableDocuments: { id: string; state: string }[] = []): Promise<NotFullyRead> {
  try {
    const cache = await readingCacheReady();
    // Waiting for Read again holds cover whatever its stored role (a misfiled pack); the other states follow the role rule.
    const readAgain = tableDocuments.filter((d) => d.state === "table_unread").map((d) => d.id);
    const unread = tableDocuments.filter((d) => UNREAD_STATES.has(d.state)).map((d) => d.id);
    const rows = await query<{ id: string; product_name: string | null; original_filename: string | null; insurer: string | null; document_role: string | null; policy_number: string | null }>(
      `SELECT p.id::text AS id,p.product_name,p.original_filename,p.insurer,p.document_role,p.policy_number FROM policies p
        WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.superseded_at IS NULL AND ${OWNED_BY_MEMBER("$2")}
          AND (p.id::text=ANY($6::text[]) OR (NOT (coalesce(p.document_role,'')=ANY($5::text[])) AND (
            p.id::text=ANY($8::text[]) OR p.processing_status='failed'
            OR (p.processing_status IN ('uploaded','queued','extracting','indexing') AND (p.updated_at<=now()-interval '30 minutes'
              OR NOT (coalesce(p.quarantine_status,'')=ANY($7::text[]))))
            OR (p.processing_status='ready' AND (p.processing_message ~ '^Read in part\\M' OR EXISTS(SELECT 1 FROM unnest($3::text[]) AS note(m) WHERE p.processing_message=note.m OR left(p.processing_message,length(note.m)+1)=note.m||' ')
              OR NOT EXISTS(SELECT 1 FROM policy_pages pp WHERE pp.policy_id=p.id AND pp.account_id=p.account_id)
              ${cache ? "OR p.reading_cache ? $4" : "OR ($4::text IS NULL AND false)"})))))
        ORDER BY p.created_at`,
      [accountId, familyMemberId, [...DOCUMENT_READ_IN_PART_MESSAGES], cache ? BENEFIT_READ_FAILURE_KEY : "", [...NO_COVER_READING_ROLES], readAgain, [...SCAN_GOES_ON], unread]);
    return { count: rows.rows.length, names: rows.rows.map((r) => documentCardTitle(r)), ids: rows.rows.map((r) => r.id) };
  } catch (error) {
    console.warn("Could not count documents not fully read:", error instanceof Error ? error.message : error);
    return { count: 0, names: [], ids: [] };
  }
}

/** The line a "Not found" tile (short) or Coverage answer adds when some of the person's documents were not fully read. */
export function notFullyReadNote(n: Pick<NotFullyRead, "count">, person: string, short = false): string | null {
  if (!n.count) return null;
  const head = `${n.count === 1 ? "One" : n.count} of ${person}’s documents ${n.count === 1 ? "was" : "were"} not fully read`;
  return short ? head + "." : `${head}, so cover in ${n.count === 1 ? "it" : "them"} may be missing here. Documents shows which and what to do.`;
}
