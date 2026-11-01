import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { normalizeCoverageCategory, normalizePersonName } from "@/lib/insurance";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";
import { normalizeCurrencyCode } from "@/lib/format/currency";
import { isExcluded, notExcludedClause } from "@/lib/policies/member-exclusions";
import { nameKey } from "@/lib/policies/name-dismissals";

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
 * matches -- "Mei Ling" is the profile for "Mei Ling Tan" -- but ONLY when
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
/** Everyone in the family a printed name could be, by the same rule as findFamilyMatchWithKind: every exact match, or
 * when none, every profile whose name words all appear in the printed name. Two or more means the name alone cannot
 * tell them apart; `exact` says they all carry the printed name itself (true namesakes), rather than each fitting part of
 * it ("Wei Jie" and "Wei" for "Tan Wei Jie"). The caller decides by the household's own records, never by guessing. */
export function familyNameCandidates<T extends FamilyCandidate>(name: string, family: T[]): { members: T[]; exact: boolean } {
  const normalized = normalizePersonName(name);
  if (!normalized) return { members: [], exact: false };
  const exact = family.filter((member) => memberNames(member).some((n) => normalizePersonName(n) === normalized));
  if (exact.length) return { members: exact, exact: true };
  const printed = new Set(normalized.split(" "));
  return { members: family.filter((member) => memberNames(member).some((n) => {
    const words = normalizePersonName(n).split(" ").filter((w) => w.length >= 2);
    return words.length > 0 && words.every((w) => printed.has(w));
  })), exact: false };
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

/** Two documents' policy numbers are the same number (letters and digits only, case-insensitive; at least 5). */
const SAME_POLICY_NUMBER = (a: string, b: string) =>
  `(length(regexp_replace(coalesce(${a}.policy_number,''),'[^A-Za-z0-9]','','g'))>=5 AND upper(regexp_replace(${a}.policy_number,'[^A-Za-z0-9]','','g'))=upper(regexp_replace(coalesce(${b}.policy_number,''),'[^A-Za-z0-9]','','g')))`;

export async function linkRelatedReferenceDocuments(accountId: string, policyId: string, groupPolicyNumber?: string | null) {
  // A person the household removed from a document is never matched back onto it.
  const toRef = await notExcludedClause("$1", "ref.id", "pm.family_member_id");
  const toCurrent = await notExcludedClause("$1", "current.id", "pm.family_member_id");
  // Match reference material conservatively: same group-policy number is strongest; exact insurer + product name is the fallback.
  await query(
    `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence)
     SELECT DISTINCT ON (ref.id,pm.family_member_id) ref.id,pm.family_member_id,$1,'scheme_reference_match',
            CASE WHEN current.group_policy_number IS NOT NULL AND current.group_policy_number=ref.group_policy_number THEN 0.95 ELSE 0.82 END
       FROM policies current
       JOIN policy_members pm ON pm.policy_id=current.id AND pm.account_id=current.account_id
       JOIN policies ref ON ref.account_id=current.account_id AND ref.id<>current.id AND ${activePredicate("ref")}
      WHERE current.account_id=$1 AND current.id=$2 AND ${activePredicate("current")} AND ref.personal_coverage_confirmed=false
        -- Round 7 (port): a premium receipt names whoever paid; its payer is not who another document of the product covers.
        AND coalesce(current.document_role,'')<>'premium_receipt'
        AND (
          (current.group_policy_number IS NOT NULL AND current.group_policy_number=ref.group_policy_number) OR
          (current.insurer IS NOT NULL AND ref.insurer IS NOT NULL AND lower(current.insurer)=lower(ref.insurer)
           AND current.product_name IS NOT NULL AND ref.product_name IS NOT NULL AND lower(current.product_name)=lower(ref.product_name)) OR
          -- Round 8b: the same policy number (letters and digits only) and product -- an endorsement names the policy it
          -- amends, while the insurer's name is read differently from page to page ("... Pte. Ltd." or not).
          (${SAME_POLICY_NUMBER("current", "ref")} AND current.product_name IS NOT NULL AND ref.product_name IS NOT NULL AND lower(current.product_name)=lower(ref.product_name))
        )${toRef}
      -- Round 10: one row per (document, person) even when several documents match
      -- (a schedule and its photo, last year's schedule); Postgres refuses a second.
      ORDER BY ref.id,pm.family_member_id,(current.group_policy_number IS NOT NULL AND current.group_policy_number=ref.group_policy_number) DESC
     ON CONFLICT(policy_id,family_member_id) DO UPDATE SET source='scheme_reference_match',confidence=EXCLUDED.confidence
       -- a person the household ticked stays ticked (the picker hides matching-wording links)
       WHERE policy_members.source<>'user_declared'`,
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
           AND current.product_name IS NOT NULL AND personal.product_name IS NOT NULL AND lower(current.product_name)=lower(personal.product_name)) OR
          (${SAME_POLICY_NUMBER("current", "personal")} AND current.product_name IS NOT NULL AND personal.product_name IS NOT NULL AND lower(current.product_name)=lower(personal.product_name))
        )${toCurrent}
      ORDER BY pm.family_member_id,(current.group_policy_number IS NOT NULL AND current.group_policy_number=personal.group_policy_number) DESC
     ON CONFLICT(policy_id,family_member_id) DO UPDATE SET source='scheme_reference_match',confidence=EXCLUDED.confidence
       -- a person the household ticked stays ticked (the picker hides matching-wording links)
       WHERE policy_members.source<>'user_declared'`,
    [accountId, policyId],
  );
}

/** Printed names on a document that the household matched to someone by hand (their link is user_declared), by
 * name key: a re-read matches each to the same person again instead of dropping their cover. */
export async function householdNameMatches(accountId: string, policyId: string): Promise<Map<string, string>> {
  const rows = (await query<{ detected_name: string; member: string }>(
    `SELECT pdp.detected_name, pdp.matched_family_member_id::text AS member FROM policy_detected_people pdp
       JOIN policy_members pm ON pm.policy_id=pdp.policy_id AND pm.account_id=pdp.account_id AND pm.family_member_id=pdp.matched_family_member_id AND pm.source='user_declared'
      WHERE pdp.policy_id=$1 AND pdp.account_id=$2`, [policyId, accountId])).rows;
  return new Map(rows.map((r) => [nameKey(r.detected_name), r.member]));
}

/** The family member the household matched this printed name to by hand, if any. It wins over the automatic match. */
export function preferHouseholdMatch<T extends { id: string }>(printedName: string, handMatches: Map<string, string>, family: T[]): T | undefined {
  const id = handMatches.get(nameKey(printedName));
  return id ? family.find((member) => member.id === id) : undefined;
}

export async function syncInsuredPersonToMember(args: { accountId:string; sourcePolicyId:string; familyMemberId:string; detectedName:string; extraction:PolicyExtraction;
  /** How the person was linked: a name match (default, 0.95), or the member the
   * uploader chose for a document naming one person no profile matched. */
  link?: { source: "ai_name_match" | "upload_hint" | "user_declared"; confidence: number };
  /** The household itself is linking this person, so a remembered removal does not apply. */
  householdChoice?: boolean; }) {
  const person = args.extraction.insuredPeople.find((p)=>normalizePersonName(p.name)===normalizePersonName(args.detectedName));
  if (!person) return;
  // The household removed this person from this document: a re-read does not put them back.
  if (!args.householdChoice && args.link?.source !== "user_declared" && await isExcluded(args.accountId, args.sourcePolicyId, args.familyMemberId)) return;
  const link = args.link ?? { source: "ai_name_match" as const, confidence: 0.95 };
  await query(`INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(policy_id,family_member_id) DO UPDATE SET
      -- The household's own link (user_declared) stays theirs when a re-read matches the same person by name.
      source=CASE WHEN policy_members.source='user_declared' THEN policy_members.source ELSE EXCLUDED.source END,
      confidence=CASE WHEN policy_members.source='user_declared' THEN policy_members.confidence ELSE EXCLUDED.confidence END`,[args.sourcePolicyId,args.familyMemberId,args.accountId,link.source,link.confidence]);
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
