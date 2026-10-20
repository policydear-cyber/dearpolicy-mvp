import { query } from "@/lib/db/client";

/** Remembered removals (sql/policy-member-exclusions.sql): pairs of document
 * and person the household said the document does not cover. Every automatic
 * link writer (a printed name, the upload profile, matching wording) skips
 * them, so a removal survives re-reading the document. Until that file is
 * applied the table is absent and nothing is skipped, exactly as before. */
let ready: Promise<boolean> | null = null;
export function exclusionsReady(): Promise<boolean> {
  ready ??= query<{ t: string | null }>("SELECT to_regclass('public.policy_member_exclusions')::text AS t")
    .then((r) => !!r.rows[0]?.t).catch(() => false)
    // Only a present table is remembered: once the file is applied, a warm
    // server starts honouring it without a restart. (After a rollback that
    // drops the table, restart or redeploy so servers stop using it.)
    .then((ok) => { if (!ok) ready = null; return ok; });
  return ready;
}

/** " AND NOT EXISTS(...)" for an automatic link of (household, policy, member), or "" before the table exists. */
export async function notExcludedClause(accountExpr: string, policyExpr: string, memberExpr: string): Promise<string> {
  if (!await exclusionsReady()) return "";
  return ` AND NOT EXISTS (SELECT 1 FROM policy_member_exclusions x WHERE x.account_id=${accountExpr} AND x.policy_id=${policyExpr} AND x.family_member_id=${memberExpr})`;
}

export async function isExcluded(accountId: string, policyId: string, familyMemberId: string): Promise<boolean> {
  if (!await exclusionsReady()) return false;
  const r = await query("SELECT 1 FROM policy_member_exclusions WHERE account_id=$1 AND policy_id=$2 AND family_member_id=$3", [accountId, policyId, familyMemberId]);
  return r.rows.length > 0;
}
