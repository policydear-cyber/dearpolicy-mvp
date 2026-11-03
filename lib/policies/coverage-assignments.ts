import { query } from "@/lib/db/client";
import { withServiceTransaction } from "@/lib/db/authz-client";
import { exclusionsReady } from "@/lib/policies/member-exclusions";
import { findFamilyMatch, syncInsuredPersonToMember } from "@/lib/policies/linking";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";
import { activePredicate } from "@/lib/lifecycle/scopes";

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
         ON CONFLICT(policy_id,family_member_id) DO UPDATE SET benefit_tier=EXCLUDED.benefit_tier,source='user_declared',confidence=1.0`,
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
    `SELECT id::text AS id,display_name,preferred_name FROM family_members WHERE account_id=$1 AND ${activePredicate()}`, [args.accountId])).rows;
  for (const person of args.extraction?.insuredPeople ?? []) {
    const match = findFamilyMatch(person.name, family);
    if (!match || !args.added.includes(match.id)) continue;
    await syncInsuredPersonToMember({ accountId: args.accountId, sourcePolicyId: args.policyId, familyMemberId: match.id, detectedName: person.name,
      extraction: args.extraction!, link: { source: "user_declared", confidence: 1.0 } });
  }
  await query(`UPDATE policies SET ledger_read_at=NULL WHERE id=$1 AND account_id=$2 AND ledger_read_at IS NOT NULL`, [args.policyId, args.accountId])
    .catch(() => undefined);
}

/** Moves one printed name on a document from the person it is matched to, to `to` (someone else in the family), or to
 * nobody ("Not in my family"), as the household said on the Documents page (audit 3 Nov: a name matched by part of it,
 * "Wei Ming" for "Chen Wei Ming", could not be corrected on a personal document).
 *
 * The caller has authorised the document, the name and `to` against the household. In ONE service transaction, every
 * statement scoped by that household:
 * - the person the name was matched to is taken off the document with what was read from it for them, as the picker
 *   does (saveDocumentCoverage), and the removal is remembered, unless another printed name there is still theirs;
 * - for nobody, the name is remembered as not the family's (policy_name_dismissals), so a re-read does not match it;
 * - the upload profile moves to someone still covered (the chat treats that person as covered by the document).
 * The caller then links `to` from the stored reading (syncInsuredPersonToMember, user_declared), which a re-read keeps.
 * Moving the only name to nobody would leave the document covering no one: refused (NobodyWouldBeLeft). */
export class NobodyWouldBeLeft extends Error {}
export async function moveDetectedName(args: { accountId: string; policyId: string; detectedName: string; to: string | null }): Promise<{ from: string | null; removed: string[] }> {
  const remember = await exclusionsReady();
  return withServiceTransaction(async (client) => {
    const key = `lower(regexp_replace(btrim($3),'\\s+',' ','g'))`;
    const named = (await client.query<{ detected_name: string; matched: string | null }>(
      `SELECT detected_name, matched_family_member_id::text AS matched FROM policy_detected_people
        WHERE account_id=$1 AND policy_id=$2 AND lower(regexp_replace(btrim(detected_name),'\\s+',' ','g'))=${key}`,
      [args.accountId, args.policyId, args.detectedName])).rows;
    const from = named.find((r) => r.matched)?.matched ?? null;
    if (from === args.to) return { from, removed: [] };
    // Is the person still named on this document under another printed name? Then their link stays.
    const elsewhere = from ? (await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM policy_detected_people WHERE account_id=$1 AND policy_id=$2 AND matched_family_member_id=$4
          AND lower(regexp_replace(btrim(detected_name),'\\s+',' ','g'))<>${key}`,
      [args.accountId, args.policyId, args.detectedName, from])).rows[0]?.n ?? 0 : 0;
    const takeOff = from && !elsewhere ? [from] : [];
    if (!args.to) {
      const left = (await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND NOT (source=ANY($3::text[])) AND NOT (family_member_id=ANY($4::uuid[]))`,
        [args.policyId, args.accountId, NOT_SHOWN_AS_COVERED, takeOff])).rows[0]?.n ?? 0;
      if (!left) throw new NobodyWouldBeLeft();
    }
    await client.query(
      `UPDATE policy_detected_people SET matched_family_member_id=NULL WHERE account_id=$1 AND policy_id=$2 AND lower(regexp_replace(btrim(detected_name),'\\s+',' ','g'))=${key}`,
      [args.accountId, args.policyId, args.detectedName]);
    if (takeOff.length) {
      const scope = [args.accountId, args.policyId, takeOff];
      await client.query(`DELETE FROM policy_members WHERE account_id=$1 AND policy_id=$2 AND family_member_id=ANY($3::uuid[]) AND NOT (source=ANY($4::text[]))`, [...scope, NOT_SHOWN_AS_COVERED]);
      await client.query(`DELETE FROM policy_coverages WHERE account_id=$1 AND policy_id=$2 AND family_member_id=ANY($3::uuid[])`, scope);
      await client.query(`DELETE FROM premium_records WHERE account_id=$1 AND source_document_id=$2 AND family_member_id=ANY($3::uuid[])`, scope);
      if ((await client.query<{ t: string | null }>("SELECT to_regclass('public.coverage_rules')::text AS t")).rows[0]?.t) {
        await client.query(`DELETE FROM coverage_rules WHERE account_id=$1 AND policy_id=$2 AND family_member_id=ANY($3::uuid[]) AND origin<>'person'`, scope);
      }
      if (remember) await client.query(`INSERT INTO policy_member_exclusions(policy_id,family_member_id,account_id) SELECT $2,unnest($3::uuid[]),$1 ON CONFLICT DO NOTHING`, scope);
    }
    if (args.to && remember) await client.query(`DELETE FROM policy_member_exclusions WHERE policy_id=$1 AND account_id=$2 AND family_member_id=$3`, [args.policyId, args.accountId, args.to]);
    if (!args.to && (await client.query<{ t: string | null }>("SELECT to_regclass('public.policy_name_dismissals')::text AS t")).rows[0]?.t) {
      await client.query(`INSERT INTO policy_name_dismissals(policy_id,account_id,name_key,detected_name) VALUES($2,$1,${key},$3) ON CONFLICT(policy_id,name_key) DO NOTHING`,
        [args.accountId, args.policyId, args.detectedName]);
    }
    // The upload profile follows the document: to the new person, or to someone still covered. That includes a profile
    // the document never covered (a "Not sure" upload falls back to the account holder), since the chat reads it as covered.
    const owner = (await client.query<{ id: string; covered: boolean }>(
      `SELECT p.family_member_id::text AS id, EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id
          AND pm.family_member_id=p.family_member_id AND NOT (pm.source=ANY($3::text[]))) AS covered
         FROM policies p WHERE p.id=$1 AND p.account_id=$2`, [args.policyId, args.accountId, NOT_SHOWN_AS_COVERED])).rows[0];
    if (owner?.id && (takeOff.includes(owner.id) || (!owner.covered && owner.id !== args.to))) {
      const next = args.to ?? (await client.query<{ id: string }>(
        `SELECT family_member_id::text AS id FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND NOT (source=ANY($3::text[])) ORDER BY confidence DESC, family_member_id LIMIT 1`,
        [args.policyId, args.accountId, NOT_SHOWN_AS_COVERED])).rows[0]?.id;
      if (next) await client.query(`UPDATE policies SET family_member_id=$3,updated_at=now() WHERE id=$1 AND account_id=$2`, [args.policyId, args.accountId, next]);
    }
    return { from, removed: takeOff };
  });
}
