import { query } from "@/lib/db/client";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimAssessmentItem, ClaimEvidence } from "./types";

function coverageCitation(c: OwnedCoverage): ClaimEvidence {
  return {
    chunkId:`coverage:${c.id}`,
    policyId:c.policyId,
    policyName:c.productName ?? c.policyName ?? "Policy",
    insurer:c.insurer ?? undefined,
    pageStart:c.sourcePage ?? 1,
    pageEnd:c.sourcePage ?? 1,
    documentRole:c.documentRole,
    personalEvidence:true,
    evidenceLabel:"Personal cover",
  };
}

export async function evidenceForAssessment(args:{accountId:string;familyMemberId:string;item:ClaimAssessmentItem;ownedCoverage:OwnedCoverage|null}) {
  const citations: ClaimEvidence[] = [];
  if (args.ownedCoverage) citations.push(coverageCitation(args.ownedCoverage));
  if (args.item.ruleEvidence) {
    if (!citations.some(c => c.chunkId === args.item.ruleEvidence!.chunkId)) citations.push(args.item.ruleEvidence);
    return citations;
  }
  for (const term of args.item.evidenceTerms.slice(0,3)) {
    const result = await query<{
      policy_id:string;page_number:number;insurer:string|null;product_name:string|null;document_role:string|null;original_filename:string;
    }>(
      `SELECT pp.policy_id,pp.page_number,p.insurer,p.product_name,p.document_role,p.original_filename
         FROM policy_pages pp
         JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
         JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id
        WHERE pp.account_id=$1 AND pm.family_member_id=$2 AND p.processing_status='ready'
          AND pp.text ILIKE '%' || $3 || '%'
        ORDER BY CASE WHEN p.personal_coverage_confirmed THEN 0 ELSE 1 END,p.document_authority DESC,p.created_at DESC
        LIMIT 1`,
      [args.accountId,args.familyMemberId,term],
    );
    const row = result.rows[0];
    if (!row) continue;
    const key = `page:${row.policy_id}:${row.page_number}`;
    if (citations.some((c)=>c.chunkId===key)) continue;
    citations.push({
      chunkId:key,policyId:row.policy_id,policyName:row.product_name ?? row.original_filename,insurer:row.insurer ?? undefined,
      pageStart:row.page_number,pageEnd:row.page_number,documentRole:row.document_role,personalEvidence:false,evidenceLabel:"Policy wording",
    });
  }
  return citations;
}

export function ownedCoverageForItem(item:ClaimAssessmentItem, coverages:OwnedCoverage[]) {
  if (item.coverageId) return coverages.find(c => c.id === item.coverageId) ?? null;
  const product = (item.productName ?? "").toLowerCase();
  if (/group personal accident/.test(product)) return coverages.find((c)=>/group personal accident/i.test(c.productName??"")||c.category==="Personal Accident")??null;
  if (/group term life/.test(product)) return coverages.find((c)=>/group term life/i.test(c.productName??"")||c.category==="Death")??null;
  if (/living care plus/.test(product)) return coverages.find((c)=>/living care plus/i.test(c.productName??"")||c.category==="Early Critical Illness")??null;
  if (/living care/.test(product)) return coverages.find((c)=>(/living care/i.test(c.productName??"")&&!/plus/i.test(c.productName??""))||c.category==="Critical Illness")??null;
  return coverages.find((c)=>c.productName===item.productName)??null;
}
