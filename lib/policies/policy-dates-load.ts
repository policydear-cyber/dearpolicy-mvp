import { createHash } from "node:crypto";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { loadPolicyInventory } from "@/lib/policies/inventory";
import { singaporeDay } from "@/lib/benefit-table/dates";
import { householdPolicyDates, sharingDocuments, type DatedCover, type PaymentRecord, type PolicyDate } from "@/lib/policies/policy-dates";
import { normalizedIdentifier } from "@/lib/policies/document-name";
import type { PersonCover, TableRow } from "@/lib/benefit-table/assemble";
import { notRenewedKey, notRenewedReady, notRenewedRows } from "@/lib/policies/not-renewed";

/** One person's policy dates from stored documents, readings, premium records and the household's "I didn't renew it"
 * answers (lib/policies/policy-dates.ts). No model call. `member` null: the household's first person. */
/** The page's key for a policy: a hash of its inventory key, so a policy number never travels as an id (and the ID-number
 * mask can never change it). `contractKeys` maps it back on the server. */
export const pageKey = (contractKey: string) => createHash("sha256").update(contractKey).digest("hex").slice(0, 24);
type TablePerson = { covers: PersonCover[]; rows: TableRow[] };
export async function loadPolicyDates(accountId: string, memberId: string | null): Promise<{ memberId: string | null; policies: PolicyDate[]; answersReady: boolean; contractKeys: Map<string, string>;
  /** The person's own benefit-table covers and rows, when the table is live (the Life stages page reads these too). */
  table: TablePerson | null; name: string | null; displayName: string | null; dateOfBirth: string | null }> {
  const people = (await query<{ id: string; display_name: string; preferred_name: string | null; relationship: string; date_of_birth: string | null }>(
    `SELECT id,display_name,preferred_name,relationship,date_of_birth::text AS date_of_birth FROM family_members WHERE account_id=$1 AND ${activePredicate()} ORDER BY created_at`, [accountId])).rows;
  const member = people.find((p) => p.id === memberId) ?? (memberId ? undefined : people[0]);
  if (!member) return { memberId: null, policies: [], answersReady: false, contractKeys: new Map(), table: null, name: null, displayName: null, dateOfBirth: null };
  const inventory = await loadPolicyInventory(accountId, [member]);
  const contracts = inventory.contracts.filter((c) => c.ownerId === member.id);
  // The person's own cover lines and their printed dates, from the benefit table when it is live.
  let covers: DatedCover[] = [], table: TablePerson | null = null;
  try {
    const { benefitTableLive, appDb } = await import("@/lib/benefit-table/app");
    if (await benefitTableLive(accountId)) {
      const { tableFor } = await import("@/lib/benefit-table/service");
      const person = (await tableFor(appDb, accountId)).table.people.find((p) => p.id === member.id);
      table = person ? { covers: person.covers, rows: person.rows } : null;
      covers = (person?.covers ?? []).map((c) => ({ documentId: c.source.documentId, name: c.cover || c.product || "", startDate: c.startDate ?? null, endDate: c.endDate ?? null, page: c.source.page ?? null }));
    }
  } catch (error) { console.warn("Benefit table unavailable for policy dates:", error instanceof Error ? error.message : error); }
  const payments = (await query<PaymentRecord>(
    `SELECT pr.policy_id::text AS policy_id,pr.source_document_id::text AS source_document_id,pr.family_member_id::text AS family_member_id,pr.insurer,pr.policy_number,
            pr.payment_date::text AS payment_date,pr.period_start::text AS period_start,pr.period_end::text AS period_end,pr.created_at::text AS created_at
       FROM premium_records pr WHERE pr.account_id=$1 AND (pr.family_member_id IS NULL OR pr.family_member_id=$2)`, [accountId, member.id])).rows;
  const answers = new Set((await notRenewedRows(accountId, [member.id])).map((r) => notRenewedKey(r.contract_key, r.ends_on)));
  const contractKeys = new Map(contracts.map((c) => [pageKey(c.id), c.id]));
  // A document that prints more than one of the person's policies (a yearly statement, a portfolio summary) can't be
  // answered for as a whole: "I didn't renew it" would take its other, current policies off Home too (Critic MED-3).
  const numbersOn = new Map<string, Set<string>>();
  for (const c of table?.covers ?? []) {
    const n = normalizedIdentifier(c.policyNumber);
    if (n) numbersOn.set(c.source.documentId, new Set([...(numbersOn.get(c.source.documentId) ?? []), n]));
  }
  // Or, with no benefit table or no policy numbers read on it, two of the person's contracts share a document (MED-6).
  const shared = sharingDocuments(contracts);
  // A policy whose documents store no product name is named from its file name (documentName); when its reading prints a
  // product, that is the name instead, so a file name never names a policy here (TE F4, DC 18 Nov: no file names).
  const productOf = new Map<string, string>();
  for (const c of table?.covers ?? []) if (!c.riderOf && c.product?.trim() && !productOf.has(c.source.documentId)) productOf.set(c.source.documentId, c.product.trim());
  for (const c of contracts) {
    if (c.documents.some((d) => (d as { product_name?: string | null }).product_name?.trim())) continue;
    const printed = c.documents.map((d) => productOf.get(d.id)).find(Boolean);
    if (printed) c.name = printed;
  }
  const policies = householdPolicyDates(contracts, covers, payments, singaporeDay(new Date()), answers).map((p) => ({ ...p, key: pageKey(p.key),
    ...(shared.has(p.key) || p.documentIds.some((id) => (numbersOn.get(id)?.size ?? 0) > 1) ? { severalPolicies: true } : {}) }));
  return { memberId: member.id, policies, answersReady: await notRenewedReady(), contractKeys, table,
    name: member.preferred_name?.trim() || member.display_name, displayName: member.display_name, dateOfBirth: member.date_of_birth ?? null };
}

/** The documents of a person's policies the household said it did not renew (still with no renewal evidence after that
 * date): Home's cards leave them out of current cover. Empty, with no further reads, when the household has said so of none
 * of this person's policies. */
export async function notRenewedDocumentIds(accountId: string, memberId: string): Promise<Set<string>> {
  if (!(await notRenewedRows(accountId, [memberId])).length) return new Set();
  const { policies } = await loadPolicyDates(accountId, memberId);
  return new Set(policies.filter((p) => p.state === "not_renewed").flatMap((p) => p.documentIds));
}
