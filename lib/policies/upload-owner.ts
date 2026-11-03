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
import { activePredicate } from "@/lib/lifecycle/scopes";

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

/** The person chosen at upload ("Who is this for?"), kept as it was chosen. The document's owner can change later (a
 * printed name matched to someone else, or the household moving it), so the card can say when the printed names
 * override this choice (new-household audit, 3 Nov, defect 1: "uploaded for Bella", printed Alex, moved silently). */
export const CHOSEN_KEY = "upload_owner_chosen";

/** Notes who was chosen for this upload. Never throws: without the note the card simply shows no override line. */
export async function noteOwnerChosen(accountId: string, policyId: string, familyMemberId: string): Promise<void> {
  try {
    if (!await readingCacheReady()) return;
    await query(
      `UPDATE policies SET reading_cache=coalesce(reading_cache,'{}'::jsonb)||jsonb_build_object($3::text,jsonb_build_object('member',$4::text,'at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
        WHERE id=$1 AND account_id=$2`,
      [policyId, accountId, CHOSEN_KEY, familyMemberId]);
  } catch { /* the document is kept; the card shows no override line */ }
}

/** A document split out of an upload (one policy among several in a file) keeps the choice made for that file. */
export async function copyOwnerChosen(accountId: string, fromPolicyId: string, toPolicyId: string): Promise<void> {
  try {
    if (!await readingCacheReady()) return;
    await query(
      `UPDATE policies part SET reading_cache=coalesce(part.reading_cache,'{}'::jsonb)||jsonb_build_object($4::text,src.reading_cache->$4::text)
         FROM policies src WHERE part.id=$3 AND part.account_id=$1 AND src.id=$2 AND src.account_id=$1 AND ${activePredicate("src")} AND src.reading_cache ? $4::text`,
      [accountId, fromPolicyId, toPolicyId, CHOSEN_KEY]);
  } catch { /* the part shows no override line */ }
}
