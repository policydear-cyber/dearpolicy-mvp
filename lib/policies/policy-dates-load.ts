import { createHash } from "node:crypto";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { loadPolicyInventory } from "@/lib/policies/inventory";
import { singaporeDay } from "@/lib/benefit-table/dates";
import { householdPolicyDates, type DatedCover, type PaymentRecord, type PolicyDate } from "@/lib/policies/policy-dates";
import { notRenewedKey, notRenewedReady, notRenewedRows } from "@/lib/policies/not-renewed";

/** One person's policy dates from stored documents, readings, premium records and the household's "I didn't renew it"
 * answers (lib/policies/policy-dates.ts). No model call. `member` null: the household's first person. */
/** The page's key for a policy: a hash of its inventory key, so a policy number never travels as an id (and the ID-number
 * mask can never change it). `contractKeys` maps it back on the server. */
export const pageKey = (contractKey: string) => createHash("sha256").update(contractKey).digest("hex").slice(0, 24);
export async function loadPolicyDates(accountId: string, memberId: string | null): Promise<{ memberId: string | null; policies: PolicyDate[]; answersReady: boolean; contractKeys: Map<string, string> }> {
  const people = (await query<{ id: string; display_name: string; preferred_name: string | null; relationship: string }>(
    `SELECT id,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 AND ${activePredicate()} ORDER BY created_at`, [accountId])).rows;
  const member = people.find((p) => p.id === memberId) ?? (memberId ? undefined : people[0]);
  if (!member) return { memberId: null, policies: [], answersReady: false, contractKeys: new Map() };
  const inventory = await loadPolicyInventory(accountId, [member]);
  const contracts = inventory.contracts.filter((c) => c.ownerId === member.id);
  // The person's own cover lines and their printed dates, from the benefit table when it is live.
  let covers: DatedCover[] = [];
  try {
    const { benefitTableLive, appDb } = await import("@/lib/benefit-table/app");
    if (await benefitTableLive(accountId)) {
      const { tableFor } = await import("@/lib/benefit-table/service");
      const person = (await tableFor(appDb, accountId)).table.people.find((p) => p.id === member.id);
      covers = (person?.covers ?? []).map((c) => ({ documentId: c.source.documentId, name: c.cover || c.product || "", startDate: c.startDate ?? null, endDate: c.endDate ?? null, page: c.source.page ?? null }));
    }
  } catch (error) { console.warn("Benefit table unavailable for policy dates:", error instanceof Error ? error.message : error); }
  const payments = (await query<PaymentRecord>(
    `SELECT pr.policy_id::text AS policy_id,pr.source_document_id::text AS source_document_id,pr.family_member_id::text AS family_member_id,pr.insurer,pr.policy_number,
            pr.payment_date::text AS payment_date,pr.period_start::text AS period_start,pr.period_end::text AS period_end,pr.created_at::text AS created_at
       FROM premium_records pr WHERE pr.account_id=$1 AND (pr.family_member_id IS NULL OR pr.family_member_id=$2)`, [accountId, member.id])).rows;
  const answers = new Set((await notRenewedRows(accountId, [member.id])).map((r) => notRenewedKey(r.contract_key, r.ends_on)));
  const contractKeys = new Map(contracts.map((c) => [pageKey(c.id), c.id]));
  const policies = householdPolicyDates(contracts, covers, payments, singaporeDay(new Date()), answers).map((p) => ({ ...p, key: pageKey(p.key) }));
  return { memberId: member.id, policies, answersReady: await notRenewedReady(), contractKeys };
}

/** The documents of a person's policies the household said it did not renew (still with no renewal evidence after that
 * date): Home's cards leave them out of current cover. Empty, with no further reads, when the household has said so of none
 * of this person's policies. */
export async function notRenewedDocumentIds(accountId: string, memberId: string): Promise<Set<string>> {
  if (!(await notRenewedRows(accountId, [memberId])).length) return new Set();
  const { policies } = await loadPolicyDates(accountId, memberId);
  return new Set(policies.filter((p) => p.state === "not_renewed").flatMap((p) => p.documentIds));
}
