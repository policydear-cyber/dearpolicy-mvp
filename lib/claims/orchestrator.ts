import { query } from "@/lib/db/client";
import { confirmedOwnedCoverages, canonicalProduct, productFromCategory, type OwnedCoverage } from "@/lib/coverage/facts";
import { extractClaimFacts, factsToLabels } from "./facts";
import { assessClaim, claimNextSteps, nextClaimQuestion, relevantOwnedProducts } from "./rules";
import { createClaimSession, getClaimSession, saveClaimSession } from "./session";
import { evidenceForAssessment, ownedCoverageForItem } from "./evidence";
import { enforceMonetarySafety } from "./monetary-gate";
import { loadDeathEvidence } from "./death-evidence";
import { loadCIEvidence } from "./ci-evidence";
import { loadMedicalEvidence } from "./medical-evidence";
import { loadDisabilityEvidence } from "./disability-evidence";
import { loadTravelEvidence } from "./travel-evidence";
import { loadVerifiedMedicalBillFacts } from "./evidence/medical-bill-evidence";
import { loadDisabilityDefinitionMatchesForFacts } from "./evidence/disability-session-matches";
import { loadCauseDefinitionMatchesForFacts } from "./evidence/session-matches";
import { loadCIDefinitionMatchesForFacts } from "./evidence/ci-session-matches";
import { composeClaim } from "./composition/engine";
import { recordCompositionSnapshot } from "./composition/store";
import { toClaimCompositionView } from "./composition/view";
import type { ClaimCompositionResult } from "./composition/types";
import { formatMoney } from "@/lib/format/currency";
import type { ChatAnswer, ChatCitation } from "@/types";
import type { ClaimAssessmentItem, ClaimDecisionPacket, ClaimFacts, ClaimQuestion } from "./types";

export function looksLikeClaimIntent(text: string) {
  return /\b(?:claims?|accident|crash|diagnos\w*|cancer|tumou?rs?|stroke|heart attack|hospital\w*|admitted|fractur\w*|broken|injur\w*|surgery|operation|disabil\w*|passed away|died|death|deceased|killed)\b/i.test(text);
}

function eventSummary(facts: ClaimFacts) {
  if (facts.eventType === "accident") return facts.accidentType ? `${facts.accidentType}` : "Accident";
  if (facts.eventType === "diagnosis") return facts.diagnosis ? `Diagnosis: ${facts.diagnosis}` : "Medical diagnosis";
  if (facts.eventType === "hospitalisation") return facts.diagnosis ? `Hospitalisation: ${facts.diagnosis}` : "Hospital admission";
  if (facts.eventType === "death") return facts.accidentalDeath === true ? "Accidental death claim" : "Death claim";
  if (facts.eventType === "disability") return "Disability claim";
  return "Claim check";
}


function relevantCoverageNames(coverages:OwnedCoverage[], products:string[]) {
  const names:string[]=[];
  for(const product of products){
    const row=coverages.find(c=>(canonicalProduct(c.productName)||productFromCategory(c.category))===product);
    const label=row?.productName ?? row?.category ?? product;
    if(label&&!names.includes(label))names.push(label);
  }
  return names;
}

function coverageListSummary(coverages:OwnedCoverage[], products:string[]) {
  const parts:string[]=[];
  for(const product of products){
    const row=coverages.find(c=>(canonicalProduct(c.productName)||productFromCategory(c.category))===product);
    if(!row)continue;
    const amount=row.amount!=null?` · ${formatMoney(row.amount,row.currency)}`:"";
    parts.push(`${row.productName??row.category}${amount}`);
  }
  return parts;
}

function missingLabel(questionId:string){
  if(questionId==="death_date")return "Date of death";
  if(questionId==="cause_of_death")return "Cause of death";
  if(questionId==="racing_authority_sanctioned")return "MINDEF/MHA sanction for racing";
  const map:Record<string,string>={event_type:"What happened",event_date:"Event date",diagnosis_date:"Diagnosis date",injured:"Injuries",fracture_body_part:"Fracture site",ambulance_used:"Ambulance use",ambulance_bill:"Ambulance bill",hospitalised:"Hospital admission",hospital_nights:"Length of stay",hospital_bill:"Hospital bill",out_of_pocket:"Out-of-pocket amount",permanent_impairment:"Permanent impairment",competitive_racing:"Racing/competition circumstance",diagnosis:"Diagnosis",medical_report:"Medical report"};
  return map[questionId]??questionId;
}

