import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { normalizeCoverageCategory, normalizePersonName } from "@/lib/insurance";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";
import { normalizeCurrencyCode } from "@/lib/format/currency";

/** The ISO code of a currency the document printed, or null. Unlike
 * normalizeCurrencyCode() on its own, a bare "$" or an unrecognised marker is
 * NOT turned into SGD: missing information stays missing. */
export function printedCurrencyCode(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const code = normalizeCurrencyCode(value, "");
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export async function familyMembersForAccount(accountId: string) {
  const result = await query<{ id: string; display_name: string; preferred_name: string | null }>(`SELECT id,display_name,preferred_name FROM family_members WHERE account_id=$1 AND ${activePredicate()} ORDER BY created_at`,[accountId]);
  return result.rows;
}

type FamilyCandidate = { id: string; display_name: string; preferred_name?: string | null };
function memberNames(member: FamilyCandidate) {
  return [member.display_name, member.preferred_name].filter((n): n is string => !!n && !!n.trim());
}

/** Which family member a name printed on a document is.
 *
 * An exact (order-insensitive) match on the display or preferred name wins.
 * Otherwise a profile whose every name word appears in the printed name
 * matches -- "Charmaine" is the profile for "Charmaine Tan" -- but ONLY when
 * exactly one profile fits that way: two profiles that could both be the
 * printed person (two "Tan"s) is never guessed between. */
export function findFamilyMatchWithKind<T extends FamilyCandidate>(name: string, family: T[]): { member: T; kind: "exact" | "partial" } | null {
  const normalized = normalizePersonName(name);
  if (!normalized) return null;
  const exact = family.filter((member) => memberNames(member).some((n) => normalizePersonName(n) === normalized));
  if (exact.length === 1) return { member: exact[0], kind: "exact" };
  if (exact.length > 1) return null;
  const printed = new Set(normalized.split(" "));
  const partial = family.filter((member) => memberNames(member).some((n) => {
    const words = normalizePersonName(n).split(" ").filter((w) => w.length >= 2);
    return words.length > 0 && words.every((w) => printed.has(w));
  }));
  return partial.length === 1 ? { member: partial[0], kind: "partial" } : null;
}
export function findFamilyMatch<T extends FamilyCandidate>(name: string, family: T[]): T | null {
  return findFamilyMatchWithKind(name, family)?.member ?? null;
}

async function resolveTargetPolicyId(accountId: string, sourcePolicyId: string, policyNumber?: string | null) {
  if (!policyNumber) return sourcePolicyId;
  const result = await query<{ id: string }>(
    `SELECT id FROM policies WHERE account_id=$1 AND policy_number=$2 AND id<>$3 AND ${activePredicate()}
       AND document_role IN ('personal_schedule','certificate','endorsement','policy_wording','rider','renewal_statement','annual_statement')
     ORDER BY personal_coverage_confirmed DESC,document_authority DESC,created_at DESC LIMIT 1`,
    [accountId, policyNumber, sourcePolicyId],
  );
  return result.rows[0]?.id ?? sourcePolicyId;
}

export async function linkRelatedReferenceDocuments(accountId: string, policyId: string, groupPolicyNumber?: string | null) {
  // Match reference material conservatively: same group-policy number is strongest; exact insurer + product name is the fallback.
  await query(
    `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence)
     SELECT DISTINCT ON (ref.id,pm.family_member_id) ref.id,pm.family_member_id,$1,'scheme_reference_match',
            CASE WHEN current.group_policy_number IS NOT NULL AND current.group_policy_number=ref.group_policy_number THEN 0.95 ELSE 0.82 END
       FROM policies current
       JOIN policy_members pm ON pm.policy_id=current.id AND pm.account_id=current.account_id
       JOIN policies ref ON ref.account_id=current.account_id AND ref.id<>current.id AND ${activePredicate("ref")}
      WHERE current.account_id=$1 AND current.id=$2 AND ${activePredicate("current")} AND ref.personal_coverage_confirmed=false
        AND (
          (current.group_policy_number IS NOT NULL AND current.group_policy_number=ref.group_policy_number) OR
          (current.insurer IS NOT NULL AND ref.insurer IS NOT NULL AND lower(current.insurer)=lower(ref.insurer)
           AND current.product_name IS NOT NULL AND ref.product_name IS NOT NULL AND lower(current.product_name)=lower(ref.product_name))
        )
      -- Round 10: one row per (document, person) even when several documents match
      -- (a schedule and its photo, last year's schedule); Postgres refuses a second.
      ORDER BY ref.id,pm.family_member_id,(current.group_policy_number IS NOT NULL AND current.group_policy_number=ref.group_policy_number) DESC
     ON CONFLICT(policy_id,family_member_id) DO UPDATE SET source='scheme_reference_match',confidence=EXCLUDED.confidence`,
    [accountId, policyId],
  );
  await query(
    `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence)
     SELECT DISTINCT ON (pm.family_member_id) current.id,pm.family_member_id,$1,'scheme_reference_match',
            CASE WHEN current.group_policy_number IS NOT NULL AND current.group_policy_number=personal.group_policy_number THEN 0.95 ELSE 0.82 END
       FROM policies current
       JOIN policies personal ON personal.account_id=current.account_id AND personal.id<>current.id AND personal.personal_coverage_confirmed=true AND ${activePredicate("personal")}
       JOIN policy_members pm ON pm.policy_id=personal.id AND pm.account_id=personal.account_id
      WHERE current.account_id=$1 AND current.id=$2 AND ${activePredicate("current")} AND current.personal_coverage_confirmed=false
        AND (
          (current.group_policy_number IS NOT NULL AND current.group_policy_number=personal.group_policy_number) OR
          (current.insurer IS NOT NULL AND personal.insurer IS NOT NULL AND lower(current.insurer)=lower(personal.insurer)
           AND current.product_name IS NOT NULL AND personal.product_name IS NOT NULL AND lower(current.product_name)=lower(personal.product_name))
        )
      ORDER BY pm.family_member_id,(current.group_policy_number IS NOT NULL AND current.group_policy_number=personal.group_policy_number) DESC
     ON CONFLICT(policy_id,family_member_id) DO UPDATE SET source='scheme_reference_match',confidence=EXCLUDED.confidence`,
    [accountId, policyId],
  );
}

export async function syncInsuredPersonToMember(args: { accountId:string; sourcePolicyId:string; familyMemberId:string; detectedName:string; extraction:PolicyExtraction;
  /** How the person was linked: a name match (default, 0.95), or the member the
   * uploader chose for a document naming one person no profile matched. */
  link?: { source: "ai_name_match" | "upload_hint"; confidence: number }; }) {
  const person = args.extraction.insuredPeople.find((p)=>normalizePersonName(p.name)===normalizePersonName(args.detectedName));
  if (!person) return;
  const link = args.link ?? { source: "ai_name_match" as const, confidence: 0.95 };
  await query(`INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(policy_id,family_member_id) DO UPDATE SET source=EXCLUDED.source,confidence=EXCLUDED.confidence`,[args.sourcePolicyId,args.familyMemberId,args.accountId,link.source,link.confidence]);
  await query(`UPDATE policy_detected_people SET matched_family_member_id=$1,confidence=$5 WHERE account_id=$2 AND policy_id=$3 AND detected_name=$4`,[args.familyMemberId,args.accountId,args.sourcePolicyId,args.detectedName,link.confidence]);
  await query(`DELETE FROM policy_coverages WHERE account_id=$1 AND policy_id=$2 AND family_member_id=$3`,[args.accountId,args.sourcePolicyId,args.familyMemberId]);
  await query(`DELETE FROM premium_records WHERE account_id=$1 AND source_document_id=$2 AND family_member_id=$3`,[args.accountId,args.sourcePolicyId,args.familyMemberId]);

  if (args.extraction.personalCoverageConfirmed) {
    for (const coverage of person.coverages) {
      const category=normalizeCoverageCategory(coverage.category||coverage.productName||"Other");
      const verified=Boolean(coverage.sourcePage && coverage.evidenceText && coverage.evidenceVerified);
      await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,notes,source_page,authority,confirmed,evidence_text,evidence_verified)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'personal_document',$10,$11,$12)`,[
        args.accountId,args.sourcePolicyId,args.familyMemberId,category,coverage.amount,
        // Missing information stays missing: a coverage whose document does
        // not state a currency is stored WITHOUT one, never defaulted to SGD.
        printedCurrencyCode(coverage.currency),coverage.productName,
        [coverage.productName,coverage.notes].filter(Boolean).join(" · ")||null,coverage.sourcePage,verified,coverage.evidenceText,verified,
      ]);
    }
  }

  for (const payment of args.extraction.paymentRecords.filter((p)=>p.amount!=null)) {
    if (!payment.insuredPersonName || normalizePersonName(payment.insuredPersonName)!==normalizePersonName(person.name)) continue;
    const targetPolicyId=await resolveTargetPolicyId(args.accountId,args.sourcePolicyId,payment.policyNumber??args.extraction.policyNumber);
    await query(`INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency,payment_date,period_start,period_end,source_document_id,source_page,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[
      args.accountId,targetPolicyId,args.familyMemberId,payment.insurer??args.extraction.insurer,payment.productName??args.extraction.productName,payment.policyNumber??args.extraction.policyNumber,
      payment.amount,printedCurrencyCode(payment.currency),payment.frequency,payment.paymentDate||null,payment.periodStart||null,payment.periodEnd||null,args.sourcePolicyId,payment.sourcePage,payment.notes,
    ]);
  }
}
