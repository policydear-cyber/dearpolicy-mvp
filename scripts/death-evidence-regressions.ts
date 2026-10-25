import { definitionWordingHash } from "@/lib/claims/evidence/decision-selection";
import assert from "node:assert/strict";
import fixture from "./fixtures/singlife-death-wording.json";
import { canonicalDeathInsurer, findDeathRule, resolveDeathEvidence, type DeathRuleEvidence, type DeathWordingPage } from "@/lib/claims/death-evidence";
import { extractClaimFacts } from "@/lib/claims/facts";
import { assessClaim, nextClaimQuestion } from "@/lib/claims/rules";
import type { CauseDefinitionMatch } from "@/lib/claims/calculators/evidence";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { verifiedEvidenceProvenance } from "./fixtures/verified-evidence-provenance";

export async function runDeathEvidenceRegressions() {
  let cases=0;
  const test=(name:string,fn:()=>void)=>{try{fn();cases++;}catch(error){throw new Error(name,{cause:error});}};
  const base:OwnedCoverage={id:"gtl",policyId:"personal",familyMemberId:"desmond",category:"Death",amount:1_000_000,currency:"SGD",productName:"Group Term Life",sourcePage:1,evidenceText:"personal certificate",insurer:"Singapore Life Ltd",policyName:"MINDEF & MHA",policyNumber:"personal",groupPolicyNumber:"G007500",documentRole:"certificate",effectiveDate:"2022-10-06",renewalOrExpiryDate:null, currencyVerified: true};
  const covers=[base,{...base,id:"gpa",category:"Personal Accident",amount:600_000,productName:"Group Personal Accident"}];
  const pages=fixture.benefitSummary.pages.map(p=>({page_number:p.pageNumber,text:p.text}));
  const rows:DeathWordingPage[]=pages.map(p=>({...p,policy_id:"summary",group_policy_number:null,insurer:"Singlife",product_name:"Benefit Summary",original_filename:fixture.benefitSummary.sourceFile,document_role:"benefit_guide",personal_coverage_confirmed:false,linked_to_member:false}));
  const context={now:new Date("2026-09-14T12:00:00Z"),timeZone:"Asia/Singapore",allowAi:false};
  const facts=await extractClaimFacts({text:"desmond died in a motorbike accident yesterday",...context});
  const result=resolveDeathEvidence(covers,rows);
  const SESSION_ID="session-death-evidence-regressions";
  // Builds the one applicable, policy-specific match for the gpa-accidental-
  // death rule actually resolved from the real wording fixture -- the
  // definitionEvidence must reference the exact clause rules.ts will quote,
  // never a hand-picked page number.
  const confirmedMatch=(rules:DeathRuleEvidence[]):CauseDefinitionMatch=>{
    const rule=rules.find(r=>r.benefit==="gpa-accidental-death")!;
    return {familyMemberId:"desmond",claimEventId:SESSION_ID,contractId:"personal",coverageId:"gpa",
      causeEvidence:{documentId:"police-report-1",documentType:"police_report",pageStart:1,pageEnd:1,familyMemberId:"desmond",claimEventId:SESSION_ID},
      definitionEvidence:{policyId:rule.citation.policyId,chunkId:rule.citation.chunkId,pageStart:rule.citation.pageStart,pageEnd:rule.citation.pageEnd,wordingHash:definitionWordingHash(rule.quote)},
      result:"matches",reviewedAt:"2026-09-14",provenance:verifiedEvidenceProvenance("police-report-1")};
  };
  test("Actual Certificate Part 2 promises pay the full Sum Insured without 100%",()=>{
    assert.equal(findDeathRule(pages,"Group Term Life")?.page,3);
    assert.equal(findDeathRule(pages,"Group Personal Accident")?.page,5);
    assert.match(result.rules[0].quote,/will pay the relevant Sum Insured for death/i);
    assert.equal(result.rules.length,2);assert.deepEqual(result.gaps,[]);
  });
  test("Actual Product Summary table layout still verifies both benefits",()=>{
    const productPages=fixture.productSummary.pages.map(p=>({page_number:p.pageNumber,text:p.text}));
    assert.equal(findDeathRule(productPages,"Group Term Life")?.page,5);
    assert.equal(findDeathRule(productPages,"Group Personal Accident")?.page,10);
  });
  test("Supplied legal and brand insurer names match, unrelated names do not",()=>{
    for(const name of ["Singapore Life Ltd.","Singapore Life Limited","Singlife","Singlife with Aviva"])assert.equal(canonicalDeathInsurer(name),"singlife");
    assert.notEqual(canonicalDeathInsurer("Aviva"),"singlife");
    assert.equal(resolveDeathEvidence(covers,rows.map(r=>({...r,insurer:"Another insurer"}))).rules.length,0);
  });
  test("An insurer in any market is one insurer however its legal form is printed, and two insurers stay two",()=>{
    for(const name of ["Zurich Insurance Company Ltd","ZURICH INSURANCE COMPANY LIMITED","Zurich Insurance Co."])assert.equal(canonicalDeathInsurer(name),"zurichinsurance");
    assert.equal(canonicalDeathInsurer("CareFirst, Inc."),canonicalDeathInsurer("CareFirst"));
    for(const name of ["Example Assurance Sdn. Bhd.","Example Assurance Pty Ltd","Example Assurance Private Limited","Example Assurance Pvt. Ltd.","Example Assurance GmbH"])assert.equal(canonicalDeathInsurer(name),"exampleassurance",name);
    assert.equal(canonicalDeathInsurer("Allianz SE"),"allianzse");
    assert.notEqual(canonicalDeathInsurer("AIA Life"),canonicalDeathInsurer("AIA General"));
    assert.notEqual(canonicalDeathInsurer("Zurich Life Insurance"),canonicalDeathInsurer("Zurich Insurance"));
    assert.equal(canonicalDeathInsurer("Ltd"),"ltd");
    assert.equal(canonicalDeathInsurer("  "),null);
  });
  test("Missing insurer metadata can use the explicit legal issuer printed in the PDF",()=>{
    assert.equal(resolveDeathEvidence(covers,rows.map(r=>({...r,insurer:null}))).rules.length,2);
  });
  test("Shared summary needs no duplicate upload or personal member link",()=>{
    assert.equal(resolveDeathEvidence(covers.map(c=>({...c,familyMemberId:"charmaine"})),rows).rules.length,2);
    assert.deepEqual(resolveDeathEvidence([],rows),{rules:[],gaps:[]});
    assert.equal(resolveDeathEvidence([covers[0]],rows).rules.length,1);
  });
  test("Another person's personalised document cannot establish this person's rule",()=>{
    assert.equal(resolveDeathEvidence(covers,rows.map(r=>({...r,personal_coverage_confirmed:true,document_role:"certificate"}))).rules.length,0);
  });
  test("Contradictory extracted group is rejected despite the correct group printed elsewhere",()=>{
    assert.equal(resolveDeathEvidence(covers,rows.map(r=>({...r,group_policy_number:"OTHER-GROUP"}))).rules.length,0);
  });
  test("An incidental group-number mention cannot replace a group-policy heading",()=>{
    const incidental=rows.map(r=>({...r,text:r.text.replace(/GROUP POLICY NO\. G007500/g,"a comparison with G007500")}));
    assert.equal(resolveDeathEvidence(covers,incidental).rules.length,0);
  });
  test("Payout uses personalised sums rather than available-product maximums",()=>{
    const owned=covers.map(c=>({...c,amount:c.id==="gtl"?250_000:100_000}));
    const evidence=resolveDeathEvidence(owned,rows);
    assert.equal(assessClaim({...facts,competitiveRacing:false,causeOfDeathDocumentAvailable:true,causeOfDeathEvidenceReviewed:true,causeDefinitionMatches:[confirmedMatch(evidence.rules)]},owned,evidence.rules,[],SESSION_ID).reduce((sum,i)=>sum+(i.calculatedAmount??0),0),350_000);
  });
  test("Actual racing exclusion keeps its Authority-sanctioned exception",()=>{
    const exclusion=result.rules.find(r=>r.benefit==="gpa-accidental-death")?.racingExclusion;
    assert.equal(exclusion?.page,10);assert.equal(exclusion?.authorityException,true);assert.match(exclusion?.quote??"",/except for those sanctioned by the Authority/i);
    assert.equal(nextClaimQuestion(facts,covers,result.rules)?.id,"competitive_racing");
    assert.equal(nextClaimQuestion({...facts,competitiveRacing:true},covers,result.rules)?.id,"racing_authority_sanctioned");
    const unknown=assessClaim({...facts,competitiveRacing:true},covers,result.rules,[],SESSION_ID).find(i=>i.id==="gpa-accidental-death");
    assert.equal(unknown?.status,"needs_document");assert.equal(unknown?.amountText,null);
    assert.equal(assessClaim({...facts,competitiveRacing:true,racingAuthoritySanctioned:false},covers,result.rules,[],SESSION_ID).find(i=>i.id==="gpa-accidental-death")?.status,"not_applicable");
    const sanctioned=assessClaim({...facts,competitiveRacing:true,racingAuthoritySanctioned:true,causeOfDeathDocumentAvailable:true,causeOfDeathEvidenceReviewed:true,causeDefinitionMatches:[confirmedMatch(result.rules)]},covers,result.rules,[],SESSION_ID).find(i=>i.id==="gpa-accidental-death");
    assert.equal(sanctioned?.calculatedAmount,600_000);assert.ok(sanctioned?.conditions.some(c=>/proof.*sanctioned/i.test(c)));
  });
  test("Partial or discretionary promises cannot be treated as the full death sum",()=>{
    const changed=pages.map(p=>({...p,text:p.text.replace(/will pay the relevant Sum Insured for death/gi,"may pay up to 50% of Sum Insured for death")}));
    assert.equal(findDeathRule(changed,"Group Term Life"),null);assert.equal(findDeathRule(changed,"Group Personal Accident"),null);
  });
  test("A death clause split between PDF pages retains both citation pages",()=>{
    const text=pages.find(p=>p.page_number===3)!.text;
    const split=text.indexOf("will pay the relevant Sum Insured for death");
    const found=findDeathRule([{page_number:3,text:text.slice(0,split)},{page_number:4,text:text.slice(split)}],"Group Term Life");
    assert.equal(found?.page,3);assert.equal(found?.pageEnd,4);
  });
  test("Uploaded but unreadable wording is distinguished from a missing upload",()=>{
    const unreadable=resolveDeathEvidence(covers,rows.map(r=>({...r,text:r.page_number===1?r.text:"unreadable benefit page"})));
    assert.equal(unreadable.rules.length,0);assert.ok(unreadable.gaps.every(g=>/document is uploaded/i.test(g.reason)));
    assert.ok(unreadable.gaps.every(g=>!/upload/i.test(g.nextStep.replace("uploaded",""))));
  });
  const noRacing=await extractClaimFacts({text:"It was not competitive racing",current:facts,...context});
  const sanctioned=await extractClaimFacts({text:"Yes, racing sanctioned by MINDEF",current:facts,...context});
  const notSanctioned=await extractClaimFacts({text:"The racing was not sanctioned by the Authority",current:facts,...context});
  test("Explicit racing and sanction facts are retained without repeated questions",()=>{
    assert.equal(noRacing.competitiveRacing,false);assert.equal(nextClaimQuestion(noRacing,covers,result.rules)?.id,"cause_of_death_document");
    assert.equal(sanctioned.competitiveRacing,true);assert.equal(sanctioned.racingAuthoritySanctioned,true);assert.equal(nextClaimQuestion(sanctioned,covers,result.rules)?.id,"cause_of_death_document");
    assert.equal(notSanctioned.racingAuthoritySanctioned,false);
  });
  const unknown=await extractClaimFacts({text:"Not sure whether there was racing",current:facts,pendingQuestion:{id:"competitive_racing",text:"Racing?",type:"yes_no",why:"test"},...context});
  test("Unknown racing is deferred without being turned into a reported race",()=>{
    assert.equal(unknown.competitiveRacing,null);assert.equal(nextClaimQuestion(unknown,covers,result.rules)?.id,"cause_of_death_document");
  });
  console.log(`DearPolicy real-PDF death-wording regressions passed (${cases} scenarios).`);
}