async function storeChat(args:{accountId:string;familyMemberId:string;sessionId:string;user:string;answer:ChatAnswer}){
  await query(`INSERT INTO chat_messages(account_id,family_member_id,claim_session_id,role,content) VALUES($1,$2,$3,'user',$4)`,[args.accountId,args.familyMemberId,args.sessionId,args.user]);
  await query(`INSERT INTO chat_messages(account_id,family_member_id,claim_session_id,role,content,citations) VALUES($1,$2,$3,'assistant',$4,$5::jsonb)`,[args.accountId,args.familyMemberId,args.sessionId,args.answer.summary,JSON.stringify(args.answer.citations)]);
}

async function currentnessNote(accountId:string,familyMemberId:string){
  const r=await query<{latest:string|null}>(`SELECT max(COALESCE(payment_date,period_end,period_start,created_at::date))::text AS latest FROM premium_records pr WHERE pr.account_id=$1 AND (pr.family_member_id=$2 OR (pr.family_member_id IS NULL AND pr.policy_id IS NOT NULL AND EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=pr.policy_id AND pm.account_id=pr.account_id AND pm.family_member_id=$2)))`,[accountId,familyMemberId]);
  const latest=r.rows[0]?.latest??null;
  if(!latest)return {verified:false,detail:"Coverage ownership is confirmed, but DearPolicy does not have a recent premium/renewal record to independently verify that the cover is still being paid for."};
  const age=Date.now()-Date.parse(latest);const fresh=Number.isFinite(age)&&age<400*86_400_000;
  return fresh?{verified:true,detail:`Latest payment/renewal evidence on file: ${latest}.`}:{verified:false,detail:`The latest payment/renewal evidence on file is ${latest}, so active status may need refreshing.`};
}

function noCoverageAnswer(sessionId:string, knownFacts:string[]):ChatAnswer{
  return {mode:"claim_assessment",summary:"I can understand what happened, but I do not have confirmed personal policy evidence for this person yet, so I cannot tell you what can be claimed reliably.",details:["Upload the current Certificate of Insurance, policy schedule or endorsement first. Product summaries and brochures can explain benefits, but they cannot prove that this person owns them."],claimItems:[],nextSteps:["Upload the person's current certificate or policy schedule.","Then return to this claim check; DearPolicy will reuse the event facts you already provided."],confidence:null,citations:[],disclaimer:"DearPolicy will not infer ownership from generic policy documents.",claimSessionId:sessionId,questions:[],knownFacts,missingFacts:["Confirmed personal policy ownership"]};
}

async function assessmentCitations(accountId:string,familyMemberId:string,assessments:ClaimAssessmentItem[],coverages:OwnedCoverage[]) {
  const citations:ChatCitation[]=[];
  for(const item of assessments){
    const evidence=await evidenceForAssessment({accountId,familyMemberId,item,ownedCoverage:ownedCoverageForItem(item,coverages)});
    for(const citation of evidence)if(!citations.some(c=>c.chunkId===citation.chunkId))citations.push(citation);
  }
  return citations;
}

