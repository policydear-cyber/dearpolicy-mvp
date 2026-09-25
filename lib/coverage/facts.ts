import { query } from "@/lib/db/client";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { normalizeCurrencyCode } from "@/lib/format/currency";

export type OwnedCoverage = {
  id: string;
  policyId: string;
  familyMemberId: string;
  category: string;
  amount: number | null;
  currency: string;
  productName: string | null;
  sourcePage: number | null;
  evidenceText: string | null;
  insurer: string | null;
  policyName: string | null;
  policyNumber: string | null;
  groupPolicyNumber: string | null;
  documentRole: string | null;
  effectiveDate: string | null;
  renewalOrExpiryDate: string | null;
  /** True only when the coverage row itself carries an explicit ISO
   * currency read from the personal document (policy_coverages.currency).
   * `currency` above falls back to SGD when that column is empty, so a
   * benefit that must match currencies (lib/claims/currency-evidence.ts)
   * checks this, never `currency` alone. Absent = not verified. */
  currencyVerified?: boolean;
  /** The policy document version (policies.file_hash) the coverage and its
   * wording were read from; null/absent when unknown. */
  policyDocumentVersion?: string | null;
};

export function canonicalProduct(value: string | null | undefined) {
  const v = (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/group term life|\bgtl\b/.test(v)) return "group term life";
  if (/group personal accident|\bgpa\b/.test(v)) return "group personal accident";
  if (/living care plus/.test(v)) return "living care plus";
  if (/\bliving care\b/.test(v)) return "living care";
  if (/disability income/.test(v)) return "disability income";
  if (/outpatient medicare/.test(v)) return "outpatient medicare";
  if (/hospital|shield/.test(v)) return "hospitalisation";
  return v;
}

export function productFromCategory(category: string) {
  if (category === "Death" || category === "Total Permanent Disability" || category === "Hospital Cash") return "group term life";
  if (category === "Personal Accident") return "group personal accident";
  if (category === "Critical Illness") return "living care";
  if (category === "Early Critical Illness") return "living care plus";
  if (category === "Disability Income") return "disability income";
  if (category === "Outpatient") return "outpatient medicare";
  if (category === "Hospitalisation") return "hospitalisation";
  return "";
}

export async function confirmedOwnedCoverages(accountId: string, familyMemberId: string): Promise<OwnedCoverage[]> {
  const result = await query<{
    id:string;policy_id:string;family_member_id:string;category:string;amount:string|null;currency:string|null;coverage_product_name:string|null;
    source_page:number|null;evidence_text:string|null;insurer:string|null;policy_name:string|null;policy_number:string|null;group_policy_number:string|null;
    document_role:string|null;effective_date:string|null;renewal_or_expiry_date:string|null;policy_document_version:string|null;
  }>(
    `SELECT pc.id,pc.policy_id,pc.family_member_id,pc.category,pc.amount::text,pc.currency,pc.product_name AS coverage_product_name,
            pc.source_page,pc.evidence_text,p.insurer,p.product_name AS policy_name,p.policy_number,p.group_policy_number,p.document_role,
            p.effective_date::text,p.renewal_or_expiry_date::text,p.file_hash AS policy_document_version
       FROM policy_coverages pc
       JOIN policies p ON p.id=pc.policy_id AND p.account_id=pc.account_id AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")}
      WHERE pc.account_id=$1 AND pc.family_member_id=$2 AND pc.confirmed=true AND pc.evidence_verified=true
      ORDER BY p.document_authority DESC,p.effective_date DESC NULLS LAST,p.created_at DESC`,
    [accountId, familyMemberId],
  );
  return result.rows.map((r) => ({
    id:r.id, policyId:r.policy_id, familyMemberId:r.family_member_id, category:r.category,
    amount:r.amount == null ? null : Number(r.amount), currency:normalizeCurrencyCode(r.currency,"SGD"), productName:r.coverage_product_name,
    sourcePage:r.source_page, evidenceText:r.evidence_text, insurer:r.insurer, policyName:r.policy_name, policyNumber:r.policy_number,
    groupPolicyNumber:r.group_policy_number, documentRole:r.document_role, effectiveDate:r.effective_date, renewalOrExpiryDate:r.renewal_or_expiry_date,
    currencyVerified:/^[A-Z]{3}$/.test((r.currency ?? "").trim().toUpperCase()), policyDocumentVersion:r.policy_document_version,
  }));
}

export function coverageByProduct(coverages: OwnedCoverage[], product: string) {
  const canonical = canonicalProduct(product);
  return coverages.filter((c) => (canonicalProduct(c.productName) || productFromCategory(c.category)) === canonical);
}
