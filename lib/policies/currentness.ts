import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { canonicalDeathInsurer } from "@/lib/claims/death-evidence";
import { normalizedIdentifier,type PolicyContract } from "@/lib/policies/inventory";
import type { PolicyCurrentness } from "@/types";

/** Policy currentness is deliberately separate from ownership.
 *
 * Ownership is established by personalised evidence and is never withdrawn
 * because a premium receipt is missing. Currentness only reports how recently
 * DearPolicy saw payment or renewal evidence for the same contract. */
export const CURRENTNESS_MAX_EVIDENCE_DAYS=400;
export type PremiumEvidenceRow={policy_id:string|null;family_member_id:string|null;insurer:string|null;policy_number:string|null;latest:string|null};

export function assessCurrentness(args:{now:Date;lastEvidenceOn:string|null;renewalOrExpiryDate:string|null}):PolicyCurrentness{
  const ownership="Ownership stays confirmed by your policy document; only whether it is still being paid for is unconfirmed.";
  const day=(iso:string)=>{const d=new Date(iso.slice(0,10)+"T00:00:00Z");return Number.isNaN(d.getTime())?iso:d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});};
  const expiry=args.renewalOrExpiryDate&&Number.isFinite(Date.parse(args.renewalOrExpiryDate))?args.renewalOrExpiryDate:null;
  const evidence=args.lastEvidenceOn&&Number.isFinite(Date.parse(args.lastEvidenceOn))?args.lastEvidenceOn:null;
  const ageDays=evidence?Math.floor((args.now.getTime()-Date.parse(evidence))/86_400_000):null;
  // A payment or renewal dated in the future (a GIRO deduction scheduled for
  // 5 April 2027 on a renewal notice) is evidence the policy is being kept
  // current, not "older than 400 days": a negative age used to fall through.
  const fresh=ageDays!=null&&ageDays<=CURRENTNESS_MAX_EVIDENCE_DAYS;
  // A printed renewal or expiry date that has passed never changes the status: every policy on file is treated as in
  // force (DC, 31 Oct: "ignore all expiry dates").
  if(fresh)
    return {state:"verified_recent",label:"Active status evidenced",
      detail:(ageDays!=null&&ageDays<0?"Next payment or renewal on file: ":"Latest payment or renewal on file: ")+day(evidence!)+".",
      lastEvidenceOn:evidence,renewalOrExpiryDate:expiry};
  if(evidence)
    return {state:"not_recently_verified",label:"Active status not recently verified",
      detail:"The most recent premium receipt or renewal notice on file is from "+day(evidence)+", more than a year ago. "+ownership,
      lastEvidenceOn:evidence,renewalOrExpiryDate:expiry};
  return {state:"unknown",label:"Active status not recently verified",
    detail:"DearPolicy has no premium receipt or renewal notice for this policy, so it can’t yet confirm the cover is still being paid for. "+ownership,
    lastEvidenceOn:null,renewalOrExpiryDate:expiry};
}
/** Premium evidence must be bound to the same contract. A receipt for another
 * policy, insurer or family member never evidences this contract. */
