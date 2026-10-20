import { query } from "@/lib/db/client";
import { withServiceTransaction } from "@/lib/db/authz-client";
import { exclusionsReady } from "@/lib/policies/member-exclusions";
import { findFamilyMatch, syncInsuredPersonToMember } from "@/lib/policies/linking";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";

/** Links the "who does this cover" picker does not show as covered. */
export const NOT_SHOWN_AS_COVERED = ["scheme_reference_match"];

export type CoverageSave = { assigned: number; removed: string[]; added: string[]; linked: string[] };

/** Saves who one document covers, as the household set it in the picker.
 *
 * The caller has already authorised the document and every person against
 * the household (app/api/policies/link-person, through the RLS-scoped
 * client). This writes in ONE service transaction, every statement scoped by
 * that household, because part of it is server-written (policy_coverages,
 * policies.family_member_id) and a half-done removal would leave the chat
 * answering for the removed person:
 * - each ticked person is linked (user_declared) with their tier, and any
 *   remembered removal of them is forgotten;
 * - everyone else the picker showed as covered is unlinked, with what was read
 *   from this document for them (coverage rows, premium records, ledger rows
 *   read from the wording; the household's own ledger entries stay), and the
 *   removal is remembered so a re-read does not bring them back;
 * - the upload profile moves to someone still covered, because the chat
 *   treats that person as covered by the document. */
export async function saveDocumentCoverage(args: {
  accountId: string; policyId: string; ownerId: string;
  assignments: { familyMemberId: string; tier: string | null }[];
}): Promise<CoverageSave> {
  const ids = args.assignments.map((a) => a.familyMemberId);
  const remember = await exclusionsReady();
  return withServiceTransaction(async (client) => {
    const before = new Set((await client.query<{ family_member_id: string }>(
      `SELECT family_member_id::text AS family_member_id FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND NOT (source=ANY($3::text[]))`,
      [args.policyId, args.accountId, NOT_SHOWN_AS_COVERED])).rows.map((r) => r.family_member_id));
    for (const a of args.assignments) {
      await client.query(
        `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier)
         VALUES($1,$2,$3,'user_declared',1.0,$4)
         ON CONFLICT(policy_id,family_member_id) DO UPDATE SET benefit_tier=EXCLUDED.benefit_tier`,
        [args.policyId, a.familyMemberId, args.accountId, a.tier],
      );
    }
    if (remember) await client.query(`DELETE FROM policy_member_exclusions WHERE policy_id=$1 AND account_id=$2 AND family_member_id=ANY($3::uuid[])`, [args.policyId, args.accountId, ids]);
    const removed = (await client.query<{ family_member_id: string }>(
      `DELETE FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND NOT (source=ANY($4::text[])) AND NOT (family_member_id=ANY($3::uuid[]))
       RETURNING family_member_id::text AS family_member_id`,
      [args.policyId, args.accountId, ids, NOT_SHOWN_AS_COVERED],
    )).rows.map((r) => r.family_member_id);
    if (removed.length) {
      const scope = [args.accountId, args.policyId, removed];
      await client.query(`DELETE FROM policy_coverages WHERE account_id=$1 AND policy_id=$2 AND family_member_id=ANY($3::uuid[])`, scope);
      await client.query(`DELETE FROM premium_records WHERE account_id=$1 AND source_document_id=$2 AND family_member_id=ANY($3::uuid[])`, scope);
      await client.query(`UPDATE policy_detected_people SET matched_family_member_id=NULL WHERE account_id=$1 AND policy_id=$2 AND matched_family_member_id=ANY($3::uuid[])`, scope);
      if ((await client.query<{ t: string | null }>("SELECT to_regclass('public.coverage_rules')::text AS t")).rows[0]?.t) {
        await client.query(`DELETE FROM coverage_rules WHERE account_id=$1 AND policy_id=$2 AND family_member_id=ANY($3::uuid[]) AND origin<>'person'`, scope);
      }
      if (remember) {
        await client.query(
          `INSERT INTO policy_member_exclusions(policy_id,family_member_id,account_id) SELECT $2,unnest($3::uuid[]),$1 ON CONFLICT DO NOTHING`, scope);
      }
    }
    if (!ids.includes(args.ownerId)) {
      await client.query(`UPDATE policies SET family_member_id=$3,updated_at=now() WHERE id=$1 AND account_id=$2`, [args.policyId, args.accountId, ids[0]]);
    }
    const linked = (await client.query<{ family_member_id: string }>(
      `SELECT family_member_id::text AS family_member_id FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND NOT (source=ANY($3::text[])) ORDER BY family_member_id`,
      [args.policyId, args.accountId, NOT_SHOWN_AS_COVERED])).rows.map((r) => r.family_member_id);
    return { assigned: ids.length, removed, added: ids.filter((id) => !before.has(id)), linked };
  });
}

/** Rebuilds what is read from a document for people just ticked on it, so
 * removing someone and ticking them again restores their cover without a
 * re-analysis: their own coverage and premium rows when the document names
 * them (from the stored reading, no model call), and their ledger rows (the
 * document is marked for the ledger's next read, which only adds rows). */
export async function rebuildForAddedPeople(args: { accountId: string; policyId: string; added: string[]; extraction: PolicyExtraction | null }): Promise<void> {
  if (!args.added.length) return;
  const family = (await query<{ id: string; display_name: string; preferred_name: string | null }>(
    `SELECT id::text AS id,display_name,preferred_name FROM family_members WHERE account_id=$1`, [args.accountId])).rows;
  for (const person of args.extraction?.insuredPeople ?? []) {
    const match = findFamilyMatch(person.name, family);
    if (!match || !args.added.includes(match.id)) continue;
    await syncInsuredPersonToMember({ accountId: args.accountId, sourcePolicyId: args.policyId, familyMemberId: match.id, detectedName: person.name,
      extraction: args.extraction!, link: { source: "user_declared", confidence: 1.0 } });
  }
  await query(`UPDATE policies SET ledger_read_at=NULL WHERE id=$1 AND account_id=$2 AND ledger_read_at IS NOT NULL`, [args.policyId, args.accountId])
    .catch(() => undefined);
}