function deathSummary(assessments:ClaimAssessmentItem[],personName?:string,question?:ClaimQuestion|null,acknowledgeLoss=false,composition?:ClaimCompositionResult|null) {
  const calculated=assessments.filter(a=>a.calculatedAmount!=null&&a.currency&&a.ruleEvidence&&["potentially_applicable","likely_applicable"].includes(a.status));
  // The deterministic claim-composition engine's (lib/claims/composition/engine.ts) own per-currency totals are the ONLY total ever shown once a
  // composition result exists -- never a plain sum of each assessment's calculatedAmount, since that would double-count alternative benefits,
  // ignore accelerated-benefit deductions, and ignore aggregate caps. The naive per-currency sum below is only a fallback for the rare case
  // composition could not be computed at all (no wording pages loaded yet).
  const includedBenefits=composition?composition.policies.flatMap(p=>p.benefits).filter(b=>b.status==="included"):[];
  const totals=composition
    ? composition.totalsByCurrency.map(t=>formatMoney(t.includedAmount,t.currency))
    : (()=>{const currencies=[...new Set(calculated.map(a=>a.currency!))];return currencies.map(currency=>formatMoney(calculated.filter(a=>a.currency===currency).reduce((total,a)=>total+a.calculatedAmount!,0),currency));})();
  const includedCount=composition?includedBenefits.length:calculated.length;
  let summary=totals.length&&includedCount>0
    ? `${personName??"This person"}'s ${includedCount>1?"combined potential death benefits total":"potential death benefit is"} ${totals.join(" and ")}, based on confirmed personal cover and the matching uploaded wording. Policy conditions and the insurer's assessment still apply.`
    : `I found ${personName?`${personName}'s`:"this person's"} confirmed personal cover. The wording or unresolved event fact shown below still needs checking before I can calculate a death benefit.`;
  if(assessments.length&&assessments.every(a=>a.status==="not_applicable"))summary="The reported death does not satisfy the checked death-benefit rules for the confirmed cover on file. See the reason for each policy below.";
  if(question)summary+=" I still need the answer below to check the remaining policy condition.";
  return (acknowledgeLoss?"I'm sorry for your loss. ":"")+summary;
}

/** The critical-illness analogue of deathSummary() above -- same shape,
 * same reliance on the ONE composition engine for any total shown, but
 * with the required policy-based-estimate wording and none of the
 * forbidden claim-of-entitlement phrasing (see the CI spec's User-facing
 * result section): never "you definitely have a covered illness", never
 * "your claim will be approved", never "you are entitled to this
 * amount", never "the insurer must pay". */
function ciSummary(assessments:ClaimAssessmentItem[],personName?:string,question?:ClaimQuestion|null,composition?:ClaimCompositionResult|null) {
  const includedBenefits=composition?composition.policies.flatMap(p=>p.benefits).filter(b=>b.status==="included"):[];
  const totals=composition?composition.totalsByCurrency.map(t=>formatMoney(t.includedAmount,t.currency)):[];
  const includedCount=includedBenefits.length;
  let summary=totals.length&&includedCount>0
    ? `Potential policy-based estimate: ${personName??"this person"}'s ${includedCount>1?"combined potential critical-illness benefits total":"potential critical-illness benefit is"} ${totals.join(" and ")}. The uploaded evidence appears consistent with this policy's definition, but medical or insurer review is still required. This is not a diagnosis, claim approval, or guarantee of payment.`
    : `I found ${personName?`${personName}'s`:"this person's"} confirmed critical-illness cover. Medical evidence and policy review are still needed before DearPolicy can show a potential amount. This is not a diagnosis, claim approval, or guarantee of payment.`;
  if(assessments.length&&assessments.every(a=>a.status==="not_applicable"))summary="The reported diagnosis does not satisfy the checked critical-illness definitions for the confirmed cover on file. See the reason for each policy below.";
  if(question)summary+=" I still need the answer below to check the remaining policy condition.";
  return summary;
}

/** The medical-claim analogue of deathSummary()/ciSummary() above -- same
 * reliance on the ONE composition engine for any total shown, phrased as a
 * potential estimate only. Never states an expense will be reimbursed,
 * decides medical necessity, or authorises a claim -- see this module's own
 * doc comments in lib/claims/medical-rules.ts and the calculators it calls. */
function medicalSummary(assessments:ClaimAssessmentItem[],personName?:string,question?:ClaimQuestion|null,composition?:ClaimCompositionResult|null) {
  const includedBenefits=composition?composition.policies.flatMap(p=>p.benefits).filter(b=>b.status==="included"):[];
  const totals=composition?composition.totalsByCurrency.map(t=>formatMoney(t.includedAmount,t.currency)):[];
  const includedCount=includedBenefits.length;
  let summary=totals.length&&includedCount>0
    ? `Potential policy-based estimate: ${personName??"this person"}'s ${includedCount>1?"combined potential medical-claim benefits total":"potential medical-claim benefit is"} ${totals.join(" and ")}. This is based on confirmed personal cover, evidenced policy wording and any reviewed bill/discharge evidence, but is not a guarantee of payment -- the insurer's own assessment still applies.`
    : `I found ${personName?`${personName}'s`:"this person's"} confirmed hospitalisation-related cover. Evidence and policy review are still needed before DearPolicy can show a potential amount. This is not a guarantee that any expense will be reimbursed.`;
  if(assessments.length&&assessments.every(a=>a.status==="not_applicable"))summary="The reported admission does not satisfy the checked medical-claim rules for the confirmed cover on file. See the reason for each policy below.";
  if(question)summary+=" I still need the answer below to check the remaining policy condition.";
  return summary;
}

