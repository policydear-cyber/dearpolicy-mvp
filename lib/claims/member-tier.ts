/**
 * Round 5: a multi-column benefit table (Adult / Child, Plan A / Plan B)
 * gives one row per column; each row carries its column as `tier`
 * (policy_benefits.tier, read by the ingest owner) and each insured person
 * their column as policy_members.benefit_tier. A child gets the Child
 * column's amount, never the adult's. A person whose tier is not known keeps
 * every column (nothing is guessed); a row with no tier applies to everyone.
 *
 * The rules themselves are the ingest ones (tierApplies / selectTierRows in
 * lib/policies/benefit-catalog.ts): one implementation for reading, answers
 * and claims.
 */
import { query } from "@/lib/db/client";
import { selectTierRows, tierApplies } from "@/lib/policies/benefit-catalog";

export function rowTierApplies(rowTier: string | null | undefined, memberTier: string | null | undefined) {
  return tierApplies(rowTier, memberTier);
}
type TieredRow = { policyId: string; benefitName: string; sourcePage: number | null };
/** The rows that apply to one person: when a table row's columns include the
 * person's own, the other columns of that row are dropped. */
export function rowsForMember<T extends TieredRow>(rows: T[], memberTier: (policyId: string) => string | null | undefined): T[] {
  return selectTierRows(rows as (T & { tier?: string | null })[], memberTier);
}
/** policy_members.benefit_tier for this household, keyed "policyId|memberId".
 * Empty when the column does not exist yet (before the ingest change). */
export async function loadMemberTiers(accountId: string): Promise<Map<string, string | null>> {
  try {
    const rows = (await query<{ policy_id: string; family_member_id: string; tier: string | null }>(
      "SELECT policy_id::text,family_member_id::text,to_jsonb(pm)->>'benefit_tier' AS tier FROM policy_members pm WHERE account_id=$1", [accountId])).rows;
    return new Map(rows.map((r) => [r.policy_id + "|" + r.family_member_id, r.tier]));
  } catch { return new Map(); }
}