export function matchPremiumEvidence(contract:PolicyContract,rows:PremiumEvidenceRow[]){
  const documentIds=new Set([...contract.documents,...contract.references].map(d=>d.id));
  const identifiers=new Set(contract.documents.flatMap(d=>[normalizedIdentifier(d.policy_number),normalizedIdentifier(d.group_policy_number)]).filter(Boolean));
  const insurer=canonicalDeathInsurer(contract.insurer);
  let latest:string|null=null;
  for(const row of rows){
    if(!row.latest||!Number.isFinite(Date.parse(row.latest)))continue;
    if(row.family_member_id&&row.family_member_id!==contract.ownerId)continue;
    const identifier=normalizedIdentifier(row.policy_number);
    const sameInsurer=!insurer||!row.insurer||insurer===canonicalDeathInsurer(row.insurer);
    const byDocument=!!row.policy_id&&documentIds.has(row.policy_id);
    const byIdentifier=!!identifier&&identifiers.has(identifier)&&sameInsurer;
    if(!byDocument&&!byIdentifier)continue;
    if(!latest||row.latest>latest)latest=row.latest;
  }
  return latest;
}
export async function loadPremiumEvidence(accountId:string,memberIds:string[]){
  if(!memberIds.length)return [] as PremiumEvidenceRow[];
  const r=await query<PremiumEvidenceRow>(
    "SELECT pr.policy_id::text AS policy_id,pr.family_member_id::text AS family_member_id,pr.insurer,pr.policy_number,max(COALESCE(pr.payment_date,pr.period_end,pr.period_start,pr.created_at::date))::text AS latest FROM premium_records pr WHERE pr.account_id=$1 AND (pr.family_member_id IS NULL OR pr.family_member_id=ANY($2::uuid[])) GROUP BY 1,2,3,4",
    [accountId,memberIds]);
  return r.rows;
}
/** Round 12: a policy whose own document prints that no further premium is payable (premiums completed,
 * fully paid up) has no receipt or renewal notice to come: asking the household to upload one is a step
 * that does not belong. Read from the stored page text of the policy's documents. */
export const PAID_UP_TEXT=/\bno further premiums? (?:is |are |will be )?(?:payable|due|required)\b|\bpremium payments? (?:were |was |have been |has been )?(?:completed|ended|ceased)\b|\bstatus\s*:?[^.\n]{0,40}\b(?:fully )?paid[- ]up\b/i;
export async function loadPaidUpPolicyIds(accountId:string,policyIds:string[]){
  if(!policyIds.length)return new Set<string>();
  const r=await query<{policy_id:string;text:string|null}>(
    "SELECT pp.policy_id::text AS policy_id,pp.text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id WHERE p.account_id=$1 AND pp.policy_id::text=ANY($2::text[]) AND "+activePredicate("p"),
    [accountId,policyIds]);
  return new Set(r.rows.filter(row=>PAID_UP_TEXT.test(row.text??"")).map(row=>row.policy_id));
}
export function contractCurrentness(contract:PolicyContract,rows:PremiumEvidenceRow[],now:Date,paidUp?:Set<string>){
  if(paidUp&&contract.documents.some(d=>paidUp.has(d.id)))
    return {state:"verified_recent",label:"Premiums completed",detail:"The policy document prints that no further premium is payable, so there is no premium receipt or renewal notice to look for.",
      lastEvidenceOn:null,renewalOrExpiryDate:contract.documents.map(d=>d.renewal_or_expiry_date).filter((v):v is string=>!!v).sort().at(-1)??null} as PolicyCurrentness;
  const renewal=contract.documents.map(d=>d.renewal_or_expiry_date).filter((v):v is string=>!!v).sort().at(-1)??null;
  return assessCurrentness({now,lastEvidenceOn:matchPremiumEvidence(contract,rows),renewalOrExpiryDate:renewal});
}

/** The "not recently verified" note is about the policy, not about each
 * benefit: several workflow paths add it to every benefit card of a stale
 * contract. Said once per answer instead, in the answer's details. */
export const ACTIVE_STATUS_NOTE=/^Active status not recently verified: /;
export function consolidateActiveStatus<T extends {details:string[];claimItems?:{conditions:string[]}[]}>(answer:T):T{
  const notes:string[]=[];
  for(const item of answer.claimItems??[]){
    const kept:string[]=[];
    for(const condition of item.conditions)(ACTIVE_STATUS_NOTE.test(condition)?notes:kept).push(condition);
    item.conditions=kept;
  }
  const first=notes[0];
  if(first&&!answer.details.some(d=>ACTIVE_STATUS_NOTE.test(d)))answer.details.push(first);
  return answer;
}
