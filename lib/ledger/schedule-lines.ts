/** The lines of cover each person's schedules and certificates list, by the same rule Home's tiles read them
 * (app/api/dashboard: confirmed, checked against the page, on an active and trusted policy), with an active family member.
 * Family and Coverage read them too, on both paths, so every page agrees with Home (GET /api/ledger, GET /api/benefit-table).
 * No amount is sent: a line's figure has no stated basis (per month, per day, or a sum). */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import { documentName } from "@/lib/policies/document-name";
import { PRODUCT_DEFAULTS } from "@/lib/ledger/events";
import type { ScheduleLine } from "@/components/cover-kinds";

export async function scheduleLinesFor(accountId: string): Promise<ScheduleLine[]> {
  const r = await query<ScheduleLine & { lineProduct: string | null; policyProduct: string | null; original_filename: string; document_role: string | null; policy_number: string | null }>(
    `SELECT pc.family_member_id::text AS "familyMemberId",p.id::text AS "policyId",pc.category,coalesce(pc.product_name,p.product_name) AS "planName",p.insurer,pc.source_page AS "sourcePage",pc.product_name AS "lineProduct",p.product_name AS "policyProduct",p.original_filename,p.document_role::text,p.policy_number FROM policy_coverages pc JOIN policies p ON p.id=pc.policy_id AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} JOIN family_members f ON f.id=pc.family_member_id AND f.account_id=pc.account_id AND ${activePredicate("f")} WHERE pc.account_id=$1 AND pc.confirmed=true AND pc.evidence_verified=true ORDER BY p.created_at,pc.created_at`,
    [accountId]);
  // The events a line would seed, by the rule seeding uses (lib/ledger/store.ts scheduleSeeds: category, the line's own
  // product name and the document's name), so a rejection of all of them keeps any printed wording's line out (TE F2 on #256).
  return r.rows.map(({ lineProduct, policyProduct, original_filename, document_role, policy_number, ...line }) => {
    const doc = documentName({ product_name: policyProduct, original_filename, insurer: line.insurer, document_role, policy_number });
    const name = `${line.category} ${lineProduct ?? ""} ${doc}`.trim();
    const seeds = PRODUCT_DEFAULTS.find((d) => d.pattern.test(name) && !(d.exclude && d.exclude.test(name)));
    return { ...line, events: seeds ? seeds.events.map((e) => e.event) : null };
  });
}