/** The disability analogue of deathSummary()/ciSummary()/medicalSummary()
 * above -- same reliance on the ONE composition engine for any total
 * shown. Never states permanence is confirmed or that a claim will be
 * approved -- DearPolicy never decides that on its own (see
 * lib/claims/disability-rules.ts's own module doc comment). */
function disabilitySummary(assessments:ClaimAssessmentItem[],personName?:string,question?:ClaimQuestion|null,composition?:ClaimCompositionResult|null) {
  const includedBenefits=composition?composition.policies.flatMap(p=>p.benefits).filter(b=>b.status==="included"):[];
  const totals=composition?composition.totalsByCurrency.map(t=>formatMoney(t.includedAmount,t.currency)):[];
  const includedCount=includedBenefits.length;
  let summary=totals.length&&includedCount>0
    ? `Potential policy-based estimate: ${personName??"this person"}'s ${includedCount>1?"combined potential disability benefits total":"potential disability benefit is"} ${totals.join(" and ")}. This is based on confirmed personal cover, evidenced policy wording and a reviewed medical assessment matched against the policy's own definitions, but is not a guarantee of payment -- the insurer's own assessment still applies. This is not a determination of permanent disability.`
    : `I found ${personName?`${personName}'s`:"this person's"} confirmed disability-related cover. A reviewed medical assessment matched against the policy's own definitions is still needed before DearPolicy can show a potential amount. DearPolicy never decides on its own whether a disability is permanent or matches a schedule-of-injuries row.`;
  if(assessments.length&&assessments.every(a=>a.status==="not_applicable"))summary="The reported disability does not satisfy the checked disability-benefit rules for the confirmed cover on file. See the reason for each policy below.";
  if(question)summary+=" I still need the answer below to check the remaining policy condition.";
  return summary;
}

