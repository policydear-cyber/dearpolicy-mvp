import { query } from "@/lib/db/client";

/** Policies the household says it did not renew (sql/policy-not-renewed.sql; DC 19 Nov 2026). The household's own statement
 * about one printed end date of one person's policy: never an insurer's fact, and taken back by deleting the row. Optional
 * table: every reader checks it exists first, and nothing changes until it does. */

let ready: Promise<boolean> | null = null;
export function notRenewedReady(): Promise<boolean> {
  ready ??= query<{ t: string | null }>("SELECT to_regclass('public.policy_not_renewed')::text AS t")
    .then((r) => !!r.rows[0]?.t).catch(() => false)
    // Only a present table is remembered, so applying the file needs no restart.
    .then((ok) => { if (!ok) ready = null; return ok; });
  return ready;
}
/** For tests: forget whether the table exists. */
export function resetNotRenewedReady() { ready = null; }

/** A key for one answer: the policy and the printed end date it was about. */
export const notRenewedKey = (contractKey: string, endsOn: string) => `${contractKey}|${endsOn.slice(0, 10)}`;

export type NotRenewedRow = { family_member_id: string; contract_key: string; ends_on: string; said_at: string };
/** The household's answers, for some people (all when `memberIds` is omitted). Empty before the table exists. */
export async function notRenewedRows(accountId: string, memberIds?: string[]): Promise<NotRenewedRow[]> {
  if (!(await notRenewedReady())) return [];
  const r = await query<NotRenewedRow>(
    `SELECT family_member_id::text AS family_member_id,contract_key,ends_on::text AS ends_on,said_at::text AS said_at FROM policy_not_renewed
      WHERE account_id=$1${memberIds ? " AND family_member_id=ANY($2::uuid[])" : ""}`, memberIds ? [accountId, memberIds] : [accountId]);
  return r.rows;
}

export class NotRenewedUnavailable extends Error {}
/** Records or takes back "I didn't renew it". The person must be the household's own (the trigger checks it too). */
export async function setNotRenewed(args: { accountId: string; memberId: string; contractKey: string; endsOn: string; userId: string; notRenewed: boolean }) {
  if (!(await notRenewedReady())) throw new NotRenewedUnavailable("not ready");
  if (args.notRenewed)
    await query(`INSERT INTO policy_not_renewed(account_id,family_member_id,contract_key,ends_on,said_by)
      SELECT $1,f.id,$3,$4::date,$5 FROM family_members f WHERE f.id=$2 AND f.account_id=$1
      ON CONFLICT (account_id,family_member_id,contract_key,ends_on) DO UPDATE SET said_at=now(),said_by=EXCLUDED.said_by`,
    [args.accountId, args.memberId, args.contractKey, args.endsOn, args.userId]);
  else await query("DELETE FROM policy_not_renewed WHERE account_id=$1 AND family_member_id=$2 AND contract_key=$3 AND ends_on=$4::date",
    [args.accountId, args.memberId, args.contractKey, args.endsOn]);
}
