/**
 * "Not sure" at upload ("Who is this for?" left empty): the document is filed under the household's first person only
 * because a document row needs an owner (accept.ts resolveUploadFamilyMember). That placeholder is not the household's
 * choice, so it must not make the document count as that person's while no one is linked to it: Home said "4 of Alex's
 * documents were not fully read" when Alex had 2 (new-household audit, 3 Nov, defect 3).
 *
 * The upload records the choice as a note in the document's reading_cache (UNSURE_KEY). Documents uploaded before this
 * note existed carry none and count as before. Fails safe: a note that cannot be written leaves the old behaviour.
 */
import { query } from "@/lib/db/client";
import { readingCacheReady } from "@/lib/policies/read-failures";

export const UNSURE_KEY = "upload_owner_unsure";

/** Notes that nobody was chosen for this upload. Never throws. */
export async function noteOwnerUnsure(accountId: string, policyId: string): Promise<void> {
  try {
    if (!await readingCacheReady()) return;
    await query(
      `UPDATE policies SET reading_cache=coalesce(reading_cache,'{}'::jsonb)||jsonb_build_object($3::text,jsonb_build_object('at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
        WHERE id=$1 AND account_id=$2`,
      [policyId, accountId, UNSURE_KEY]);
  } catch { /* the document is kept; it only counts as before */ }
}