export async function handleClaimTurn(args:{accountId:string;familyMemberId:string;message:string;claimSessionId?:string|null;personName?:string;timeZone?:string;now?:Date}):Promise<ChatAnswer>{
  let session=args.claimSessionId?await getClaimSession(args.accountId,args.familyMemberId,args.claimSessionId):null;
  if(!session) session=await createClaimSession(args.accountId,args.familyMemberId);

  const facts=await extractClaimFacts({text:args.message,current:session.facts,pendingQuestion:session.pending_question,timeZone:args.timeZone,now:args.now});
  // Reviewer-confirmed cause-definition matches are never trusted from the
  // stored session JSON alone -- reloaded fresh from the evidence
  // pipeline's own source of truth on every turn, so a superseded document
  // or an invalidated match takes effect immediately. See
  // lib/claims/evidence/session-matches.ts.
  if(facts.eventType==="death")facts.causeDefinitionMatches=await loadCauseDefinitionMatchesForFacts(args.accountId,args.familyMemberId,session.id);
  if(facts.eventType==="diagnosis")facts.ciDefinitionMatches=await loadCIDefinitionMatchesForFacts(args.accountId,args.familyMemberId,session.id);
  // Verified (reviewer-confirmed) medical-claim bill facts are likewise never
  // trusted from the stored session JSON -- reloaded fresh on every turn from
  // the evidence pipeline's own source of truth. See lib/claims/evidence/
  // medical-bill-evidence.ts's own doc comment.
  if(facts.eventType==="hospitalisation")facts.verifiedMedicalBillFacts=await loadVerifiedMedicalBillFacts(args.accountId,args.familyMemberId,session.id);
  if(facts.eventType==="disability")facts.disabilityDefinitionMatches=await loadDisabilityDefinitionMatchesForFacts(args.accountId,args.familyMemberId,session.id);
  const coverages=await confirmedOwnedCoverages(args.accountId,args.familyMemberId);
  const currentness=await currentnessNote(args.accountId,args.familyMemberId);
  const knownFacts=[...(args.personName ? [`Person: ${args.personName}`] : []),...factsToLabels(facts)];

  if(!coverages.length){
    const answer=noCoverageAnswer(session.id,knownFacts);
    await saveClaimSession({accountId:args.accountId,familyMemberId:args.familyMemberId,id:session.id,status:"fact_finding",facts,pendingQuestion:null,eventSummary:eventSummary(facts),decisionPacket:null});
    await storeChat({accountId:args.accountId,familyMemberId:args.familyMemberId,sessionId:session.id,user:args.message,answer});
    return answer;
  }

  const relevantProducts=relevantOwnedProducts(facts,coverages);
  // If the event is known and none of the person's confirmed products can respond,
  // stop early rather than interrogating the user about irrelevant details.
  if(facts.eventType && relevantProducts.length===0){
    const answer:ChatAnswer={mode:"claim_assessment",summary:"Based on the personal policies currently uploaded for this person, I do not see a confirmed policy that responds to this type of event.",details:["I checked only policies proven by personalised evidence. I did not treat available products in brochures or product summaries as owned cover."],claimItems:[],nextSteps:["If you have another insurer's certificate or policy schedule, upload it so DearPolicy can include that cover."],confidence:null,citations:[],disclaimer:"This result reflects the personal policies currently uploaded to DearPolicy.",claimSessionId:session.id,questions:[],knownFacts,missingFacts:[]};
    await saveClaimSession({accountId:args.accountId,familyMemberId:args.familyMemberId,id:session.id,status:"complete",facts,pendingQuestion:null,eventSummary:eventSummary(facts),decisionPacket:null});
    await storeChat({accountId:args.accountId,familyMemberId:args.familyMemberId,sessionId:session.id,user:args.message,answer});
    return answer;
  }

  const deathEvidence=facts.eventType === "death" ? await loadDeathEvidence(args.accountId,args.familyMemberId,coverages) : {rules:[],gaps:[],pages:[]};
  const deathRules=deathEvidence.rules;
  const ciEvidence=facts.eventType === "diagnosis" ? await loadCIEvidence(args.accountId,args.familyMemberId,coverages) : {rules:[],gaps:[],pages:[]};
  // Same tiered evidence-resolution pattern as death/CI wording, reused for
  // "hospitalisation" -- see lib/claims/medical-evidence.ts's own doc comment.
  const medicalEvidence=facts.eventType === "hospitalisation" ? await loadMedicalEvidence(args.accountId,args.familyMemberId,coverages) : {cashRules:[],reimbursementRules:[],planProvisions:[],gaps:[],pages:[]};
  // Same tiered evidence-resolution pattern as death/CI/medical wording,
  // reused for "disability" -- see lib/claims/disability-evidence.ts's own
  // doc comment.
  const disabilityEvidence=facts.eventType === "disability" ? await loadDisabilityEvidence(args.accountId,args.familyMemberId,coverages) : {rules:[],gaps:[],pages:[]};
  // Same tiered evidence-resolution pattern as death/CI/medical/disability
  // wording, reused for a family member's Travel cover -- see
  // lib/claims/travel-evidence.ts's own doc comment. Loaded for both
  // "hospitalisation" (Overseas Medical Expenses) and "death" (Accidental
  // Death) events, since lib/claims/travel-rules.ts is additive within
  // BOTH of those existing branches rather than its own top-level event
  // type -- see that module's own doc comment for the V1 scope this
  // implies (an "accident"/"diagnosis" event does not yet surface a travel
  // benefit, even with Travel cover on file). Skipped entirely (no query)
  // when this family member owns no Travel-category coverage.
  const travelEvidence=(facts.eventType === "hospitalisation" || facts.eventType === "death") && coverages.some(c=>c.category==="Travel")
    ? await loadTravelEvidence(args.accountId,args.familyMemberId,coverages)
    : {rules:[],gaps:[],pages:[]};
  const question=nextClaimQuestion(facts,coverages,deathRules,ciEvidence.rules,medicalEvidence,disabilityEvidence,travelEvidence);
  const rawDeathAssessments=facts.eventType === "death" ? assessClaim(facts,coverages,deathRules,deathEvidence.gaps,session.id,[],[],undefined,undefined,travelEvidence) : null;
  const deathAssessments=rawDeathAssessments ? enforceMonetarySafety(rawDeathAssessments,facts,coverages,{householdId:args.accountId,resourceId:session.id}) : null;
  // Additive: the same deterministic pipeline, reused for a "diagnosis"
  // event's critical-illness benefits -- never a parallel claim system.
  // See lib/claims/ci-rules.ts for why this never touches the death path.
  const rawDiagnosisAssessments=facts.eventType === "diagnosis" ? assessClaim(facts,coverages,[],[],session.id,ciEvidence.rules,ciEvidence.gaps) : null;
  const diagnosisAssessments=rawDiagnosisAssessments ? enforceMonetarySafety(rawDiagnosisAssessments,facts,coverages,{householdId:args.accountId,resourceId:session.id}) : null;
  // Additive: the same deterministic pipeline, reused for a "hospitalisation"
  // event's medical-claim benefits (hospital cash, ICU cash, and
  // reimbursement-type benefits) -- never a parallel claim system. See
  // lib/claims/medical-rules.ts for why this never touches the death/CI path.
  const rawHospitalisationAssessments=facts.eventType === "hospitalisation" ? assessClaim(facts,coverages,[],[],session.id,[],[],medicalEvidence,undefined,travelEvidence) : null;
  const hospitalisationAssessments=rawHospitalisationAssessments ? enforceMonetarySafety(rawHospitalisationAssessments,facts,coverages,{householdId:args.accountId,resourceId:session.id}) : null;
  // Additive: the same deterministic pipeline, reused for a "disability"
  // event's TPD/schedule-of-injuries/disability-income benefits -- never a
  // parallel claim system. See lib/claims/disability-rules.ts for why this
  // never touches the death/CI/medical path.
  const rawDisabilityAssessments=facts.eventType === "disability" ? assessClaim(facts,coverages,[],[],session.id,[],[],undefined,disabilityEvidence) : null;
  const disabilityAssessments=rawDisabilityAssessments ? enforceMonetarySafety(rawDisabilityAssessments,facts,coverages,{householdId:args.accountId,resourceId:session.id}) : null;
  // The ONLY place a death claim's benefits are selected, composed, capped
  // and totalled -- see lib/claims/composition/engine.ts's own doc comment.
  // Computed whenever there is something to compose, even while a fact-
  // finding question is still pending, so the preview shown alongside that
  // question already reflects alternative selection, accelerated
  // deductions and caps rather than a naive per-item list. The snapshot is
  // persisted (idempotently, keyed by the engine's own stable
  // calculationId) on every turn it is computed, giving a full audit trail
  // of how the calculated total evolved as facts and evidence were added.
  const deathComposition:ClaimCompositionResult|null = facts.eventType==="death" && deathAssessments
    ? composeClaim({claimEventId:session.id,familyMemberId:args.familyMemberId,facts,coverages,assessments:deathAssessments,wordingPages:[...deathEvidence.pages,...travelEvidence.pages],now:args.now,accountId:args.accountId})
    : null;
  if(deathComposition){
    await recordCompositionSnapshot({accountId:args.accountId,familyMemberId:args.familyMemberId,claimSessionId:session.id,facts,coverages,result:deathComposition});
  }
  // Same composition engine, same reasoning, reused for the critical-illness
  // benefits of a "diagnosis" event -- see lib/claims/composition/engine.ts,
  // whose same-policy grouping now also refuses to default a same-policy
  // multi-CI-benefit group to additive without explicit relationship
  // evidence (lib/claims/composition/types.ts's CI_COMPOSITION_NOT_EVIDENCED).
  const diagnosisComposition:ClaimCompositionResult|null = facts.eventType==="diagnosis" && diagnosisAssessments
    ? composeClaim({claimEventId:session.id,familyMemberId:args.familyMemberId,facts,coverages,assessments:diagnosisAssessments,wordingPages:ciEvidence.pages,now:args.now,accountId:args.accountId})
    : null;
  if(diagnosisComposition){
    await recordCompositionSnapshot({accountId:args.accountId,familyMemberId:args.familyMemberId,claimSessionId:session.id,facts,coverages,result:diagnosisComposition});
  }
  // Same composition engine, same reasoning, reused for the medical-claim
  // benefits of a "hospitalisation" event -- see lib/claims/composition/engine.ts.
  const hospitalisationComposition:ClaimCompositionResult|null = facts.eventType==="hospitalisation" && hospitalisationAssessments
    ? composeClaim({claimEventId:session.id,familyMemberId:args.familyMemberId,facts,coverages,assessments:hospitalisationAssessments,wordingPages:[...medicalEvidence.pages,...travelEvidence.pages],now:args.now,accountId:args.accountId})
    : null;
  if(hospitalisationComposition){
    await recordCompositionSnapshot({accountId:args.accountId,familyMemberId:args.familyMemberId,claimSessionId:session.id,facts,coverages,result:hospitalisationComposition});
  }
  // Same composition engine, same reasoning, reused for the disability
  // benefits of a "disability" event -- see lib/claims/composition/engine.ts,
  // whose same-policy grouping now also refuses to default a same-policy
  // TPD + schedule-of-injuries group to additive without explicit
  // relationship evidence (lib/claims/composition/types.ts's
  // DISABILITY_COMPOSITION_NOT_EVIDENCED).
  const disabilityComposition:ClaimCompositionResult|null = facts.eventType==="disability" && disabilityAssessments
    ? composeClaim({claimEventId:session.id,familyMemberId:args.familyMemberId,facts,coverages,assessments:disabilityAssessments,wordingPages:disabilityEvidence.pages,now:args.now,accountId:args.accountId})
    : null;
  if(disabilityComposition){
    await recordCompositionSnapshot({accountId:args.accountId,familyMemberId:args.familyMemberId,claimSessionId:session.id,facts,coverages,result:disabilityComposition});
  }
  const primaryAssessments=deathAssessments??diagnosisAssessments??hospitalisationAssessments??disabilityAssessments;
  const primaryComposition=deathComposition??diagnosisComposition??hospitalisationComposition??disabilityComposition;
  const newDeath=facts.eventType === "death" && session.event_type !== "death";
  if(question){
    const names=relevantCoverageNames(coverages,relevantProducts);
    const policySummary=coverageListSummary(coverages,relevantProducts);
    const firstTurn=!session.event_type && !session.event_summary;
    const summary=deathAssessments ? deathSummary(deathAssessments,args.personName,question,newDeath,deathComposition)
      : diagnosisAssessments ? ciSummary(diagnosisAssessments,args.personName,question,diagnosisComposition)
      : hospitalisationAssessments ? medicalSummary(hospitalisationAssessments,args.personName,question,hospitalisationComposition)
      : disabilityAssessments ? disabilitySummary(disabilityAssessments,args.personName,question,disabilityComposition)
      : firstTurn
      ? `I found ${names.length?names.join(", "):"confirmed personal cover"} that may be relevant. Before I tell you what you can claim, I need to understand the event properly.`
      : "I have enough to narrow this down, but I still need one material fact before I calculate or rule on the next benefit.";
    const preview=primaryAssessments??[];
    const citations=primaryAssessments ? await assessmentCitations(args.accountId,args.familyMemberId,preview,coverages) : [];
    if(["competitive_racing","racing_authority_sanctioned"].includes(question.id)){
      const rule=deathRules.find(r=>r.benefit==="gpa-accidental-death"&&preview.some(a=>a.coverageId===r.coverageId));
      if(rule?.racingExclusion){
        const page=rule.racingExclusion.page;
        const citation={...rule.citation,chunkId:`page:${rule.citation.policyId}:${page}`,pageStart:page,pageEnd:page,evidenceLabel:"Racing exclusion and exception"};
        if(!citations.some(c=>c.chunkId===citation.chunkId))citations.push(citation);
      }
    }
    const nextSteps=primaryAssessments ? claimNextSteps(facts,preview) : [];
    const missingFacts=[...new Set([missingLabel(question.id),...facts.uncertainFacts.map(missingLabel),...preview.filter(a=>a.status==="needs_document").map(a=>`Evidence for ${a.title}`),...(primaryComposition?.outstandingQuestions??[])])];
    const details=policySummary.length?[`Confirmed cover in scope: ${policySummary.join(" · ")}`]:[];
    if(primaryAssessments)details.push(currentness.detail);
    const answer:ChatAnswer={mode:"fact_finding",summary,details,claimItems:preview.map(a=>({title:a.title,status:a.status,amountText:a.amountText,reason:a.reason,conditions:a.conditions})),nextSteps,confidence:null,citations,disclaimer:primaryAssessments?"These are potential benefits based on confirmed personal cover and uploaded wording. Remaining conditions and final approval stay with the insurer.":"DearPolicy asks only for facts that can change eligibility, payout or claim steps.",claimSessionId:session.id,questions:[question],knownFacts,missingFacts,composition:primaryComposition?toClaimCompositionView(primaryComposition):undefined};
    const decisionPacket:ClaimDecisionPacket|null=primaryAssessments?{sessionId:session.id,eventSummary:eventSummary(facts),facts,knownFacts,missingFacts,relevantOwnedProducts:relevantCoverageNames(coverages,relevantProducts),assessments:preview,nextSteps,ready:false,compositionResult:primaryComposition??null}:null;
    await saveClaimSession({accountId:args.accountId,familyMemberId:args.familyMemberId,id:session.id,status:"fact_finding",facts,pendingQuestion:question,eventSummary:eventSummary(facts),decisionPacket});
    await storeChat({accountId:args.accountId,familyMemberId:args.familyMemberId,sessionId:session.id,user:args.message,answer});
    return answer;
  }

  const assessments=deathAssessments??diagnosisAssessments??hospitalisationAssessments??disabilityAssessments??enforceMonetarySafety(assessClaim(facts,coverages,[],[],session.id),facts,coverages,{householdId:args.accountId,resourceId:session.id});
  const citations=await assessmentCitations(args.accountId,args.familyMemberId,assessments,coverages);
  const nextSteps=claimNextSteps(facts,assessments);
  if(!currentness.verified)nextSteps.push("Upload the latest renewal notice or premium receipt if available so DearPolicy can verify current policy status separately from coverage ownership.");
  const likely=assessments.filter(a=>a.status==="likely_applicable").length;
  const possible=assessments.filter(a=>a.status==="potentially_applicable"||a.status==="needs_document").length;
  let summary=assessments.length===0
    ? "Based on the facts you gave me and the confirmed policies on file, I do not see a matching claim benefit yet."
    : likely>0
      ? `I found ${likely} benefit${likely===1?"":"s"} that look applicable from the facts you gave me${possible?`, plus ${possible} that need a condition or document checked`:""}.`
      : `I found ${possible} benefit${possible===1?"":"s"} that may apply, but each still needs a policy condition or document checked.`;
  if (facts.eventType === "death") {
    summary=deathSummary(assessments,args.personName,null,newDeath,deathComposition);
  }
  if (facts.eventType === "diagnosis") {
    summary=ciSummary(assessments,args.personName,null,diagnosisComposition);
  }
  if (facts.eventType === "hospitalisation") {
    summary=medicalSummary(assessments,args.personName,null,hospitalisationComposition);
  }
  if (facts.eventType === "disability") {
    summary=disabilitySummary(assessments,args.personName,null,disabilityComposition);
  }
  const finalComposition=deathComposition??diagnosisComposition??hospitalisationComposition??disabilityComposition;
  const missingFacts = [...new Set([...facts.uncertainFacts.map(missingLabel),...assessments.filter(a => a.status === "needs_document").map(a => `Evidence for ${a.title}`),...(finalComposition?.outstandingQuestions??[])])];
  const decisionPacket:ClaimDecisionPacket={sessionId:session.id,eventSummary:eventSummary(facts),facts,knownFacts,missingFacts,relevantOwnedProducts:relevantCoverageNames(coverages,relevantProducts),assessments,nextSteps,ready:true,compositionResult:finalComposition??null};
  const answer:ChatAnswer={mode:"claim_assessment",summary,details:[`Event checked: ${eventSummary(facts)}.`,currentness.detail],claimItems:assessments.map(a=>({title:a.title,status:a.status,amountText:a.amountText,reason:a.reason,conditions:a.conditions})),nextSteps,confidence:null,citations,disclaimer:"DearPolicy's claim calculations come from confirmed personal cover plus the uploaded policy rules. Final claim approval and admissibility remain with the insurer.",claimSessionId:session.id,questions:[],knownFacts,missingFacts,composition:finalComposition?toClaimCompositionView(finalComposition):undefined};
  await saveClaimSession({accountId:args.accountId,familyMemberId:args.familyMemberId,id:session.id,status:"complete",facts,pendingQuestion:null,eventSummary:eventSummary(facts),decisionPacket});
  await storeChat({accountId:args.accountId,familyMemberId:args.familyMemberId,sessionId:session.id,user:args.message,answer});
  return answer;
}
