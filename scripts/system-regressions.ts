import assert from "node:assert/strict";
import { applyExplicitDeferrals,hasQuote,knownValue,mergeInterpretation,modelFactContext,numberStated,reportedConditionStatement,type Interpretation } from "@/lib/chat/facts";
import { aggregatePotentialPayouts,assessmentFromBenefit,calculatePolicyFormula,evaluateRequirement,evidenceWindows,validateAnalysis } from "@/lib/chat/policy-analysis";
import { analysisSources,buildContracts,passageBudget,productIdentity,referenceMatchReason,referenceMatches,type InventoryDocument,type PolicyContract } from "@/lib/policies/inventory";
import { contractReviewCoverage,negativeConclusionPermitted,negativeCoverageClaim,pagesSpanned,summarizeReviewCoverage } from "@/lib/policies/review-coverage";
import { assessCurrentness,contractCurrentness,matchPremiumEvidence,type PremiumEvidenceRow } from "@/lib/policies/currentness";
import { describeChoice,modelFor } from "@/lib/ai/providers";
import { definedConditionsFor,matchesPolicySchedule,paysOnDefinedCondition } from "@/lib/insurance/defined-conditions";
import { deterministicDocumentRole } from "@/lib/documents/intelligence";
import { detectHighConfidenceReferenceRole } from "@/lib/ai/extract-policy";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ConversationState,PolicyBenefit,PolicySource,ScenarioClassification,SubjectFacts } from "@/lib/chat/types";
import { resolveClaimDate } from "@/lib/claims/dates";
import { benefitRows,benefitRowsFromText,columnBands,lineFrom,renderPageLayout,type TextItem } from "@/lib/documents/layout";
import { basisForRow,dailyLimitsFrom,expenseFactKey,parseBenefitValue,percentageBases } from "@/lib/policies/benefit-rows";
import { assessCatalogBenefit,benefitTraits,coverageForBenefit,eventPredatesCover,eventTraits,injuryNotReported,looksLikeCoverageLine,matchBenefits,namesASpecificInjury,ruleFromQuote,ruledOutBenefits,validateCatalogFormula,type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { benefitTriggerEvents,coverKey,reportedClaimEvents,ruledOutByEvent } from "@/lib/insurance/claim-events";
import { acceleratedBenefitWarnings,applyPolicyAggregateCaps,describeCoverSplit,resolveCoverOverlaps } from "@/lib/insurance/cover-composition";
import { transposedScheduleWarnings } from "@/lib/insurance/schedule-consistency";
import { applyImpliedScaleLimit,corroborateInferredRules,holdNonMonotonicBands,impliedScaleLimit,resolveStoredRules } from "@/lib/insurance/scale-limit";
import { amountAlternatives,ALTERNATIVES_NOTE } from "@/lib/policies/amount-alternatives";
import { rowSupported } from "@/lib/ledger/extract";
import type { ClaimItem } from "@/types";
import { readableModelFailure,repairTruncatedJson,TruncatedModelOutput } from "@/lib/ai/llm";
import { coercePolicyAnalysis,PolicyAnalysisSchema,readingOutputTokens } from "@/lib/chat/policy-analysis";
import { z } from "zod";
import { claimConfidence,readingBudget } from "@/lib/chat/workflow";
import { allocateReadingWindows,candidateFromWindows,rankCandidates } from "@/lib/policies/relevance";

export function runSystemRegressions(){
  let cases=0;const test=(name:string,fn:()=>void)=>{try{fn();cases++;}catch(error){throw new Error(name,{cause:error});}};
  const now=new Date("2026-09-14T12:00:00Z"),person="person-a";
  const document=(override:Partial<InventoryDocument>={}):InventoryDocument=>({
    id:"schedule",insurer:"Example Insurer",product_name:"Flexible Plan",policy_number:"P-100",group_policy_number:null,
    policy_type:"other",document_role:"personal_schedule",personal_coverage_confirmed:true,document_authority:95,
    needs_review:false,processing_status:"ready",original_filename:"schedule.pdf",updated_at:"2026-09-14",
    effective_date:"2022-01-01",renewal_or_expiry_date:null,member_ids:[person],products:["Flexible Plan"],header:"",
    page_total:2,chunk_total:2,...override});
  const coverage=(override:Partial<OwnedCoverage>={}):OwnedCoverage=>({
    id:"cover-a",policyId:"schedule",familyMemberId:person,category:"Other",amount:350000,currency:"SGD",productName:"Flexible Plan",
    sourcePage:1,evidenceText:"Verified cover",insurer:"Example Insurer",policyName:"Flexible Plan",policyNumber:"P-100",groupPolicyNumber:null,
    documentRole:"personal_schedule",effectiveDate:"2022-01-01",renewalOrExpiryDate:null, currencyVerified: true,...override});
  const contract:PolicyContract={id:"contract",ownerId:person,ownerName:"Person A",name:"Flexible Plan",insurer:"Example Insurer",
    documents:[document()],references:[document({id:"wording",personal_coverage_confirmed:false,document_role:"policy_wording"})],
    coverages:[coverage()],confirmed:true,effectiveDate:"2022-01-01",ownershipBasis:"evidence"};
  const source=(text:string,overrides:Partial<PolicySource>={}):PolicySource=>({
    id:"source-a",policyId:"wording",text,pageStart:1,pageEnd:1,productScopes:["Flexible Plan"],
    citation:{chunkId:"source-a",policyId:"wording",policyName:"Flexible Plan",pageStart:1,pageEnd:1},...overrides});
  const benefit=(text="We pay 100% of Sum Insured for a qualifying critical illness.",overrides:Partial<PolicyBenefit>={}):PolicyBenefit=>({
    title:"Defined benefit",coverageId:"cover-a",evidence:[{sourceId:"source-a",quote:text}],
    formula:{kind:"sum_insured",value:1,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,evidence:{sourceId:"source-a",quote:text}},
    requirements:[],conditions:[],...overrides});
  const fact=(value:string|number|boolean|null,state:"known"|"unknown"|"pending"="known")=>({value,state,quote:String(value),recordedAt:now.toISOString(),source:"user" as const});
  const initial:ConversationState={subjects:{[person]:{diagnosis:fact("stage 2 breast cancer")}},intent:"claim",activeQuery:"Cancer claim",
    pending:{id:"hospitalised",factKey:"hospitalised",subjectId:person,type:"text",text:"Were you admitted?",why:"Hospital cash"}};
  const parsed:Interpretation={intent:"follow_up",newTopic:false,searchTerms:[],facts:[]};
  test("Counterfactual language cannot create a death claim",()=>{
    const message="He almost died in the motorbike accident.";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,facts:[
      {subjectId:person,key:"death",value:true,state:"known",quote:message},
      {subjectId:person,key:"eventType",value:"death",state:"known",quote:message},
    ],scenarioCandidates:[{subjectId:person,label:"Death",family:"death",traits:["death","accident"],quote:message}]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"death"),null);
    assert.notEqual(knownValue(state.subjects[person],"eventType"),"death");
    assert.equal(state.scenarios?.[person]?.length??0,0);
  });
  test("Murder is retained as a reported death and location, not assumed accidental",()=>{
    const message="Desmond was murdered in Thailand";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,intent:"claim",facts:[]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"death"),true);
    assert.equal(knownValue(state.subjects[person],"eventType"),"death");
    assert.equal(knownValue(state.subjects[person],"causeOfDeath"),"murdered");
    assert.equal(knownValue(state.subjects[person],"eventLocation"),"Thailand");
    assert.equal(knownValue(state.subjects[person],"accidentalDeath"),null);
    assert.ok(state.scenarios?.[person]?.some(s=>s.label==="Reported homicide"&&s.traits.includes("violent")));
  });
  test("A factual homicide report remains a claim when the same turn asks about cover",()=>{
    const message="Desmond was murdered in Thailand. What can I claim?";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,intent:"policy_question",facts:[]},message,subjectIds:[person],now});
    assert.equal(state.intent,"claim");assert.equal(knownValue(state.subjects[person],"death"),true);
    assert.equal(knownValue(state.subjects[person],"eventLocation"),"Thailand");
  });
  test("A reported condition survives a weak model interpretation",()=>{
    const message="Charmaine caught dengue";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,intent:"policy_question",facts:[]},message,subjectIds:[person],now});
    assert.equal(state.intent,"claim");assert.equal(knownValue(state.subjects[person],"diagnosis"),"dengue");
    assert.ok(state.scenarios?.[person]?.some(s=>s.family==="illness"&&s.traits.includes("diagnosis")));
  });
  test("Condition grammar is general but rejects hypotheticals",()=>{
    assert.equal(reportedConditionStatement("Alex contracted leptospirosis")?.condition,"leptospirosis");
    assert.equal(reportedConditionStatement("If Alex caught dengue, would it pay?"),null);
  });
  test("A hypothetical murder question does not report a death",()=>{
    const message="If Desmond was murdered in Thailand, would the policy pay?";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,intent:"policy_question",facts:[
      {subjectId:person,key:"death",value:true,state:"known",quote:message},
    ]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"death"),null);
  });
  test("An accident and a later death are not silently made causal",()=>{
    const message="He had a motorbike accident last week. He died yesterday.";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,facts:[
      {subjectId:person,key:"death",value:true,state:"known",quote:"He died yesterday."},
      {subjectId:person,key:"accidentalDeath",value:true,state:"known",quote:message},
      {subjectId:person,key:"causeOfDeath",value:"motorbike accident",state:"known",quote:message},
    ]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"death"),true);
    assert.equal(knownValue(state.subjects[person],"accidentalDeath"),null);
    assert.equal(knownValue(state.subjects[person],"causeOfDeath"),null);
  });
  test("An explicitly causal accidental death is retained",()=>{
    const message="He died from injuries caused by the motorbike accident.";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,facts:[
      {subjectId:person,key:"death",value:true,state:"known",quote:message},
      {subjectId:person,key:"accidentalDeath",value:true,state:"known",quote:message},
      {subjectId:person,key:"causeOfDeath",value:"motorbike accident",state:"known",quote:message},
    ]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"death"),true);
    assert.equal(knownValue(state.subjects[person],"accidentalDeath"),true);
    assert.equal(knownValue(state.subjects[person],"causeOfDeath"),"motorbike accident");
  });
  test("A reported death remains the terminal event during later injury detail",()=>{
    const prior:ConversationState={...initial,subjects:{[person]:{
      death:fact(true),eventType:fact("death"),causeOfDeath:fact("motorbike accident"),accidentalDeath:fact(true),
    }}};
    const message="The accident also injured his wrist.";
    const state=mergeInterpretation({state:prior,interpretation:{...parsed,facts:[
      {subjectId:person,key:"eventType",value:"accident",state:"known",quote:message},
      {subjectId:person,key:"injured",value:true,state:"known",quote:message},
    ]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"eventType"),"death");
    assert.equal(knownValue(state.subjects[person],"injured"),true);
  });
  test("An explicit alive correction clears stale death causality",()=>{
    const prior:ConversationState={...initial,subjects:{[person]:{
      death:fact(true),deathDate:fact("2026-09-13"),eventType:fact("death"),causeOfDeath:fact("motorbike accident"),accidentalDeath:fact(true),
    }}};
    const message="Actually, he is alive after the accident.";
    const state=mergeInterpretation({state:prior,interpretation:{...parsed,facts:[
      {subjectId:person,key:"death",value:false,state:"known",quote:message},
      {subjectId:person,key:"eventType",value:"accident",state:"known",quote:message},
    ]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"death"),false);
    assert.equal(knownValue(state.subjects[person],"eventType"),"accident");
    assert.equal(state.subjects[person].deathDate,undefined);
    assert.equal(state.subjects[person].causeOfDeath,undefined);
    assert.equal(state.subjects[person].accidentalDeath,undefined);
  });
  test("A short answer can resolve a pending cause-of-death question",()=>{
    const prior:ConversationState={...initial,subjects:{[person]:{death:fact(true),eventType:fact("death")}},
      pending:{id:"cause",factKey:"accidentalDeath",subjectId:person,type:"text",text:"Was the death caused by an accident?",why:"Accidental death wording"}};
    const state=mergeInterpretation({state:prior,interpretation:{...parsed,facts:[
      {subjectId:person,key:"accidentalDeath",value:true,state:"known",quote:"Yes."},
    ]},message:"Yes.",subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"accidentalDeath"),true);
  });
  test("Unknown future nights can answer an admission question",()=>{
    const state=applyExplicitDeferrals(initial,"still not sure how many nights she needs to be warded for",[person],now);
    assert.equal(state.subjects[person].hospitalNights.state,"pending");assert.equal(knownValue(state.subjects[person],"hospitalised"),true);
    assert.equal(knownValue(state.subjects[person],"hospitalStayOngoing"),true);
  });
  test("Unknown wording is not anchored to the start of a message",()=>{
    const state=applyExplicitDeferrals(initial,"i still don’t know how many nights",[person],now);
    assert.equal(state.subjects[person].hospitalNights.state,"pending");
  });
  test("A pending bill never becomes zero",()=>{
    const state=applyExplicitDeferrals(initial,"I still don't know how much the hospital bill will be",[person],now);
    assert.equal(knownValue(state.subjects[person],"hospitalBill"),null);assert.equal(state.subjects[person].hospitalBill.state,"pending");
  });
  test("An ongoing stay is not a completed duration",()=>{
    const message="She is still in hospital after two nights.";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,facts:[
      {subjectId:person,key:"hospitalStayOngoing",value:true,state:"known",quote:message},
      {subjectId:person,key:"hospitalNights",value:2,state:"known",quote:message},
    ]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"hospitalNights"),null);
  });
  test("Known facts can later replace an unknown",()=>{
    const uncertain=applyExplicitDeferrals(initial,"I still don't know how many nights",[person],now);
    const message="She was discharged after twelve nights.";
    const state=mergeInterpretation({state:uncertain,interpretation:{...parsed,facts:[
      {subjectId:person,key:"hospitalNights",value:12,state:"known",quote:message},
      {subjectId:person,key:"hospitalStayOngoing",value:false,state:"known",quote:message},
    ]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"hospitalNights"),12);
  });
  test("A follow-up preserves the original claim question",()=>{
    const state=mergeInterpretation({state:initial,interpretation:parsed,message:"I still don't know",subjectIds:[person],now});
    assert.equal(state.activeQuery,"Cancer claim");
  });
  test("Unquoted model facts are rejected",()=>{
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,facts:[{subjectId:person,key:"hospitalBill",value:999,state:"known",quote:"A made-up bill"}]},message:"No bill yet",subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"hospitalBill"),null);
  });
  test("Another subject's facts are rejected",()=>{
    const message="Bill SGD 220";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,facts:[{subjectId:"someone-else",key:"hospitalBill",value:220,state:"known",quote:message}]},message,subjectIds:[person],now});
    assert.equal(state.subjects["someone-else"],undefined);
  });
  test("Semantic values cannot replace an explicitly stated diagnosis",()=>{
    const message="Stage 2 breast cancer";
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,facts:[{subjectId:person,key:"diagnosis",value:"qualifying Major Cancer",state:"known",quote:message}]},message,subjectIds:[person],now});
    assert.equal(knownValue(state.subjects[person],"diagnosis"),"stage 2 breast cancer");
  });
  test("Relative dates are anchored to the message time",()=>{
    const state=mergeInterpretation({state:initial,interpretation:{...parsed,facts:[{subjectId:person,key:"diagnosisDate",value:"yesterday",state:"known",quote:"yesterday"}]},message:"Diagnosed yesterday",subjectIds:[person],now,timeZone:"Asia/Singapore"});
    assert.equal(knownValue(state.subjects[person],"diagnosisDate"),"2026-09-13");
  });
  test("A later follow-up does not move a saved diagnosis date",()=>{
    const state=mergeInterpretation({state:{...initial,subjects:{[person]:{diagnosisDate:fact("2026-09-13")}}},interpretation:parsed,message:"Still waiting for a bill",subjectIds:[person],now:new Date("2026-09-18T12:00:00Z")});
    assert.equal(knownValue(state.subjects[person],"diagnosisDate"),"2026-09-13");
  });
  test("Number proof supports written numbers and rejects substring matches",()=>{
    assert.equal(numberStated("two hundred and twenty",220),true);assert.equal(numberStated("twenty two nights",22),true);
    assert.equal(numberStated("SGD 220",2),false);assert.equal(numberStated("-100",100),false);
  });
  test("Model context remains bounded while storage retains all facts",()=>{
    const facts:SubjectFacts={};for(let i=0;i<500;i++)facts["fact"+i]=fact("A long fact value "+i);
    const state={subjects:{[person]:facts}};const context=modelFactContext(state,[person],1800);
    assert.ok(JSON.stringify(context).length<2100);assert.ok(context.omittedFactCount>0);assert.equal(Object.keys(state.subjects[person]).length,500);
  });
  test("Source-backed full insured amount is calculated in the application",()=>{
    const b=benefit();assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(b.evidence[0].quote)],facts:{}})?.amount,350000);
  });
  test("Unknown hospital nights do not delay a separate lump sum",()=>{
    const b=benefit(),facts={hospitalNights:fact(null,"pending")};
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(b.evidence[0].quote)],facts})?.amount,350000);
  });
  test("False formulas and source IDs cannot create payouts",()=>{
    const b=benefit();b.formula.value=1.5;
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(b.evidence[0].quote)],facts:{}}),null);
    b.formula.value=1;b.formula.evidence!.sourceId="fake-source";
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(b.evidence[0].quote)],facts:{}}),null);
  });
  test("An unowned coverage identifier cannot create a benefit",()=>{
    const b=benefit(undefined,{coverageId:"unowned"});
    assert.equal(validateAnalysis({benefits:[b],observations:[],nextSteps:[]},[source(b.evidence[0].quote)],contract).benefits.length,0);
  });
  test("An unknown product section cannot authorise multi-product arithmetic",()=>{
    const b=benefit(),c={...contract,references:[document({id:"wording",product_name:"Group booklet",products:["Flexible Plan","Different Plan"],personal_coverage_confirmed:false})]};
    assert.equal(calculatePolicyFormula({benefit:b,contract:c,sources:[source(b.evidence[0].quote,{productScopes:[]})],facts:{}}),null);
  });
  test("A different product section cannot supply the formula",()=>{
    const b=benefit();assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(b.evidence[0].quote,{productScopes:["Different Plan"]})],facts:{}}),null);
  });
  test("Confirmed sum insured is not silently reduced by unsupported deductions",()=>{
    const b=benefit("We pay the Sum Insured less previous benefits.");
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(b.evidence[0].quote)],facts:{}}),null);
  });
  test("A percentage-of-a-flat-limit table pays that limit, not the policy's own Sum Insured",()=>{
    const text="Arm, Elbow, Wrist or Ribs: 25% of the Simple Fracture Benefit Limit of S$5,000.",b=benefit(text);
    b.formula={...b.formula,kind:"limit_percentage",value:0.25,limitAmount:5000};
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(text)],facts:{}})?.amount,1250,
      "25% of the quoted S$5,000 limit is S$1,250, not 25% of the contract's S$350,000 Sum Insured");
  });
  test("A limit-percentage payout cannot invent either figure it wasn't quoted",()=>{
    const text="Arm, Elbow, Wrist or Ribs: 25% of the Simple Fracture Benefit Limit of S$5,000.",b=benefit(text);
    b.formula={...b.formula,kind:"limit_percentage",value:0.25,limitAmount:5000};
    assert.equal(calculatePolicyFormula({benefit:{...b,formula:{...b.formula,limitAmount:6000}},contract,sources:[source(text)],facts:{}}),null,
      "A limit the quote does not state cannot be computed from");
    assert.equal(calculatePolicyFormula({benefit:{...b,formula:{...b.formula,value:0.5}},contract,sources:[source(text)],facts:{}}),null,
      "A percentage the quote does not state cannot be computed from");
  });
  test("Reimbursement uses the actual bill and verified cap",()=>{
    const text="We reimburse ambulance expenses up to S$500 per incident.",b=benefit(text);
    b.formula={...b.formula,kind:"expense_cap",value:500,factKey:"ambulanceBill"};
    const result=calculatePolicyFormula({benefit:b,contract,sources:[source(text)],facts:{ambulanceBill:{...fact(220),quote:"Ambulance bill SGD 220"}}});
    assert.equal(result?.amount,220);
  });
  test("An unknown reimbursement bill cannot become the policy cap",()=>{
    const text="We reimburse ambulance expenses up to S$500 per incident.",b=benefit(text);
    b.formula={...b.formula,kind:"expense_cap",value:500,factKey:"ambulanceBill"};
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(text)],facts:{ambulanceBill:fact(null,"pending")}}),null);
  });
  test("Cross-currency bills are not converted or mislabeled",()=>{
    const text="We reimburse ambulance expenses up to S$500 per incident.",b=benefit(text);
    b.formula={...b.formula,kind:"expense_cap",value:500,factKey:"ambulanceBill"};
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(text)],facts:{ambulanceBill:{...fact(220),quote:"Ambulance bill USD 220"}}}),null);
    b.formula.currency="USD";
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(text)],facts:{ambulanceBill:fact(220)}}),null);
  });
  test("Completed daily cash applies source rate, waiting days and day cap",()=>{
    const text="Daily hospital cash benefit S$30 per day after the 10th day, maximum of 30 continuous days.",b=benefit(text);
    b.formula={...b.formula,kind:"daily",value:30,factKey:"hospitalNights",offsetDays:10,maximumDays:30};
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(text)],facts:{hospitalNights:fact(45)}})?.amount,900);
    assert.equal(calculatePolicyFormula({benefit:b,contract,sources:[source(text)],facts:{hospitalNights:fact(12),hospitalStayOngoing:fact(true)}}),null);
  });
  test("A model cannot demand hospital duration from a cancer lump-sum clause",()=>{
    const b=benefit();b.requirements=[{factKey:"hospitalNights",operator:"present",value:null,question:"How many hospital nights?",why:"Required for cancer",evidence:b.evidence[0]}];
    assert.equal(validateAnalysis({benefits:[b],observations:[],nextSteps:[]},[source(b.evidence[0].quote)],contract).benefits[0].requirements.length,0);
  });
  test("An unknown required fact is deferred instead of repeated",()=>{
    const r={factKey:"hospitalNights",operator:"present" as const,value:null,question:"How long?",why:"Daily benefit",evidence:{sourceId:"source-a",quote:"hospital stay"}};
    assert.equal(evaluateRequirement(r,{hospitalNights:fact(null,"unknown")},contract,now),"deferred");
  });
  test("Conditional requirements are asked only on the applicable branch",()=>{
    const r={factKey:"racingAuthoritySanctioned",operator:"equals" as const,value:true,question:"Was it sanctioned?",why:"Racing exception",evidence:{sourceId:"source-a",quote:"racing sanctioned by the authority"},
      appliesWhen:[{factKey:"competitiveRacing",value:true}]};
    assert.equal(evaluateRequirement(r,{competitiveRacing:fact(false)},contract,now),"met");
    assert.equal(evaluateRequirement(r,{competitiveRacing:fact(true)},contract,now),"missing");
    assert.equal(evaluateRequirement(r,{competitiveRacing:fact(true),racingAuthoritySanctioned:fact(null,"unknown")},contract,now),"deferred");
  });
  test("User-reported definition approval is not documentary proof",()=>{
    const b=benefit();b.requirements=[{factKey:"medicalDefinitionConfirmed",operator:"equals",value:true,question:"Definition met?",why:"Defined critical illness",evidence:b.evidence[0]}];
    const valid=validateAnalysis({benefits:[b],observations:[],nextSteps:[]},[source(b.evidence[0].quote)],contract);
    const assessment=assessmentFromBenefit({benefit:valid.benefits[0],contract,sources:[source(b.evidence[0].quote)],facts:{medicalDefinitionConfirmed:fact(true)},now});
    assert.equal(assessment.checks[0].result,"document");assert.equal(assessment.item.status,"potentially_applicable");
    assert.equal(assessment.item.amountText,"S$350,000");assert.equal(assessment.item.amountLabel,"Calculated benefit (internal)");
  });
  test("A reported homicide requires documentary accidental-death classification",()=>{
    const r={factKey:"accidentalDeath",operator:"equals" as const,value:true,question:"Was this accidental?",why:"Accidental death wording",evidence:{sourceId:"source-a",quote:"Death due to Accident"}};
    assert.equal(evaluateRequirement(r,{death:fact(true),causeOfDeath:fact("murdered")},contract,now),"document");
  });
  test("A classified homicide keeps accidental death as an evidence-dependent candidate and shows the calculable amount",()=>{
    const text="Death due to Accident. We pay 100% of Sum Insured.",b=benefit(text);
    b.requirements=[{factKey:"accidentalDeath",operator:"equals",value:true,question:"",why:"Death must satisfy the policy's Accident definition.",evidence:b.evidence[0]}];
    const scenario:ScenarioClassification={subjectId:person,label:"Reported homicide",family:"death",traits:["death","sudden","external","violent","unintentional_to_insured"],quote:"He was murdered.",recordedAt:now.toISOString(),source:"system-derived"};
    const assessed=assessmentFromBenefit({benefit:b,contract,sources:[source(text)],facts:{death:fact(true),causeOfDeath:fact("murdered")},scenarios:[scenario],now});
    assert.equal(assessed.checks[0].result,"inferred");assert.equal(assessed.item.status,"potentially_applicable");
    assert.equal(assessed.item.amountText,"S$350,000");assert.match(assessed.item.conditions.join(" "),/claim evidence must confirm/i);
  });
  test("An explicit failed requirement rules out that benefit and its amount",()=>{
    const text="Death due to Accident. We pay 100% of Sum Insured.",b=benefit(text);
    b.requirements=[{factKey:"accidentalDeath",operator:"equals",value:true,question:"",why:"Death must be accidental.",evidence:b.evidence[0]}];
    const assessed=assessmentFromBenefit({benefit:b,contract,sources:[source(text)],facts:{accidentalDeath:fact(false)},now});
    assert.equal(assessed.checks[0].result,"not_met");assert.equal(assessed.item.status,"not_applicable");assert.equal(assessed.item.amountText,null);
  });
  test("Potential totals add independent lump sums but do not treat reimbursement as freely additive",()=>{
    const totals=aggregatePotentialPayouts([
      {title:"Life",status:"potentially_applicable",amountText:"S$1,000,000",amountLabel:"Calculated benefit (internal)",calculatedAmount:1_000_000,currency:"SGD",calculationKind:"sum_insured",aggregation:"additive",reason:"",conditions:[]},
      {title:"PA",status:"potentially_applicable",amountText:"S$600,000",amountLabel:"Calculated benefit (internal)",calculatedAmount:600_000,currency:"SGD",calculationKind:"sum_insured",aggregation:"additive",reason:"",conditions:[]},
      {title:"Medical",status:"potentially_applicable",amountText:"S$2,000",amountLabel:"Calculated reimbursement (internal)",calculatedAmount:2_000,currency:"SGD",calculationKind:"expense_cap",aggregation:"reimbursement",reason:"",conditions:[]},
    ]);
    assert.deepEqual(totals,[{currency:"SGD",amount:1_600_000,amountText:"S$1,600,000",itemCount:2}]);
  });
  test("A schedule-only benefit is labelled as confirmed cover, not a calculated claim",()=>{
    const text="Group Term Life Death As of 06/10/2022",b=benefit(text);
    b.formula={kind:"none",value:null,currency:null,factKey:null,offsetDays:null,maximumDays:null,evidence:null};
    const personal=source(text,{citation:{chunkId:"source-a",policyId:"schedule",policyName:"Flexible Plan",pageStart:1,pageEnd:1,personalEvidence:true}});
    const item=assessmentFromBenefit({benefit:b,contract,sources:[personal],facts:{death:fact(true)},now}).item;
    assert.equal(item.status,"needs_document");assert.equal(item.amountText,"S$350,000");
    assert.equal(item.amountLabel,"Confirmed cover amount — payout rule not yet verified");assert.match(item.reason,/insured amount of S\$350,000/);
  });
  test("Illustrated non-guaranteed values cannot become guaranteed observations",()=>{
    const text="The projected non-guaranteed maturity value is SGD 100000.";
    assert.equal(validateAnalysis({benefits:[],observations:[{text:"The guaranteed maturity value is SGD 100000.",evidence:[{sourceId:"source-a",quote:text}]}],nextSteps:[]},[source(text)],contract).observations.length,0);
  });
  test("Normal answers cannot invent a derived numeric total",()=>{
    const text="The guaranteed benefit is SGD 100000.";
    assert.equal(validateAnalysis({benefits:[],observations:[{text:"You receive SGD 200000.",evidence:[{sourceId:"source-a",quote:text}]}],nextSteps:[]},[source(text)],contract).observations.length,0);
  });
  test("Shared exact insurer/product wording can support separate owned contracts",()=>{
    assert.equal(referenceMatches(document(),document({id:"reference",policy_number:null,personal_coverage_confirmed:false,document_role:"policy_wording"})),true);
  });
  test("Insurer, policy number and product contradictions remain separate",()=>{
    assert.equal(referenceMatches(document(),document({id:"reference",insurer:"Other Insurer",personal_coverage_confirmed:false,document_role:"policy_wording"})),false);
    assert.equal(referenceMatches(document(),document({id:"reference",policy_number:"P-200",personal_coverage_confirmed:false,document_role:"policy_wording"})),false);
    assert.notEqual(productIdentity("Shield Plan A"),productIdentity("Shield Plan B"));
  });
  test("A group summary missing metadata can link only through product and distinctive scheme context",()=>{
    const owner=document({group_policy_number:"G007500",header:"MINDEF MHA Group Insurance Scheme",products:["Group Term Life"],product_name:"MINDEF MHA Group Insurance Scheme"});
    const matching=document({id:"matching",personal_coverage_confirmed:false,document_role:"product_summary",group_policy_number:null,policy_number:null,
      product_name:"Group Term Life",products:["Group Term Life"],header:"MINDEF and MHA Group Term Life Product Summary"});
    const other=document({id:"other",personal_coverage_confirmed:false,document_role:"product_summary",group_policy_number:null,policy_number:null,
      product_name:"Group Term Life",products:["Group Term Life"],header:"Corporate Employee Group Term Life Product Summary"});
    assert.equal(referenceMatches(owner,matching),true);assert.equal(referenceMatches(owner,other),false);
  });
  test("A combined personal certificate and Part 2 guide keeps the personal extraction path",()=>{
    const pages=[{pageNumber:1,text:"Certificate of Group Insurance. Particulars of Insured: Person A. Sum Insured SGD 100000. Effective Date 2022-10-06."},
      {pageNumber:2,text:"Certificate of Insurance Part 2: Highlights of Cover. Group Term Life benefits."}];
    assert.equal(detectHighConfidenceReferenceRole(pages),null);
    assert.equal(deterministicDocumentRole(pages,"benefit_guide"),"certificate");
  });
  test("Other people's personalised schedules are never reference wording",()=>{
    assert.equal(referenceMatches(document(),document({id:"someone-else",member_ids:["other"]})),false);
  });
  test("A certificate alone is not matching policy wording",()=>{
    const people=[{id:person,display_name:"Person A",preferred_name:null,relationship:"self"}];
    const contracts=buildContracts([document()],people,[coverage()]);
    assert.equal(contracts.length,1);assert.equal(contracts[0].references.length,0);
  });
  test("An amendment supersedes the matching coverage rather than adding it",()=>{
    const people=[{id:person,display_name:"Person A",preferred_name:null,relationship:"self"}];
    const contracts=buildContracts([document(),document({id:"amendment",document_role:"endorsement",document_authority:100})],people,
      [coverage(),coverage({id:"amended",policyId:"amendment",amount:400000})]);
    assert.equal(contracts.length,1);assert.equal(contracts[0].coverages.length,1);assert.equal(contracts[0].coverages[0].amount,400000);
  });
  for(const count of [90,900])test("Mixed family inventory contains all "+count+" policies",()=>{
    const types=["Savings","Investment","Motor","Travel","Death","Critical Illness","Home","Long-term Care","Other"];
    const people=Array.from({length:9},(_,i)=>({id:"person-"+i,display_name:"Person "+i,preferred_name:null,relationship:"family"}));
    const docs=Array.from({length:count},(_,i)=>document({id:"doc-"+i,policy_number:"P-"+i,member_ids:[people[i%9].id],product_name:"Plan "+i,policy_type:types[i%types.length],products:["Plan "+i]}));
    const covers=docs.map((d,i)=>coverage({id:"cover-"+i,policyId:d.id,familyMemberId:d.member_ids[0],productName:d.product_name,category:types[i%types.length]}));
    const contracts=buildContracts(docs,people,covers);
    assert.equal(contracts.length,count);assert.equal(contracts.at(-1)?.documents[0].id,"doc-"+(count-1));
    assert.equal(contracts.filter(c=>c.ownerId===people[0].id).length,count/9);
  });
  test("Evidence windows preserve all ordinary chunks without a giant context",()=>{
    const sources=Array.from({length:120},(_,i)=>source("A".repeat(1800),{id:"source-"+i}));
    const windows=evidenceWindows(sources);assert.equal(windows.flat().length,120);
    assert.ok(windows.every(w=>w.reduce((n,s)=>n+s.text.length+120,0)<=3300));
  });
  test("Policy reading keeps lexical or sufficiently close per-contract evidence",()=>{
    const lexical=source("Lexical",{id:"lexical",lexicalMatch:true,semanticDistance:1.1});
    const semantic=source("Semantic",{id:"semantic",lexicalMatch:false,semanticDistance:0.4});
    const unrelated=source("Unrelated",{id:"unrelated",lexicalMatch:false,semanticDistance:1.2});
    assert.deepEqual(analysisSources([lexical,semantic,unrelated],0.72).map(s=>s.id),["lexical","semantic"]);
    assert.equal(analysisSources([source("Legacy")]).length,1);
  });
  test("Oversized legacy chunks are split without being discarded",()=>{
    const marker="END-OF-POLICY",windows=evidenceWindows([source("A".repeat(9000)+marker)]),parts=windows.flat();
    assert.ok(parts.length>1);assert.ok(parts.every(part=>part.text.length+120<=3300));assert.ok(parts.some(part=>part.text.includes(marker)));
  });
  test("Family-local dates remain stable at UTC day boundaries",()=>{
    assert.equal(resolveClaimDate("yesterday",{now:new Date("2026-09-13T17:00:00Z"),timeZone:"Asia/Singapore"})?.date,"2026-09-13");
  });
  test("Review coverage counts only the pages and passages actually read",()=>{
    const documents=[document({id:"schedule",page_total:4,chunk_total:4}),document({id:"wording",personal_coverage_confirmed:false,document_role:"policy_wording",page_total:20,chunk_total:12})];
    const retrieved=[source("A",{id:"a",policyId:"wording",pageStart:3,pageEnd:4}),source("B",{id:"b",policyId:"wording",pageStart:9,pageEnd:9}),source("C",{id:"c",policyId:"schedule",pageStart:1,pageEnd:1})];
    const coverage=contractReviewCoverage({documents,retrieved,read:[retrieved[0],retrieved[2]],windowsAnalyzed:2,windowsFailed:0,hasWording:true});
    assert.equal(coverage.pagesTotal,24);assert.equal(coverage.passagesTotal,16);
    assert.equal(coverage.pagesRetrieved,4);assert.equal(coverage.pagesRead,3);
    assert.equal(coverage.passagesRetrieved,3);assert.equal(coverage.passagesRead,2);
    assert.equal(coverage.completeness,"partial_retrieval");
  });
  test("A windowed fragment of one passage is not counted as extra evidence",()=>{
    const documents=[document({id:"wording",personal_coverage_confirmed:false,document_role:"policy_wording",page_total:1,chunk_total:1})];
    const whole=source("A",{id:"only",policyId:"wording"});
    const read=[{...whole,id:"only#part-1"},{...whole,id:"only#part-2"}];
    const coverage=contractReviewCoverage({documents,retrieved:[whole],read,windowsAnalyzed:2,windowsFailed:0,hasWording:true});
    assert.equal(coverage.passagesRead,1);assert.equal(coverage.completeness,"full_text_reviewed");
  });
  test("An unprocessed or wording-free contract is never a complete review",()=>{
    const ready=document({id:"schedule",page_total:1,chunk_total:1});
    const pending=document({id:"scan",processing_status:"processing",page_total:0,chunk_total:0});
    const read=[source("A",{id:"a",policyId:"schedule"})];
    assert.equal(contractReviewCoverage({documents:[ready,pending],retrieved:read,read,windowsAnalyzed:1,windowsFailed:0,hasWording:true}).completeness,"not_processed");
    assert.equal(contractReviewCoverage({documents:[ready],retrieved:read,read,windowsAnalyzed:1,windowsFailed:0,hasWording:false}).completeness,"no_wording");
    assert.equal(contractReviewCoverage({documents:[ready],retrieved:read,read,windowsAnalyzed:1,windowsFailed:1,hasWording:true}).completeness,"partial_retrieval");
  });
  test("A negative coverage conclusion needs every contract fully reviewed",()=>{
    const full=contractReviewCoverage({documents:[document({id:"d1",page_total:1,chunk_total:1})],
      retrieved:[source("A",{id:"a",policyId:"d1"})],read:[source("A",{id:"a",policyId:"d1"})],windowsAnalyzed:1,windowsFailed:0,hasWording:true});
    const partial=contractReviewCoverage({documents:[document({id:"d2",page_total:8,chunk_total:8})],
      retrieved:[source("A",{id:"a",policyId:"d2"})],read:[source("A",{id:"a",policyId:"d2"})],windowsAnalyzed:1,windowsFailed:0,hasWording:true});
    assert.equal(negativeConclusionPermitted(summarizeReviewCoverage([full])),true);
    assert.equal(negativeConclusionPermitted(summarizeReviewCoverage([full,partial])),false);
    assert.equal(negativeConclusionPermitted(summarizeReviewCoverage([])),false);
    assert.equal(negativeConclusionPermitted(undefined),false);
    // V1.1: page counts are internal reading progress, not household text (eval internal_text); the counts stay on the numeric fields.
    assert.match(summarizeReviewCoverage([full,partial]).statement,/^Partial review: not every part/);
    assert.deepEqual([summarizeReviewCoverage([full,partial]).pagesRead,summarizeReviewCoverage([full,partial]).pagesTotal],[2,9]);
    assert.match(summarizeReviewCoverage([full]).statement,/^Complete review/);
  });
  test("Multi-page passages count every page they span",()=>{
    assert.equal(pagesSpanned([{pageStart:4,pageEnd:6},{pageStart:6,pageEnd:6}]).size,3);
    assert.equal(pagesSpanned([{pageStart:0,pageEnd:0}]).size,0);
  });
  test("Generated prose cannot claim no coverage, but may call a review incomplete",()=>{
    assert.equal(negativeCoverageClaim("This event is not covered by the policy."),true);
    assert.equal(negativeCoverageClaim("There is no cover for theft."),true);
    assert.equal(negativeCoverageClaim("An unread section is an incomplete review, so it does not mean the event is not covered."),false);
    assert.equal(negativeCoverageClaim("I found two benefits that may respond."),false);
  });
  test("Currentness reports payment recency without touching ownership",()=>{
    const fresh=assessCurrentness({now,lastEvidenceOn:"2026-06-01",renewalOrExpiryDate:"2027-01-01"});
    assert.equal(fresh.state,"verified_recent");assert.equal(fresh.label,"Active status evidenced");
    const stale=assessCurrentness({now,lastEvidenceOn:"2023-01-01",renewalOrExpiryDate:null});
    assert.equal(stale.state,"not_recently_verified");assert.match(stale.detail,/Ownership stays confirmed/);
    const none=assessCurrentness({now,lastEvidenceOn:null,renewalOrExpiryDate:null});
    assert.equal(none.state,"unknown");assert.match(none.detail,/Ownership stays confirmed/);
    const expired=assessCurrentness({now,lastEvidenceOn:null,renewalOrExpiryDate:"2025-01-01"});
    assert.equal(expired.state,"expiry_date_passed");assert.match(expired.detail,/Ownership stays confirmed/);
    // A later receipt outranks a passed printed expiry date.
    assert.equal(assessCurrentness({now,lastEvidenceOn:"2026-08-01",renewalOrExpiryDate:"2025-01-01"}).state,"verified_recent");
    assert.equal(assessCurrentness({now,lastEvidenceOn:"not-a-date",renewalOrExpiryDate:"not-a-date"}).state,"unknown");
    for(const state of [fresh,stale,none,expired])assert.equal(state.state==="verified_recent",state.label==="Active status evidenced");
  });
  test("Premium evidence must belong to the same person and contract",()=>{
    const rows:PremiumEvidenceRow[]=[
      {policy_id:"other-document",family_member_id:person,insurer:"Example Insurer",policy_number:"P-999",latest:"2026-09-01"},
      {policy_id:null,family_member_id:"person-b",insurer:"Example Insurer",policy_number:"P-100",latest:"2026-09-02"},
      {policy_id:null,family_member_id:null,insurer:"Another Insurer",policy_number:"P-100",latest:"2026-09-03"},
    ];
    assert.equal(matchPremiumEvidence(contract,rows),null);
    assert.equal(matchPremiumEvidence(contract,[...rows,{policy_id:"schedule",family_member_id:null,insurer:null,policy_number:null,latest:"2026-05-05"}]),"2026-05-05");
    assert.equal(matchPremiumEvidence(contract,[...rows,{policy_id:null,family_member_id:person,insurer:"Example Insurer",policy_number:"P-100",latest:"2026-04-04"}]),"2026-04-04");
    assert.equal(contractCurrentness(contract,[],now).state,"unknown");
    assert.equal(contractCurrentness({...contract,documents:[document({renewal_or_expiry_date:"2024-01-01"})]},[],now).state,"expiry_date_passed");
  });
  test("Missing premium evidence never removes a confirmed coverage amount",()=>{
    const assessed=assessmentFromBenefit({benefit:benefit(),contract,sources:[source("We pay 100% of Sum Insured for a qualifying critical illness.")],facts:{},now});
    assert.equal(contractCurrentness(contract,[],now).state,"unknown");
    assert.equal(assessed.item.amountText,"S$350,000");
    assert.equal(assessed.item.status,"potentially_applicable");
  });
  test("Retrieval depth scales with the size of the document",()=>{
    delete process.env.RAG_MIN_PASSAGES_PER_DOCUMENT;delete process.env.RAG_MAX_PASSAGES_PER_DOCUMENT;
    assert.equal(passageBudget(0),6,"An unprocessed document keeps the floor");
    assert.equal(passageBudget(2),2,"Never ask for more passages than the document stores");
    assert.equal(passageBudget(10),6,"Small documents keep the floor");
    assert.equal(passageBudget(40),14,"A forty-passage booklet is no longer read six passages at a time");
    assert.equal(passageBudget(500),40,"The ceiling bounds the work without pushing a real benefit table out of the retrieved set");
    process.env.RAG_MAX_PASSAGES_PER_DOCUMENT="10";
    assert.equal(passageBudget(500),10,"The ceiling is tunable");
    delete process.env.RAG_MAX_PASSAGES_PER_DOCUMENT;
  });
  test("One shared group summary supports every family member who owns that group cover",()=>{
    const scheme=(over:Partial<InventoryDocument>)=>document({insurer:"Singapore Life Ltd",group_policy_number:"G007500",...over});
    const desmond=scheme({id:"cert-desmond",policy_number:"CERT-D",member_ids:["desmond"]});
    const charmaine=scheme({id:"cert-charmaine",policy_number:"CERT-C",member_ids:["charmaine"]});
    const summary=scheme({id:"summary",personal_coverage_confirmed:false,document_role:"benefit_guide",policy_number:null,document_authority:60});
    for(const owner of [desmond,charmaine]){
      const outcome=referenceMatchReason(owner,summary);
      assert.equal(outcome.matches,true,"The shared summary must bind to "+owner.id);
      assert.match(outcome.reason,/G007500/);
    }
    // It binds through the contract builder too, not only the matcher.
    const people=[{id:"desmond",display_name:"Desmond",preferred_name:null,relationship:"self"},
      {id:"charmaine",display_name:"Charmaine",preferred_name:null,relationship:"spouse"}];
    const contracts=buildContracts([desmond,charmaine,summary],people,
      [coverage({id:"c-d",policyId:"cert-desmond",familyMemberId:"desmond"}),coverage({id:"c-c",policyId:"cert-charmaine",familyMemberId:"charmaine"})]);
    assert.equal(contracts.length,2);
    assert.equal(contracts.every(c=>c.references.some(r=>r.id==="summary")),true,"Both people must reach the same wording");
    assert.equal(contracts.every(c=>c.confirmed),true);
  });
  test("A combined certificate keeps its own wording sections for each owner",()=>{
    const combined=document({id:"combined",member_ids:["desmond","charmaine"],has_reference_sections:true,group_policy_number:"G007500"});
    const people=[{id:"desmond",display_name:"Desmond",preferred_name:null,relationship:"self"},
      {id:"charmaine",display_name:"Charmaine",preferred_name:null,relationship:"spouse"}];
    const contracts=buildContracts([combined],people,
      [coverage({id:"c-d",policyId:"combined",familyMemberId:"desmond"}),coverage({id:"c-c",policyId:"combined",familyMemberId:"charmaine"})]);
    assert.equal(contracts.length,2,"One PDF naming two people is two contracts, not one");
    assert.equal(contracts.every(c=>c.documents.some(d=>d.id==="combined"&&d.has_reference_sections===true)),true);
    assert.equal(referenceMatchReason(combined,combined).matches,true);
  });
  test("A wording document that cannot bind explains why",()=>{
    const owner=document({insurer:"Singapore Life Ltd",group_policy_number:"G007500"});
    assert.match(referenceMatchReason(owner,document({id:"other",personal_coverage_confirmed:false,document_role:"policy_wording",insurer:"Another Insurer"})).reason,/Insurer differs/);
    assert.match(referenceMatchReason(owner,document({id:"other",personal_coverage_confirmed:false,document_role:"policy_wording",insurer:"Singapore Life Ltd",group_policy_number:"G999999"})).reason,/Group policy number differs/);
    assert.match(referenceMatchReason(owner,document({id:"other",personal_coverage_confirmed:false,document_role:"claim_form",insurer:"Singapore Life Ltd"})).reason,/is not a wording role/);
    assert.match(referenceMatchReason(owner,document({id:"other",insurer:"Singapore Life Ltd"})).reason,/personalised evidence/);
    assert.equal(referenceMatches(owner,document({id:"other",personal_coverage_confirmed:false,document_role:"policy_wording",insurer:"Another Insurer"})),false);
  });
  test("Output cut off mid-JSON is salvaged back to its last complete element",()=>{
    const cut='{"intent": "claim", "newTopic": true, "searchTerms": ["claim","benefits"], "facts": [{"subjectId":"s1","key":"eventType","value":"fall from stairs","state":"known","quote":"fell down from the stairs"}, {"subjectId": "s1", "key": "fract';
    const repaired=repairTruncatedJson(cut);
    assert.ok(repaired,"A truncated document must be recoverable");
    const parsed=JSON.parse(repaired!);
    assert.equal(parsed.intent,"claim");
    assert.equal(parsed.facts.length,1,"The incomplete trailing fact is dropped, the complete one is kept");
    assert.equal(parsed.facts[0].key,"eventType");
    assert.deepEqual(parsed.searchTerms,["claim","benefits"]);
  });
  test("Salvage leaves valid and unrecoverable output alone",()=>{
    assert.equal(repairTruncatedJson('{"intent":"claim"}'),null,"Balanced JSON was not truncated");
    assert.equal(repairTruncatedJson("not json at all"),null);
    assert.equal(repairTruncatedJson('{"facts": [{"quote": "he said \\"ouch\\", then fell"'),null,"Nothing complete to keep");
    // A brace inside a string must not be mistaken for structure.
    const nested=repairTruncatedJson('{"a":[{"q":"a { b [ c"},{"q":"cut');
    assert.deepEqual(JSON.parse(nested!),{a:[{q:"a { b [ c"}]});
  });
  test("Reading work per turn is bounded",()=>{
    for(const key of ["RAG_MAX_EVIDENCE_WINDOWS","RAG_ANALYSIS_BUDGET_MS"])delete process.env[key];
    assert.equal(readingBudget().maximumWindows,8);
    assert.equal(readingBudget().millisecondBudget,150_000,"A turn cannot read for an unbounded time: the default budget leaves headroom inside the 300s function window");
    process.env.RAG_MAX_EVIDENCE_WINDOWS="24";process.env.RAG_ANALYSIS_BUDGET_MS="60000";
    assert.equal(readingBudget().maximumWindows,24);
    assert.equal(readingBudget().millisecondBudget,60_000);
    process.env.RAG_MAX_EVIDENCE_WINDOWS="0";
    assert.equal(readingBudget().maximumWindows,8,"An out-of-range setting falls back to the default");
    for(const key of ["RAG_MAX_EVIDENCE_WINDOWS","RAG_ANALYSIS_BUDGET_MS"])delete process.env[key];
  });
  test("Model calls go to the contracts retrieval actually matched",()=>{
    const windowsFor=(id:string,count:number,over:Partial<PolicySource>={})=>
      Array.from({length:count},(_,i)=>[source("text",{id:id+"-"+i,policyId:id,...over})]);
    const candidates=[
      candidateFromWindows("weak-a",windowsFor("weak-a",3,{lexicalMatch:false,semanticDistance:0.68})),
      candidateFromWindows("strong",windowsFor("strong",4,{lexicalMatch:true,semanticDistance:0.30})),
      candidateFromWindows("closer",windowsFor("closer",3,{lexicalMatch:false,semanticDistance:0.41})),
      candidateFromWindows("empty",[]),
    ];
    assert.deepEqual(rankCandidates(candidates).map(c=>c.contractId),["strong","closer","weak-a","empty"],
      "Lexical match first, then the closest semantic passage, with no-evidence contracts last");
    const allocation=allocateReadingWindows(candidates,6,6);
    assert.equal(allocation.get("empty"),0,"A contract with no retrieved evidence never costs a model call");
    assert.equal(allocation.get("strong"),2,"The lexically matched contract is read first and deepest");
    assert.equal((allocation.get("closer")??0)>=1,true,"Every candidate still gets its best passage read");
    assert.equal((allocation.get("weak-a")??0)>=1,true);
    assert.equal([...allocation.values()].reduce((a,b)=>a+b,0),6,"The whole budget is spent, and no more");
  });
  test("Ten policies each get their best section before any gets a second",()=>{
    const candidates=Array.from({length:10},(_,i)=>
      candidateFromWindows("c"+i,Array.from({length:4},(_,w)=>[source("t",{id:"c"+i+"-"+w,policyId:"c"+i,lexicalMatch:true,semanticDistance:0.2+i/100})])));
    const allocation=allocateReadingWindows(candidates,12,12);
    assert.equal([...allocation.values()].every(v=>v>=1),true,"No contract may be skipped entirely while budget remains");
    assert.equal([...allocation.values()].reduce((a,b)=>a+b,0),12);
    assert.equal(allocation.get("c0"),2,"Spare budget deepens the closest match");
    assert.equal(allocation.get("c9"),1);
  });
  test("A single contract may use the whole budget",()=>{
    const only=[candidateFromWindows("solo",Array.from({length:20},(_,w)=>[source("t",{id:"s"+w,policyId:"solo",lexicalMatch:true})]))];
    assert.equal(allocateReadingWindows(only,12,12).get("solo"),12);
    assert.equal(allocateReadingWindows(only,12,3).get("solo"),3,"A per-contract cap is still respected");
    assert.equal(allocateReadingWindows([],12,12).size,0);
  });
    test("The reading schema cannot ask for more text than the output budget allows",()=>{
    const json=JSON.stringify(z.toJSONSchema(PolicyAnalysisSchema));
    const longest=[...json.matchAll(/"maxLength":(\d+)/g)].map(m=>Number(m[1]));
    assert.ok(longest.length,"The schema must still bound every free-text field");
    assert.ok(Math.max(...longest)<=260,
      "Verbatim quotes are the bulk of the output tokens; the longest field is "+Math.max(...longest));
    // Worst-case text the model could be asked to emit, at roughly 4 chars/token.
    const characters=longest.reduce((total,value)=>total+value,0);
    assert.ok(characters/4<readingOutputTokens()*3,
      "The schema's worst case ("+Math.round(characters/4)+" tokens of text) is far beyond the "+readingOutputTokens()+"-token budget");
    delete process.env.RAG_READING_OUTPUT_TOKENS;
    assert.equal(readingOutputTokens(),2600);
    process.env.RAG_READING_OUTPUT_TOKENS="500";
    assert.equal(readingOutputTokens(),500);
    process.env.RAG_READING_OUTPUT_TOKENS="oops";
    assert.equal(readingOutputTokens(),2600,"A bad setting falls back to the default");
    delete process.env.RAG_READING_OUTPUT_TOKENS;
  });
  test("One misshapen field no longer discards a whole evidence section",()=>{
    const quote={sourceId:"source-a",quote:"We pay 25% of the S$5,000 benefit limit."};
    const raw={
      benefits:[
        // conditions arrived as a bare string - a shape a model really returned.
        {title:"Simple Fracture",coverageId:"cover-a",evidence:quote,requirements:[],conditions:"Subject to the policy definition.",
         formula:{kind:"sum_insured",value:0.25,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,evidence:quote}},
        {title:"Unusable",coverageId:null,evidence:[],requirements:[],conditions:[],
         formula:{kind:"none",value:null,currency:null,factKey:null,offsetDays:null,maximumDays:null,evidence:null}},
      ],
      observations:{text:"A lone object where a list belongs.",evidence:[quote]},
      nextSteps:"not a list",
    };
    const coerced=PolicyAnalysisSchema.parse(coercePolicyAnalysis(raw));
    assert.equal(coerced.benefits.length,1,"The salvageable benefit survives");
    assert.equal(coerced.benefits[0].title,"Simple Fracture");
    assert.deepEqual(coerced.benefits[0].evidence,[quote],"A single quote is read as a list of one");
    assert.deepEqual(coerced.benefits[0].conditions,[],"An unquoted condition is dropped, never invented");
    assert.equal(coerced.benefits[0].formula.kind,"sum_insured");
    assert.equal(coerced.observations.length,1);
    assert.deepEqual(coerced.nextSteps,[]);
    assert.deepEqual(coercePolicyAnalysis("nonsense"),{benefits:[],observations:[],nextSteps:[]});
    assert.deepEqual(coercePolicyAnalysis(null),{benefits:[],observations:[],nextSteps:[]});
    assert.equal(coercePolicyAnalysis({benefits:[{title:"No evidence",coverageId:"cover-a",evidence:[],requirements:[],conditions:[],
      formula:{kind:"none",value:null,currency:null,factKey:null,offsetDays:null,maximumDays:null,evidence:null}}]}).benefits.length,0,
      "A benefit with no quoted evidence is still rejected");
  });
  test("A failed section is explained in plain language, never as validation output",()=>{
    const zodish=new Error('[{"expected":"array","code":"invalid_type","path":["benefits",0,"conditions"]}]');
    const who=describeChoice(modelFor("judgement"));
    const cases:[unknown,string][]=[
      [new TruncatedModelOutput("x","raw",false,zodish),"the model’s answer for that section was not in the expected form"],
      [new TruncatedModelOutput("x","raw",true),"the model ran out of room part-way through that section"],
      // Named from the model actually routed to, so this keeps holding when the
      // routing changes rather than pinning one provider's name into the suite.
      [new Error("chat timed out after 150 seconds"),who+" timed out on that section"],
      [new Error('Model returned invalid structured JSON: {"a":'),who+" did not return usable structured output for that section"],
      [new Error("something else entirely"),who+" could not complete that section"],
      // A hosted provider's own explanation is the diagnosis, in its words.
      [new Error('Model request failed (403): This API method requires billing to be enabled. Please enable billing on project #123'),
        who+" refused the request: This API method requires billing to be enabled. Please enable billing on project #123. Check the API key in the hosting dashboard's environment variables and its API restrictions in Google Cloud"],
      [new Error("Model request failed (404): models/gemini-9 is not found"),who+" does not recognise the model name set in the hosting environment variables"],
    ];
    for(const [error,expected] of cases){
      const reason=readableModelFailure(error);
      assert.equal(reason,expected);
      assert.equal(/[{}\[\]"]|invalid_type|"path"|received|ZodError/.test(reason),false,"No validation output may reach the user: "+reason);
    }
  });
  test("A benefit is filed under the events that can trigger it",()=>{
    assert.deepEqual(benefitTraits("Simple Fracture","We pay 25% of the benefit limit for a fracture caused by an accident.").sort(),
      ["accident","bodily_injury"]);
    assert.ok(benefitTraits("Ambulance Fee","We reimburse ambulance costs up to S$500 per incident.").includes("medical_expense"));
    assert.ok(benefitTraits("Death Benefit","On death we pay the full Sum Insured.").includes("death"));
    assert.ok(benefitTraits("Daily Hospital Cash","S$30 per day of hospital confinement.").includes("hospitalisation"));
    assert.deepEqual(benefitTraits("Administration","Forms must be submitted to the Company."),["other"]);
  });
  test("A fall down the stairs never surfaces a death or disability benefit",()=>{
    const facts:SubjectFacts={
      injured:fact(true),fractureBodyPart:fact("ankle"),ambulanceUsed:fact(true),
      hospitalNights:fact(3),hospitalBill:fact(8423),
    };
    const traits=eventTraits(facts);
    assert.ok(traits.includes("bodily_injury")&&traits.includes("hospitalisation")&&traits.includes("medical_expense"));
    assert.equal(traits.includes("death"),false);
    const entry=(name:string,quote:string):CatalogBenefit=>({id:name,policyId:"wording",productName:"Flexible Plan",benefitName:name,
      traits:benefitTraits(name,quote),formulaKind:"none",formulaValue:null,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,
      sourcePage:1,quote,conditions:[],requirements:[],needsReview:false});
    const catalog=[
      entry("Death Benefit","On death we pay the full Sum Insured."),
      entry("Total and Permanent Disablement","We pay 150% of the Sum Insured for total and permanent disablement."),
      entry("Simple Fracture","We pay 25% of the S$5,000 benefit limit for a fracture caused by an accident."),
      entry("Ambulance Fee","We reimburse the ambulance cost up to S$500 per incident."),
    ];
    const matched=matchBenefits(catalog,traits).map(entry=>entry.benefit.benefitName);
    assert.ok(matched.includes("Simple Fracture")&&matched.includes("Ambulance Fee"));
    assert.equal(matched.includes("Death Benefit"),false,"A broken ankle is not a death claim");
    assert.equal(matched.includes("Total and Permanent Disablement"),false,"and it is not a disability claim either");
  });
  test("A rule stated in a sentence is read from that sentence, and still has to prove itself",()=>{
    // Three rows from the live benefit table had no amount at all, and all
    // three state a complete rule in their own quoted sentence. The reader
    // looks for a figure in a column; these are prose.
    const row=(benefitName:string,quote:string):CatalogBenefit=>({id:benefitName,policyId:"booklet",productName:"Group Term Life",
      benefitName,traits:["other"],formulaKind:"none",formulaValue:null,currency:"SGD",factKey:null,offsetDays:null,
      maximumDays:null,sourcePage:8,quote,conditions:[],requirements:[],needsReview:false});
    const tpd=ruleFromQuote(row("Total and Permanent Disability",
      "Receive 150% of your coverage amount if Total and Permanent Disability is due to an accident."))!;
    assert.equal(tpd.formulaKind,"sum_insured");
    assert.equal(tpd.formulaValue,1.5,"a policy that says \u201ccoverage amount\u201d means its sum insured");
    const cash=ruleFromQuote(row("Hospital Cash Benefit",
      "S$30 per day Hospital Cash Benefit is payable from 11th to 40th day of the hospital stay."))!;
    assert.equal(cash.formulaKind,"daily");
    assert.equal(cash.formulaValue,30);
    assert.equal(cash.offsetDays,10,"payable from the 11th day is payable after the first ten");
    assert.equal(cash.maximumDays,30,"the 11th to the 40th day is thirty days");
    const twelfth=ruleFromQuote(row("Disability Benefit","Disability Benefit One twelfth of Sum Insured"))!;
    assert.equal(twelfth.formulaKind,"sum_insured");
    assert.ok(Math.abs((twelfth.formulaValue as number)-1/12)<0.0005);
    // And the sentence still has to prove it. Prose that names no figure, or
    // names one the rule does not follow from, yields nothing.
    assert.equal(ruleFromQuote(row("Escalation benefits",
      "The Disability Benefit payable shall increase each year that the policy continues.")),null);
    assert.equal(ruleFromQuote(row("Premium",
      "The premium for this plan is S$30 per day of cover.")),null,"money paid is not money received");
    assert.equal(ruleFromQuote({...row("Death Benefit","On death we pay 100% of the Sum Insured."),
      formulaKind:"sum_insured",formulaValue:1}),null,"a rule already read is never overwritten");
  });
  test("A payout rule is only accepted when the quoted clause proves it",()=>{
    const ok=validateCatalogFormula({kind:"sum_insured",value:0.25,currency:"SGD",
      quote:"We pay 25% of the Sum Insured for a simple fracture.",factKey:null,offsetDays:null,maximumDays:null});
    assert.equal(ok.formulaKind,"sum_insured");assert.equal(ok.formulaValue,0.25);
    // The clause says 25%, the model claimed 50%.
    assert.equal(validateCatalogFormula({kind:"sum_insured",value:0.5,currency:"SGD",
      quote:"We pay 25% of the Sum Insured for a simple fracture.",factKey:null,offsetDays:null,maximumDays:null}).formulaKind,"none");
    // A deduction makes the arithmetic unsupported.
    assert.equal(validateCatalogFormula({kind:"sum_insured",value:1,currency:"SGD",
      quote:"We pay the Sum Insured less any amount previously paid.",factKey:null,offsetDays:null,maximumDays:null}).formulaKind,"none");
    const cap=validateCatalogFormula({kind:"expense_cap",value:500,currency:"SGD",
      quote:"We reimburse the ambulance cost up to S$500 per incident.",factKey:"ambulanceBill",offsetDays:null,maximumDays:null});
    assert.equal(cap.formulaKind,"expense_cap");assert.equal(cap.factKey,"ambulanceBill");
    // A cap is not a fixed payout.
    assert.equal(validateCatalogFormula({kind:"fixed",value:500,currency:"SGD",
      quote:"We reimburse the ambulance cost up to S$500 per incident.",factKey:null,offsetDays:null,maximumDays:null}).formulaKind,"none");
    const daily=validateCatalogFormula({kind:"daily",value:30,currency:"SGD",
      quote:"Daily hospital cash of S$30 per day after the 3rd day, maximum of 30 days.",factKey:"hospitalNights",offsetDays:3,maximumDays:30});
    assert.equal(daily.formulaKind,"daily");assert.equal(daily.offsetDays,3);assert.equal(daily.maximumDays,30);
    assert.equal(validateCatalogFormula({kind:"fixed",value:9999,currency:"SGD",
      quote:"We pay a benefit of S$500.",factKey:null,offsetDays:null,maximumDays:null}).formulaKind,"none","A number absent from the quote is never used");
  });
  test("Amounts are arithmetic on stored rules, identical every time",()=>{
    const cover=coverage({amount:5000,currency:"SGD",productName:"Flexible Plan"});
    const fracture:CatalogBenefit={id:"b1",policyId:"wording",productName:"Flexible Plan",benefitName:"Simple Fracture",
      traits:["bodily_injury","accident"],formulaKind:"sum_insured",formulaValue:0.25,currency:"SGD",
      factKey:null,offsetDays:null,maximumDays:null,sourcePage:14,quote:"We pay 25% of the Sum Insured.",conditions:[],requirements:[],needsReview:false};
    const first=assessCatalogBenefit({benefit:fracture,coverage:cover,ownerName:"Person A",facts:{}});
    const again=assessCatalogBenefit({benefit:fracture,coverage:cover,ownerName:"Person A",facts:{}});
    assert.equal(first.item.amountText,"S$1,250");
    assert.equal(first.item.status,"likely_applicable");
    assert.match(first.item.reason,/page 14/);
    assert.deepEqual(first.item,again.item,"The same question must give the same answer");
    const ambulance:CatalogBenefit={...fracture,id:"b2",benefitName:"Ambulance Fee",traits:["medical_expense"],
      formulaKind:"expense_cap",formulaValue:500,factKey:"ambulanceBill",quote:"Up to S$500 per incident."};
    assert.equal(assessCatalogBenefit({benefit:ambulance,coverage:cover,ownerName:"Person A",
      facts:{ambulanceBill:fact(220)}}).item.amountText,"S$220.00","The bill, not the cap, when the bill is lower");
    assert.equal(assessCatalogBenefit({benefit:ambulance,coverage:cover,ownerName:"Person A",
      facts:{ambulanceBill:fact(900)}}).item.amountText,"S$500.00","and the cap when the bill is higher");
    // Nothing is known about the bill yet, so no payout can be calculated. The
    // rule is known, though, and showing the rule is the answer: the person is
    // told what their policy pays, it is labelled as the rule rather than as a
    // payout, and it carries no amount that could be added to a total.
    const unknown=assessCatalogBenefit({benefit:ambulance,coverage:cover,ownerName:"Person A",facts:{}});
    assert.equal(unknown.item.amountText,"Reimburses the ambulance bill, up to S$500.00");
    assert.equal(unknown.item.amountLabel,"What this benefit pays");
    assert.equal(unknown.item.status,"potentially_applicable");
    assert.equal(unknown.item.calculatedAmount,undefined,"a rule is not a payout and is never summed");
    assert.deepEqual(aggregatePotentialPayouts([unknown.item]),[]);
    assert.ok(unknown.missing.some(entry=>/ambulance/i.test(entry)));
    const cash:CatalogBenefit={...fracture,id:"b3",benefitName:"Daily Hospital Cash",traits:["hospitalisation"],
      formulaKind:"daily",formulaValue:30,factKey:"hospitalNights",offsetDays:3,maximumDays:30,quote:"S$30 per day after the 3rd day."};
    assert.equal(assessCatalogBenefit({benefit:cash,coverage:cover,ownerName:"Person A",
      facts:{hospitalNights:fact(10)}}).item.amountText,"S$210.00","(10 - 3) x S$30");
    // A stay shorter than the days the benefit waits out is the rule saying it
    // does not respond. "S$0.00" on a card tells a person nothing and reads
    // like a policy that pays nothing; the rule and the reason tell them why.
    const tooShort=assessCatalogBenefit({benefit:cash,coverage:cover,ownerName:"Person A",
      facts:{hospitalNights:fact(2)}});
    assert.equal(tooShort.item.calculatedAmount,undefined,"Below the waiting period there is nothing to count");
    assert.deepEqual(aggregatePotentialPayouts([tooShort.item]),[]);
    assert.match(tooShort.item.amountText??"",/per day after the first 3/,"the rule is shown instead of a zero");
    assert.ok(tooShort.missing.some(entry=>/longer than the 3 days/.test(entry)),
      "and the card says what would make it pay: "+tooShort.missing.join(" | "));
  });
  test("Uploading a policy is a statement that you hold it",()=>{
    const booklet=document({id:"booklet",personal_coverage_confirmed:false,document_authority:40,
      document_role:"benefit_guide",product_name:"CareShield Life",member_ids:[person],declared_member_ids:[person]});
    const people=[{id:person,display_name:"Person A",preferred_name:null,relationship:"self"}];
    const contracts=buildContracts([booklet],people,[]);
    assert.equal(contracts.length,1,"A declared booklet is a contract, not an unusable reference");
    assert.equal(contracts[0].ownershipBasis,"declared");
    assert.equal(contracts[0].confirmed,false,"but no schedule has proved an amount");
    // Nobody declared it -> it stays reference wording and creates no contract.
    assert.equal(buildContracts([{...booklet,declared_member_ids:[]}],people,[]).length,0);
    // A real schedule always outranks a declaration.
    const schedule=document({id:"schedule",declared_member_ids:[person]});
    assert.equal(buildContracts([schedule],people,[coverage()])[0].ownershipBasis,"evidence");
    // Critic R69-2 (PR #87): a booklet claimed for someone whose certificate already reads it as wording is listed once,
    // as that certificate's wording, never also as a declared contract of its own.
    const certificate=document({id:"certificate",group_policy_number:"G-100",product_name:"CareShield Life",products:["CareShield Life"]});
    const claimed={...booklet,policy_number:null,group_policy_number:"G-100",insurer:"Example Insurer"};
    const both=buildContracts([certificate,claimed],people,[coverage({policyId:"certificate",productName:"CareShield Life"})]);
    assert.equal(both.length,1,"One contract for the person");
    assert.equal(both[0].ownershipBasis,"evidence");
    assert.deepEqual(both[0].references.map(r=>r.id),["booklet"],"The booklet is the certificate's wording");
    // Without a certificate that reads it, the claimed booklet stays the person's declared contract.
    assert.equal(buildContracts([{...certificate,member_ids:[]},claimed],people,[])[0]?.ownershipBasis,"declared");
  });
  test("A declared policy pays its own printed figures, but never a share of an unknown sum insured",()=>{
    const flat:CatalogBenefit={id:"b1",policyId:"booklet",productName:"CareShield Life",benefitName:"Monthly payout",
      traits:["disability"],formulaKind:"fixed",formulaValue:600,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,
      sourcePage:4,quote:"We pay a benefit of S$600 each month.",conditions:[],requirements:[],needsReview:false};
    const declared=assessCatalogBenefit({benefit:flat,coverage:null,ownerName:"Person A",facts:{},declaredOnly:true});
    assert.equal(declared.item.amountText,"S$600.00","The document's own figure applies to the person who holds it");
    assert.equal(declared.item.amountLabel,"Amount printed in the policy document — not yet confirmed against your own schedule");
    assert.match(declared.item.reason,/page 4 of the document you uploaded/);
    assert.equal(declared.item.aggregation,"reimbursement","An unconfirmed figure is never summed into a household total");
    // A percentage of "the sum insured" is not computable without their schedule.
    const share:CatalogBenefit={...flat,id:"b2",benefitName:"Death Benefit",traits:["death"],
      formulaKind:"sum_insured",formulaValue:1,quote:"We pay the full Sum Insured."};
    const unresolved=assessCatalogBenefit({benefit:share,coverage:null,ownerName:"Person A",facts:{},declaredOnly:true});
    // The rule is shown, because the person is entitled to know their policy
    // pays the whole sum insured. What cannot be shown is a figure, because
    // nothing on file says what that sum insured is.
    assert.equal(unresolved.item.amountText,"100% of the sum insured on your schedule");
    assert.equal(unresolved.item.amountLabel,"What this benefit pays");
    assert.equal(unresolved.item.calculatedAmount,undefined);
    assert.deepEqual(aggregatePotentialPayouts([unresolved.item]),[]);
    assert.ok(unresolved.missing.some(entry=>/your own sum insured/.test(entry)),
      "It must say exactly what is needed: "+JSON.stringify(unresolved.missing));
    // With a schedule the same rule becomes a real, addable payout.
    const withSchedule=assessCatalogBenefit({benefit:share,coverage:coverage({amount:350000,currency:"SGD"}),ownerName:"Person A",facts:{}});
    assert.equal(withSchedule.item.amountText,"S$350,000");
    assert.equal(withSchedule.item.aggregation,"additive");
    assert.equal(withSchedule.item.amountLabel,"Calculated benefit (internal)");
  });
  test("A two-column page is read down each column, not across both",()=>{
    // Left and right columns share baselines, which is exactly what made the
    // old space-joined text interleave into nonsense.
    const at=(text:string,x:number,y:number,w=40):TextItem=>({text,x,y,w});
    const items=[at("People may develop",40,700),at("All Singapore Citizens",330,700),
      at("severe disability",40,684),at("are covered from age 30",330,684)];
    const bands=columnBands(items,612);
    assert.equal(bands.length,2,"A gutter between the columns must be found");
    const {text,lines}=renderPageLayout(items,612);
    assert.deepEqual(lines.map(l=>l.text),
      ["People may develop","severe disability","All Singapore Citizens","are covered from age 30"]);
    assert.ok(text.indexOf("severe disability")<text.indexOf("All Singapore Citizens"),
      "The left column must be finished before the right one starts");
  });
  test("A benefit schedule row survives as a label and an amount",()=>{
    const at=(text:string,x:number,y:number,w=60):TextItem=>({text,x,y,w});
    const {lines}=renderPageLayout([
      at("Benefit",60,700),at("Limit",380,700),
      at("Simple fracture - wrist",60,680,150),at("25% of S$5,000",380,680),
      at("Ambulance fee",60,660,110),at("Up to S$500 per incident",380,660),
      at("This section explains how to claim.",60,600,300),
    ],612);
    const rows=benefitRows(lines);
    assert.deepEqual(rows.map(r=>r.label),["Simple fracture - wrist","Ambulance fee"]);
    assert.deepEqual(rows.map(r=>r.value),["25% of S$5,000","Up to S$500 per incident"]);
    assert.equal(rows.some(r=>/explains how to claim/.test(r.label)),false,"Prose is not a table row");
  });
  test("A stored page can be re-read as a table without reopening the PDF",()=>{
    const stored="Benefit\tLimit\nSimple fracture - wrist\t25% of S$5,000\nAmbulance fee\tUp to S$500\nPlain prose with no amount";
    const rows=benefitRowsFromText(stored);
    assert.equal(rows.length,2);
    assert.equal(rows[0].label,"Simple fracture - wrist");
    assert.equal(rows[1].value,"Up to S$500");
    assert.deepEqual(benefitRowsFromText(""),[]);
  });
  test("Layout text still satisfies every exact-quote check",()=>{
    // Quote validation normalises whitespace, so tabs and newlines are safe.
    const at=(text:string,x:number,y:number,w=60):TextItem=>({text,x,y,w});
    const {text,lines}=renderPageLayout([
      at("Benefit",60,700,90),at("Limit",300,700),
      at("Simple fracture",60,680,90),at("25% of Sum Insured",300,680,120),
      at("A sentence that runs across the whole width of the page",60,660,360),
    ],612);
    assert.ok(text.includes("\t"),"Cells are preserved for later table recovery");
    assert.equal(lines[1].cells.length,2);
    assert.equal(hasQuote(text,"Simple fracture 25% of Sum Insured"),true,
      "A quote spanning two cells still matches, because whitespace is normalised");
    assert.equal(hasQuote(text,"A sentence that runs across the whole width of the page"),true);
  });
  test("A single-column page and an empty page are handled",()=>{
    const at=(text:string,x:number,y:number,w=60):TextItem=>({text,x,y,w});
    assert.equal(columnBands([at("One column of text",60,700,300)],612).length,1);
    assert.deepEqual(renderPageLayout([],612),{text:"",lines:[]});
    assert.deepEqual(renderPageLayout([at("   ",60,700)],612),{text:"",lines:[]});
    assert.deepEqual(lineFrom([at("a",10,700,5),at("b",20,700,5)]).cells,["a b"],"A word gap is a space, not a cell break");
    assert.deepEqual(lineFrom([at("a",10,700,5),at("b",15,700,5)]).cells,["ab"],"Adjacent glyphs are one word");
    assert.deepEqual(lineFrom([at("a",10,700,5),at("b",90,700,5)]).cells,["a","b"],"A wide gap is a cell break");
  });
  test("A schedule cell states its own payout rule, parsed without a model",()=>{
    // Currency is only what the cell writes: a share of the sum insured is
    // paid in the cover's own (separately verified) currency, and a bare "$"
    // names no currency -- neither is defaulted to SGD.
    const cases:[string,string,number,string|null][]=[
      // The exact MINDEF/MHA fixture: both halves are printed in the one cell,
      // so the figure is computable with no schedule and no model.
      ["25% of S$5,000","fixed",1250,"SGD"],
      ["50% of S$1,200.50","fixed",600.25,"SGD"],
      ["100% of the Sum Insured","sum_insured",1,null],
      ["150% of Sum Insured","sum_insured",1.5,null],
      ["Up to S$500 per incident","expense_cap",500,"SGD"],
      ["maximum of S$10,000","expense_cap",10000,"SGD"],
      ["S$30 per day","daily",30,"SGD"],
      ["$689/month","fixed",689,null],
      ["S$5,000","fixed",5000,"SGD"],
    ];
    for(const [cell,kind,value,currency] of cases){
      const parsed=parseBenefitValue(cell);
      assert.ok(parsed,"should parse: "+cell);
      assert.equal(parsed!.kind,kind,cell);
      assert.equal(parsed!.value,value,cell);
      assert.equal(parsed!.currency,currency,cell);
    }
    // The same cell must always give the same rule.
    assert.deepEqual(parseBenefitValue("25% of S$5,000"),parseBenefitValue("25% of S$5,000"));
  });
  test("A cell that does not state a rule is left for review, never guessed",()=>{
    for(const cell of ["Up to 30 days","As charged","Nil","Not covered","",
      "Sum Insured less any amount previously paid","S$500 minus the deductible",
      "S$1,000 to S$5,000","a very long sentence about how the company will consider paying a benefit in certain circumstances"])
      assert.equal(parseBenefitValue(cell),null,"must not invent a rule from: "+JSON.stringify(cell));
  });
  test("A reimbursement is only bound to a bill it can actually name",()=>{
    assert.equal(expenseFactKey("Ambulance fee"),"ambulanceBill");
    assert.equal(expenseFactKey("Hospital room and board"),"hospitalBill");
    assert.equal(expenseFactKey("Vehicle repair cost"),"vehicleRepairBill");
    assert.equal(expenseFactKey("Miscellaneous charges"),"outOfPocket");
    assert.equal(expenseFactKey("Total and Permanent Disablement"),null,
      "An unnamed expense must stay unbound rather than be compared to the wrong bill");
  });
  test("A daily benefit takes its waiting period and cap from its own row",()=>{
    assert.deepEqual(dailyLimitsFrom("Daily hospital cash\tS$30 per day after the 3rd day, maximum of 30 days"),
      {offsetDays:3,maximumDays:30});
    assert.deepEqual(dailyLimitsFrom("Hospital cash\tS$50 per day from the 2nd night, up to 60 nights"),
      {offsetDays:1,maximumDays:60});
    assert.deepEqual(dailyLimitsFrom("Hospital cash\tS$30 per day"),{offsetDays:0,maximumDays:null},
      "No cap stated means no cap known — not an unlimited benefit");
  });
  test("A schedule of bare percentages takes its basis from its own heading",()=>{
    // The most common benefit table there is: a personal-accident schedule whose
    // amounts are bare percentages, with the basis printed once, above them.
    const page=["C. Total and Permanent Dismemberment due to Accident","Compensation","Schedule of Indemnities","(% of Sum Insured)",
      "1.\tLoss of or Permanent Total Loss of use of at least one limb\t100%",
      "22.\tLoss of speech\t50%"].join("\n");
    const bases=percentageBases(page);
    assert.equal(bases.length,1);
    assert.deepEqual(bases[0].basis,{kind:"sum_insured"});
    const rows=benefitRowsFromText(page);
    const speech=rows.find(row=>/speech/.test(row.label))!;
    assert.equal(parseBenefitValue(speech.value),null,"Out of its table, '50%' is fifty percent of nothing");
    const parsed=parseBenefitValue(speech.value,{percentageBasis:basisForRow(bases,speech.index)})!;
    assert.equal(parsed.kind,"sum_insured");assert.equal(parsed.value,0.5);
    assert.equal(parsed.inferred,true,"A rule read from a heading is marked as such, so it is confirmed before it is used");
  });
  test("A percentage of a printed limit is calculated; a heading only applies below itself",()=>{
    const page=["Simple Fracture Benefit Limit: S$5,000","Schedule\tCompensation","(% of S$5,000)",
      "Neck, Skull or Spine (Full Break)\t100%","Arm, Elbow, Wrist or Ribs\t25%"].join("\n");
    const bases=percentageBases(page);
    const rows=benefitRowsFromText(page);
    const wrist=rows.find(row=>/Wrist/.test(row.label))!;
    const parsed=parseBenefitValue(wrist.value,{percentageBasis:basisForRow(bases,wrist.index)})!;
    assert.equal(parsed.kind,"fixed");
    assert.equal(parsed.value,1250,"25% of the S$5,000 limit printed above the table");
    // A row ABOVE a heading never borrows it.
    const mixed=["Benefit\tAmount","Accidental Hospital Recuperation\tS$250","(% of Sum Insured)","Loss of speech\t50%"].join("\n");
    const mixedBases=percentageBases(mixed),mixedRows=benefitRowsFromText(mixed);
    const above=mixedRows.find(row=>/Recuperation/.test(row.label))!;
    assert.equal(basisForRow(mixedBases,above.index),null,"A table above the heading keeps its own meaning");
    const below=mixedRows.find(row=>/speech/.test(row.label))!;
    assert.deepEqual(basisForRow(mixedBases,below.index),{kind:"sum_insured"});
  });
  test("A sentence mentioning the sum insured is not a table heading",()=>{
    for(const page of ["We will pay 100% of the Sum Insured on death.\nLoss of speech\t50%",
      "The benefit is calculated as a percentage of the Sum Insured stated in your certificate, subject to the terms below.\nLoss of speech\t50%"]){
      assert.deepEqual(percentageBases(page),[],"Only a heading-shaped cell may set the basis: "+page.slice(0,40));
    }
  });
  test("A premium rate table is never read as cover",()=>{
    const page=["Age next birthday\tAnnual premium","34 and below\t$18","35-39\t$30","40-44\t$50"].join("\n");
    assert.deepEqual(benefitRowsFromText(page).map(row=>row.label),[],
      "'35-39 pays S$30' is a premium, and showing it as cover would be a lie about what the family has");
    // A year IS a real label: CareShield Life prints its payout that way.
    assert.deepEqual(benefitRowsFromText("Year\tMonthly payout\n2026\t$689").map(row=>row.label),["2026"]);
  });
  test("A sub-row is named by the benefit it belongs to",()=>{
    const page=["2.\tPermanent Total Loss of\t(a) Sight in at least one eye\t100%","(b) Whole eye\t100%","(c) Sight in one eye,\t50%",
      "3.\tPermanent and Incurable Insanity\t100%"].join("\n");
    const labels=benefitRowsFromText(page).map(row=>row.label);
    assert.equal(labels[1],"2. Permanent Total Loss of (b) Whole eye","'(b) Whole eye' alone is not something a person can check");
    assert.equal(labels[2],"2. Permanent Total Loss of (c) Sight in one eye,");
    assert.equal(labels[3],"3. Permanent and Incurable Insanity","A new numbered benefit closes the previous group");
  });
  test("A heading that wraps across two lines still says what the percentages are of",()=>{
    // A narrow column splits its own heading. The table below it is unchanged.
    const page=["Compensation","Schedule of Indemnities\t(% of Sum","Insured)","1. Loss of one limb\t100%"].join("\n");
    const bases=percentageBases(page);
    assert.deepEqual(bases.map(entry=>entry.basis),[{kind:"sum_insured"}]);
    const row=benefitRowsFromText(page)[0];
    assert.equal(parseBenefitValue(row.value,{percentageBasis:basisForRow(bases,row.index)})!.value,1);
  });
  test("A benefit heading with no amount of its own still names the rows beneath it",()=>{
    const page=["2. Permanent Total Loss of","(a) Sight in at least one eye\t100%","(b) Whole eye\t100%",
      "3. Permanent and Incurable Insanity\t100%"].join("\n");
    const labels=benefitRowsFromText(page).map(row=>row.label);
    assert.deepEqual(labels,["2. Permanent Total Loss of (a) Sight in at least one eye",
      "2. Permanent Total Loss of (b) Whole eye","3. Permanent and Incurable Insanity"]);
  });
  test("A benefit name that runs onto the next line is read whole",()=>{
    const wrapped=benefitRowsFromText(["4. Loss of arm (at shoulder, between shoulder and elbow,\t100%",
      "at elbow, between elbow and wrist)"].join("\n"));
    assert.equal(wrapped[0].label,"4. Loss of arm (at shoulder, between shoulder and elbow, at elbow, between elbow and wrist)");
    const ampersand=benefitRowsFromText(["Mobility aid upon Accidental Total &\tUp to S$10,000","Permanent Disablement*"].join("\n"));
    assert.equal(ampersand[0].label,"Mobility aid upon Accidental Total & Permanent Disablement*");
    // A sentence that follows a complete row is not part of its name.
    const prose=benefitRowsFromText(["Ambulance Cost\tUp to S$500 per incident",
      "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme."].join("\n"));
    assert.equal(prose[0].label,"Ambulance Cost");
  });
  test("An amount that runs onto the next line finishes the amount, not the name",()=>{
    const rows=benefitRowsFromText(["Comatose State Lump Sum Benefit\t15% of Sum Insured","or up to S$50,000, whichever is lesser"].join("\n"));
    assert.equal(rows[0].label,"Comatose State Lump Sum Benefit","The second line is money, not part of the benefit's name");
    assert.match(rows[0].value,/whichever is lesser/);
    assert.equal(parseBenefitValue(rows[0].value),null,
      "A choice between two figures is not a rule DearPolicy can calculate, and 15% of the sum insured is the larger, wrong one");
  });
  test("Money the household pays is never read as money it receives",()=>{
    assert.deepEqual(benefitRowsFromText(["Standard MediShield Life premium\t$637.00","Premium before Subsidies\t$828.10"].join("\n")),[]);
    // A waiver or a refund of premium really is a benefit.
    assert.deepEqual(benefitRowsFromText("Premium Waiver Benefit\t100% of Sum Insured").map(row=>row.label),["Premium Waiver Benefit"]);
  });
  test("A pro-ration factor table is never read as cover",()=>{
    const page=["Table G: Pro-ration Factors for Hospitalisation Charges","Ward Class / Subsidy Status\tCitizen\tResident",
      "Class C\t100%\t50%","Class B1\t34%\t29%",
      "Table A: MediShield Life Benefits","Cancer drug services\t$4,500 per calendar year"].join("\n");
    const labels=benefitRowsFromText(page).map(row=>row.label);
    assert.deepEqual(labels,["Cancer drug services"],
      "'Class B1 34%' scales a bill before a claim is computed; it is not cover");
  });
  test("A rule read from a heading still produces a figure, marked indicative and kept out of the total",()=>{
    // Withholding the number protects nobody: a person who cannot see it cannot
    // check it against their own policy, and the amount is the product.
    const inferred:CatalogBenefit={id:"h1",policyId:"w",productName:"Group Personal Accident",benefitName:"Loss of speech",
      traits:["bodily_injury"],formulaKind:"sum_insured",formulaValue:0.5,currency:"SGD",factKey:null,
      offsetDays:null,maximumDays:null,sourcePage:6,quote:"Loss of speech 50%",
      conditions:[],requirements:[],needsReview:true,basisInferred:true,needsConfirmation:true};
    const unconfirmed=assessCatalogBenefit({benefit:inferred,coverage:coverage({amount:600_000,documentRole:"certificate"}),ownerName:"Person A",facts:{}});
    assert.equal(unconfirmed.item.amountText,"S$300,000","The figure is shown");
    assert.equal(unconfirmed.item.estimateBasis,"indicative","…and labelled for what it is");
    assert.match(unconfirmed.item.reason,/heading above this row/);
    assert.ok(unconfirmed.missing.some(entry=>/confirmation of what this benefit pays/.test(entry)));
    // It is shown, and it is not added up.
    assert.deepEqual(aggregatePotentialPayouts([unconfirmed.item]),[],
      "One rate read from a table heading must not inflate what the household is told it can claim");
    // Once a person confirms it on the Benefits page it counts like any other rule.
    const confirmed={...inferred,needsReview:false,basisInferred:false,needsConfirmation:false};
    const settled=assessCatalogBenefit({benefit:confirmed,coverage:coverage({amount:600_000,documentRole:"certificate"}),ownerName:"Person A",facts:{}});
    assert.equal(settled.item.amountText,"S$300,000");
    assert.equal(settled.item.estimateBasis,"confirmed");
    assert.equal(aggregatePotentialPayouts([settled.item])[0].amountText,"S$300,000");
  });
  test("A sum insured that did not come from the person's own schedule is an estimate, not a claim",()=>{
    const rule:CatalogBenefit={id:"d1",policyId:"w",productName:"Group Term Life",benefitName:"Death Benefit",
      traits:["death"],formulaKind:"sum_insured",formulaValue:1,currency:"SGD",factKey:null,
      offsetDays:null,maximumDays:null,sourcePage:9,quote:"On death we pay the Sum Insured.",
      conditions:[],requirements:[],needsReview:false};
    const own=assessCatalogBenefit({benefit:rule,coverage:coverage({amount:1_000_000,documentRole:"personal_schedule"}),ownerName:"Person A",facts:{}});
    assert.equal(own.item.amountText,"S$1,000,000");
    assert.equal(own.item.estimateBasis,"confirmed");
    const secondhand=assessCatalogBenefit({benefit:rule,coverage:coverage({amount:1_000_000,documentRole:"policy_wording"}),ownerName:"Person A",facts:{}});
    assert.equal(secondhand.item.amountText,"S$1,000,000","The figure is still given — that is the whole point of the product");
    assert.equal(secondhand.item.estimateBasis,"estimated");
    assert.match(secondhand.item.reason,/rather than in your own schedule or certificate/);
    // Both are real enough to add up; only an indicative reading is not.
    assert.equal(aggregatePotentialPayouts([secondhand.item])[0].amountText,"S$1,000,000");
  });
  test("A daily row with no stated cap still pays for the days reported, with the unknown cap as a condition",()=>{
    const uncapped:CatalogBenefit={id:"d1",policyId:"w",productName:"Plan",benefitName:"Daily hospital cash",
      traits:["hospitalisation"],formulaKind:"daily",formulaValue:30,currency:"SGD",factKey:"hospitalNights",
      offsetDays:0,maximumDays:null,sourcePage:9,quote:"Daily hospital cash S$30 per day",conditions:[],requirements:[],needsReview:true};
    const assessed=assessCatalogBenefit({benefit:uncapped,coverage:coverage(),ownerName:"Person A",facts:{hospitalNights:fact(10)}});
    // Ten reported days at the quoted rate. A cap the person cannot see is not
    // a reason to show them nothing -- it is a condition on the figure.
    assert.equal(assessed.item.amountText,"S$300.00");
    assert.equal(assessed.missing.some(entry=>/maximum number of days/.test(entry)),false,"An unstated cap no longer blocks the amount");
    assert.ok(assessed.item.conditions.some(c=>/does not state a maximum number of payable days/i.test(c)),
      "The unknown cap must travel with the figure: "+JSON.stringify(assessed.item.conditions));
    assert.equal(assessed.item.estimateBasis,"estimated","An uncapped daily figure is an estimate, not a confirmed calculation");
    // A cap that IS stated still binds.
    const capped={...uncapped,maximumDays:3};
    assert.equal(assessCatalogBenefit({benefit:capped,coverage:coverage(),ownerName:"Person A",
      facts:{hospitalNights:fact(10)}}).item.amountText,"S$90.00");
  });
  test("Two critical-illness plans under one scheme are counted, and the acceleration is flagged",()=>{
    const ci=(title:string,amount:number,cover:string):ClaimItem=>({title,status:"likely_applicable",
      amountText:"S$"+amount.toLocaleString("en-SG"),estimateBasis:"confirmed",calculatedAmount:amount,currency:"SGD",
      calculationKind:"sum_insured",aggregation:"additive",coverKey:cover,payingEvent:"critical_illness",reason:"",conditions:[]});
    const both=[ci("A · Group Living Care",350_000,"policy:3037850|living care"),
      ci("A · Early Critical Illness Benefit",150_000,"policy:3037850|living care plus")];
    const warnings=acceleratedBenefitWarnings(both);
    assert.equal(warnings.length,1);
    assert.match(warnings[0],/accelerated/);
    // The money is still counted: withholding it because a clause MIGHT reduce
    // it is its own kind of wrong answer.
    assert.deepEqual(aggregatePotentialPayouts(both),[{currency:"SGD",amount:500_000,amountText:"S$500,000",itemCount:2}]);
    // A death benefit and an accidental death benefit genuinely cumulate, so
    // no caveat is raised there.
    const deaths=[{...ci("A · Death Benefit",1_000_000,"policy:3037850|group term life"),payingEvent:"death"},
      {...ci("A · Death due to Accident",600_000,"policy:3037850|group personal accident"),payingEvent:"death"}];
    assert.deepEqual(acceleratedBenefitWarnings(deaths),[]);
    // One plan alone raises nothing either.
    assert.deepEqual(acceleratedBenefitWarnings([both[0]]),[]);
  });
  test("The policy's own schedule of defined conditions beats the national baseline",()=>{
    // The honest limit of the dengue fix: the standard list is a floor, and a
    // plan that defines more than the standard 37 would have its own named
    // condition refused. When that plan's benefit table was catalogued at
    // upload, its rows ARE its schedule, and they are already on file.
    const rows=["Severe Rheumatoid Arthritis","Major Cancer","Diabetic Complications","Early Thyroid Cancer","Group Living Care"];
    assert.deepEqual(matchesPolicySchedule("rheumatoid arthritis",rows),["Severe Rheumatoid Arthritis"]);
    assert.deepEqual(matchesPolicySchedule("diabetic complications",rows),["Diabetic Complications"]);
    assert.ok(matchesPolicySchedule("thyroid cancer",rows).includes("Early Thyroid Cancer"));
    // The standard list says nothing about these two, which is the point.
    assert.deepEqual(definedConditionsFor("severe rheumatoid arthritis"),[]);
    assert.deepEqual(definedConditionsFor("diabetic complications"),[]);
    // And nothing in a schedule answers dengue.
    assert.deepEqual(matchesPolicySchedule("dengue fever",rows),[]);
    assert.deepEqual(matchesPolicySchedule("food poisoning",rows),[]);
    assert.deepEqual(matchesPolicySchedule("",rows),[]);
    // A diagnosis named only in the policy's own schedule still opens the
    // critical-illness door.
    assert.ok(reportedClaimEvents({},["illness","diagnosis"],["rheumatoid arthritis"],rows).includes("critical_illness"));
    assert.equal(reportedClaimEvents({},["illness","diagnosis"],["rheumatoid arthritis"],[]).includes("critical_illness"),false);
    assert.equal(reportedClaimEvents({},["illness","diagnosis"],["dengue fever"],rows).includes("critical_illness"),false);
  });
  test("A booklet's death and disability rows find the cover they pay on",()=>{
    // A group booklet covers several plans under one product name, so its rows
    // resolved to no cover at all and the person was told to "set the product
    // name to match the certificate" -- admin, for a question their own
    // documents already answer.
    const scheme:PolicyContract={...contract,coverages:[
      coverage({id:"gtl",category:"Death",amount:1_000_000,productName:"Group Term Life"}),
      coverage({id:"tpd",category:"Total Permanent Disability",amount:1_000_000,productName:"Group Term Life"}),
      coverage({id:"gpa",category:"Personal Accident",amount:600_000,productName:"Group Personal Accident"}),
      coverage({id:"lc",category:"Critical Illness",amount:350_000,productName:"Living Care"}),
    ]};
    const booklet=(benefitName:string,quote:string,requires?:CatalogBenefit["requires"]):CatalogBenefit=>({
      id:benefitName,policyId:"booklet",productName:"Hospitalisation",benefitName,traits:benefitTraits(benefitName,quote),
      requires,formulaKind:"sum_insured",formulaValue:1,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,
      sourcePage:5,quote,conditions:[],requirements:[],needsReview:false});
    assert.equal(coverageForBenefit(scheme,booklet("Death","On death we pay 100% of the Sum Insured."))?.id,"gtl");
    assert.equal(coverageForBenefit(scheme,booklet("Total and Permanent Disability Benefit (TPD)",
      "We pay 100% of the Sum Insured on total and permanent disability."))?.id,"tpd");
    // Conditional on an accident: the accident plan, not the life sum. This is
    // what keeps a 150% accidental disablement benefit off S$1,000,000.
    assert.equal(coverageForBenefit(scheme,booklet("Total and Permanent Disablement due to Accident",
      "150% of the Sum Insured where disablement results from an accident.",["accident"]))?.id,"gpa");
    assert.equal(coverageForBenefit(scheme,booklet("Death due to Accident",
      "100% of the Sum Insured where death results from an accident.",["death","accident"]))?.id,"gpa");
    assert.equal(coverageForBenefit(scheme,booklet("Group Living Care",
      "100% of the Sum Insured on diagnosis of a Critical Illness."))?.id,"lc");
    // A benefit that pays on none of those is left unresolved rather than
    // attached to whichever cover happens to be first.
    assert.equal(coverageForBenefit(scheme,booklet("Daily Hospital Cash Benefit","S$30 for each day of confinement.")),null);
  });
  test("A group scheme's rows find their own cover even when every cover carries the scheme's name",()=>{
    // Live release set (20 Oct): the scheme's product summary and certificate name every cover after the scheme, so an
    // accidental-death or fracture row "matched" the first cover by name -- the S$1,000,000 term life -- not the
    // S$600,000 personal accident cover it pays under.
    const named=(id:string,category:string,amount:number)=>coverage({id,category,amount,productName:"Example Group Scheme"});
    const scheme:PolicyContract={...contract,coverages:[named("gtl","Group Term Life",1_000_000),named("gpa","Group Personal Accident",600_000),named("lc","Group Living Care",350_000)]};
    const row=(benefitName:string,quote:string,requires?:CatalogBenefit["requires"]):CatalogBenefit=>({
      id:benefitName,policyId:"summary",productName:"Example Group Scheme",benefitName,traits:benefitTraits(benefitName,quote),
      requires,formulaKind:"sum_insured",formulaValue:1,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,
      sourcePage:5,quote,conditions:[],requirements:[],needsReview:false});
    assert.equal(coverageForBenefit(scheme,row("Accidental Death","100% of the Sum Insured where death results from an accident.",["death","accident"]))?.id,"gpa");
    assert.equal(coverageForBenefit(scheme,row("Loss of sight in one eye","50% of the Sum Insured.",["accident"]))?.id,"gpa");
    assert.equal(coverageForBenefit(scheme,row("Death","On death we pay 100% of the Sum Insured."))?.id,"gtl");
    assert.equal(coverageForBenefit(scheme,row("Critical Illness","100% of the Sum Insured on diagnosis of a Critical Illness."))?.id,"lc");
    // Nothing tells the covers apart: no figure is worked out from any of them.
    assert.equal(coverageForBenefit(scheme,row("Daily Hospital Cash Benefit","S$30 for each day of confinement.")),null);
    // Evidence Reviewer, 21 Oct: with no disability cover of its own, the scheme's TPD is 100% of the Group Term Life sum
    // insured. Its accident TPD (150%) is the accident plan's, and the two are never added.
    assert.equal(coverageForBenefit(scheme,row("Total and Permanent Disability Benefit","We pay 100% of the Sum Insured on total and permanent disability."))?.id,"gtl");
    assert.equal(coverageForBenefit(scheme,row("Total and Permanent Disablement due to Accident","150% of the Sum Insured where disablement results from an accident.",["accident"]))?.id,"gpa");
    assert.notEqual(coverageForBenefit(scheme,row("Permanent Total Disablement","100% of the Sum Insured where an injury results in permanent total disablement."))?.id,"gtl");
    // Critic R81-1: a row that only mentions TPD in its wording is not the life cover's TPD.
    assert.notEqual(coverageForBenefit(scheme,row("Natural Catastrophe","An additional 15% of the Sum Insured is payable on death or Total and Permanent Disability resulting from a natural catastrophe."))?.id,"gtl");
  });
  test("The policy's own limits on adding injuries up are followed",()=>{
    // Two sentences from the household's own wording: a schedule amount is not
    // paid for a disability that also qualifies for Total and Permanent
    // Disability, and everything paid for injuries from one accident is capped
    // in aggregate at the sum insured.
    const line=(title:string,amount:number,over:Partial<ClaimItem>={}):ClaimItem=>({title,status:"likely_applicable",
      amountText:"S$"+amount.toLocaleString("en-SG"),estimateBasis:"confirmed",calculatedAmount:amount,currency:"SGD",
      calculationKind:"sum_insured",aggregation:"additive",coverKey:"policy:GPA|group personal accident",
      coverAmount:600_000,scaleGroup:"doc#10",reason:"",conditions:[],...over});
    // Total and permanent disability pays instead of the schedule.
    const withTpd=[
      line("A · Total and Permanent Disablement due to Accident",900_000,{scaleGroup:undefined,payingEvent:"total_permanent_disability"}),
      line("A · 1. Loss of use of at least one limb",600_000),
    ];
    const tpdNotes=applyPolicyAggregateCaps(withTpd);
    assert.equal(withTpd[1].supersededBy,"A · Total and Permanent Disablement due to Accident");
    assert.match(tpdNotes.join(" "),/cannot be claimed under both/);
    assert.deepEqual(aggregatePotentialPayouts(withTpd),[{currency:"SGD",amount:900_000,amountText:"S$900,000",itemCount:1}]);
    // Otherwise the schedule is capped at the sum insured, by reducing the
    // figure that breaches it rather than by dropping a benefit.
    const overCap=[
      line("A · 4. Loss of arm",600_000,{scaleGroup:"doc#10"}),
      line("A · 22. Loss of speech",300_000,{scaleGroup:"doc#10"}),
    ];
    // Two different schedules so the pays-once rule does not apply first.
    overCap[1].scaleGroup="doc#11";
    const capNotes=applyPolicyAggregateCaps(overCap);
    assert.equal(overCap[0].calculatedAmount,600_000);
    assert.equal(overCap[1].calculatedAmount,undefined,"the cap is already used up");
    assert.ok(overCap[1].supersededBy,"and the row says so rather than vanishing");
    assert.match(capNotes.join(" "),/capped at the sum insured/);
    assert.deepEqual(aggregatePotentialPayouts(overCap),[{currency:"SGD",amount:600_000,amountText:"S$600,000",itemCount:1}]);
    // A figure that only partly breaches the cap is reduced to what is left,
    // and says what it was reduced from.
    const partial=[
      line("A · 4. Loss of arm",400_000,{scaleGroup:"doc#10"}),
      line("A · 22. Loss of speech",300_000,{scaleGroup:"doc#11"}),
    ];
    applyPolicyAggregateCaps(partial);
    assert.equal(partial[0].calculatedAmount,400_000);
    assert.equal(partial[1].calculatedAmount,200_000);
    assert.match(partial[1].conditions.join(" "),/Reduced from S\$300,000/);
    assert.deepEqual(aggregatePotentialPayouts(partial),[{currency:"SGD",amount:600_000,amountText:"S$600,000",itemCount:2}]);
    // Under the cap, nothing is touched.
    const underCap=[line("A · 22. Loss of speech",300_000,{scaleGroup:"doc#11"})];
    assert.deepEqual(applyPolicyAggregateCaps(underCap),[]);
    assert.equal(underCap[0].calculatedAmount,300_000);
  });
  test("A scale that pays less for a worse injury was read wrong, and says so",()=>{
    // Straight off the live benefit table: "10% or more of the body -- 50%",
    // then "15% or more -- 30%". No insurer wrote that. Two tables on one page
    // have been interleaved, or a column has drifted.
    const band=(name:string,value:number,over:Partial<CatalogBenefit>={}):CatalogBenefit=>({
      id:name,policyId:"summary",productName:"Group Personal Accident",benefitName:name,traits:["bodily_injury"],
      formulaKind:"sum_insured",formulaValue:value,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,
      sourcePage:7,quote:"",conditions:[],requirements:[],needsReview:false,needsConfirmation:false,...over});
    const broken=holdNonMonotonicBands([
      band("Body - Equals to or greater than 10% but less than 15%",0.5),
      band("Body - Equals to or greater than 15% but less than 25%",0.3),
    ]);
    assert.equal(broken[0].needsConfirmation,true);
    assert.equal(broken[1].needsConfirmation,true);
    assert.match(broken[0].conditions.join(" "),/pays less for a worse injury/);
    // Once the parser carries the table's own heading down, the same rows are
    // two sound scales rather than one broken one.
    const labelled=holdNonMonotonicBands([
      band("Third Degree Burns \u00b7 Body - Equals to or greater than 10% but less than 15%",0.5),
      band("Third Degree Burns \u00b7 Body - Equals to or greater than 15% but less than 20%",0.75),
      band("Third Degree Burns \u00b7 Body - Equals to or greater than 20%",1),
      band("Second Degree Burns \u00b7 Body - Equals to or greater than 15% but less than 25%",0.3),
      band("Second Degree Burns \u00b7 Body - Equals to or greater than 25% but less than 40%",0.4),
      band("Second Degree Burns \u00b7 Body - Equals to or greater than 40%",0.5),
    ]);
    assert.equal(labelled.some(entry=>entry.needsConfirmation),false,
      "two tables, each running the right way, are not one broken scale");
    // A scale that runs the right way is left alone.
    const sound=holdNonMonotonicBands([
      band("Head - Equals to or greater than 2% but less than 5%",0.5),
      band("Head - Equals to or greater than 10%",1),
    ]);
    assert.equal(sound[0].needsConfirmation,false);
    assert.deepEqual(sound[0].conditions,[]);
    // Head and Body are different scales and are not compared with each other.
    const mixed=holdNonMonotonicBands([
      band("Head - Equals to or greater than 2% but less than 5%",0.5),
      band("Body - Equals to or greater than 10% but less than 15%",0.4),
    ]);
    assert.equal(mixed[0].needsConfirmation,false);
    assert.equal(mixed[1].needsConfirmation,false);
    // A row a person has already reviewed is never reopened.
    const reviewed=holdNonMonotonicBands([
      band("Body - Equals to or greater than 10% but less than 15%",0.5,{reviewedAt:"2026-01-01"}),
      band("Body - Equals to or greater than 15% but less than 25%",0.3,{reviewedAt:"2026-01-01"}),
    ]);
    assert.equal(reviewed[0].needsConfirmation,false);
  });
  test("A burns band answers to a burn, and carries the largest percentages in the plan",()=>{
    // These rows name no injury at all, so nothing recognised them, and they
    // hold the biggest percentages on the schedule. Any reported injury matched
    // every band at once: 50%, 75% and 100% of a S$600,000 cover, from one
    // accident. The percentage in the name is a percentage of the BODY.
    const band=(name:string):CatalogBenefit=>({id:name,policyId:"summary",productName:"Group Personal Accident",
      benefitName:name,traits:["bodily_injury"],formulaKind:"sum_insured",formulaValue:0.5,currency:"SGD",
      factKey:null,offsetDays:null,maximumDays:null,sourcePage:7,quote:"",conditions:[],requirements:[],needsReview:false});
    assert.equal(namesASpecificInjury("Body - Equals to or greater than 10% but less than 15%"),true);
    assert.equal(namesASpecificInjury("Equals to or greater than 20%"),true);
    assert.equal(namesASpecificInjury("Head - Equals to or greater than 10%"),true);
    // A broken wrist is not a burn, so the bands answer nothing.
    const wrist={fractureBodyPart:fact("wrist"),injured:fact(true)};
    assert.equal(injuryNotReported(band("Body - Equals to or greater than 10% but less than 15%"),wrist),
      "Body - Equals to or greater than 10% but less than 15%");
    // A reported burn does.
    assert.equal(injuryNotReported(band("Body - Equals to or greater than 10% but less than 15%"),
      {injuries:fact("burns to 12% of the body")}),null);
    assert.equal(injuryNotReported(band("Equals to or greater than 20%"),
      {permanentImpairment:fact("assessed impairment of 22%")}),null);
    // Nothing described yet still shows what the policy pays.
    assert.equal(injuryNotReported(band("Equals to or greater than 20%"),{}),null);
  });
  test("A schedule of injuries pays for the injury that happened, not for every line describing it",()=>{
    // "I lost my thumb" matches the thumb row, the phalanx-of-thumb row and the
    // fingers row. Those are subdivisions of one injury, not three payouts.
    const line=(title:string,amount:number,group:string):ClaimItem=>({title,status:"likely_applicable",
      amountText:"S$"+amount.toLocaleString("en-SG"),estimateBasis:"confirmed",calculatedAmount:amount,currency:"SGD",
      calculationKind:"sum_insured",aggregation:"additive",coverKey:"policy:GPA|group personal accident",
      scaleGroup:group,reason:"",conditions:[]});
    const thumb=[
      line("A · 11. Loss of use of (a) Right Thumb",180_000,"doc#11"),
      line("A · 11. Loss of use of (c) One Phalanx of Right Thumb",120_000,"doc#11"),
      line("A · 14. Loss of any other finger (a) Right hand",36_000,"doc#11"),
      // A different table on a different page: a fracture benefit really is a
      // separate benefit and still pays.
      line("A · Arm, Elbow, Wrist or Ribs",1_000,"doc#8"),
    ];
    const {notes}=resolveCoverOverlaps(thumb);
    assert.equal(thumb[0].calculatedAmount,180_000,"the largest line on the schedule is the one counted");
    assert.equal(thumb[1].supersededBy,"A · 11. Loss of use of (a) Right Thumb");
    assert.equal(thumb[2].supersededBy,"A · 11. Loss of use of (a) Right Thumb");
    assert.equal(thumb[3].supersededBy,undefined,"a separate schedule is a separate benefit");
    assert.match(notes.join(" "),/counted once rather than added up/);
    assert.match(notes.join(" "),/If there were separate injuries/);
    assert.deepEqual(aggregatePotentialPayouts(thumb),[{currency:"SGD",amount:181_000,amountText:"S$181,000",itemCount:2}]);
    // One line alone is just a benefit.
    const single=[line("A · 22. Loss of speech",300_000,"doc#11")];
    resolveCoverOverlaps(single);
    assert.equal(single[0].supersededBy,undefined);
  });
  test("A rule two documents state identically no longer waits for a person to confirm it",()=>{
    // 116 of the 181 rules on file were waiting to be confirmed, and the
    // dismemberment scale is most of them: read from a column heading in one
    // document, and read again, identically, from a different layout in
    // another. Two independent readings agreeing IS the agreement the
    // confirmation was asking a person to supply.
    const row=(id:string,policyId:string,name:string,value:number,over:Partial<CatalogBenefit>={}):CatalogBenefit=>({
      id,policyId,productName:"Group Personal Accident",benefitName:name,traits:["bodily_injury"],
      formulaKind:"sum_insured",formulaValue:value,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,
      sourcePage:6,quote:"",conditions:[],requirements:[],needsReview:false,basisInferred:true,needsConfirmation:true,...over});
    const agreeing=corroborateInferredRules([
      row("a","summary","22. Loss of speech",0.5),
      row("b","booklet","22. Loss of speech",0.5),
    ]);
    assert.equal(agreeing[0].needsConfirmation,false);
    assert.equal(agreeing[1].needsConfirmation,false);
    assert.match(agreeing[0].conditions.join(" "),/two of your documents state this rule identically/);
    // Bands that differ only in their numbers are different rows. Dropping the
    // digits made every band of a burns table the same row, so two documents
    // stating an identical scale looked like two documents contradicting each
    // other, and every band stayed waiting.
    const bands=corroborateInferredRules([
      row("a1","summary","Second Degree Burns \u00b7 Body - Equals to or greater than 15% but less than 25%",0.3),
      row("b1","booklet","Second Degree Burns \u00b7 Body - Equals to or greater than 15% but less than 25%",0.3),
      row("a2","summary","Second Degree Burns \u00b7 Body - Equals to or greater than 25% but less than 40%",0.4),
      row("b2","booklet","Second Degree Burns \u00b7 Body - Equals to or greater than 25% but less than 40%",0.4),
    ]);
    assert.equal(bands.filter(entry=>entry.needsConfirmation).length,0,
      "two documents stating the same scale agree, band by band");
    // One document alone is one reading, and still waits.
    assert.equal(corroborateInferredRules([row("a","summary","22. Loss of speech",0.5)])[0].needsConfirmation,true);
    // The same document twice is not two documents.
    assert.equal(corroborateInferredRules([
      row("a","summary","22. Loss of speech",0.5),row("b","summary","22. Loss of speech",0.5)])[0].needsConfirmation,true);
    // Two documents disagreeing is exactly what confirmation exists for.
    const disagreeing=corroborateInferredRules([
      row("a","summary","Arm, Elbow, Wrist or Ribs",0.2),
      row("b","booklet","Arm , Elbow, Wrist or Ribs",0.25),
    ]);
    assert.equal(disagreeing[0].needsConfirmation,true);
    assert.equal(disagreeing[1].needsConfirmation,true);
    // A row a person already reviewed is never reopened or relabelled.
    const reviewed=corroborateInferredRules([
      row("a","summary","22. Loss of speech",0.5,{needsConfirmation:false,reviewedAt:"2026-01-01"}),
      row("b","booklet","22. Loss of speech",0.5,{needsConfirmation:false,reviewedAt:"2026-01-01"})]);
    assert.deepEqual(reviewed[0].conditions,[]);
  });
  test("A fracture scale's percentages are worked out against the limit the household's own documents imply",()=>{
    // The live benefit table states this scale twice: as percentages in one
    // document and as amounts in another. Applied to the S$600,000 sum insured,
    // "20% for a fractured wrist" is S$120,000 -- a hundred times the S$1,250
    // the other document prints on the same row.
    const row=(over:Partial<CatalogBenefit>):CatalogBenefit=>({id:String(over.benefitName),policyId:"doc",productName:"Group Personal Accident",
      benefitName:"x",traits:["bodily_injury","accident"],formulaKind:"none",formulaValue:null,currency:"SGD",factKey:null,
      offsetDays:null,maximumDays:null,sourcePage:1,quote:"",conditions:[],requirements:[],needsReview:false,...over});
    const share=(name:string,value:number)=>row({benefitName:name,policyId:"summary",sourcePage:8,
      formulaKind:"sum_insured",formulaValue:value,basisInferred:true,needsConfirmation:true});
    const amount=(name:string,value:number)=>row({benefitName:name,policyId:"booklet",sourcePage:13,
      formulaKind:"fixed",formulaValue:value});
    const catalog=[
      share("Hip",0.75),amount("Hip",3_750),
      share("Jaw, Pelvis, Leg, Ankle or Knee",0.5),amount("Jaw, Pelvis, Leg^, Ankle or Knee",2_500),
      share("Neck, Skull or Spine (Full Break)",1),amount("Neck, Skull or Spine (Full Break)",5_000),
      // A percentage row with no amount anywhere: this is the one the person
      // could not be given a figure for.
      share("Cheekbone, Shoulder or Hairline Fracture of Skull or Spine",0.3),
      // A dismemberment row, on a different page, which really IS a percentage
      // of the plan's sum insured and must not be touched.
      share("22. Loss of speech",0.5),
    ];
    catalog[catalog.length-1].sourcePage=6;
    const scale=impliedScaleLimit(catalog)!;
    assert.equal(scale.limit,5_000);
    assert.ok(scale.support>=2,"one coincidence is not a scale");
    const applied=applyImpliedScaleLimit(catalog);
    const cheekbone=applied.find(entry=>entry.benefitName.startsWith("Cheekbone"))!;
    assert.equal(cheekbone.formulaKind,"fixed");
    assert.equal(cheekbone.formulaValue,1_500,"30% of the S$5,000 limit, not 30% of the sum insured");
    assert.equal(cheekbone.needsConfirmation,false,"and the person is no longer asked to confirm it");
    assert.match(cheekbone.conditions.join(" "),/not of the plan's sum insured/);
    const speech=applied.find(entry=>entry.benefitName.startsWith("22."))!;
    assert.equal(speech.formulaKind,"sum_insured","a dismemberment scale is left exactly as it was");
    assert.equal(speech.formulaValue,0.5);
    // Nothing to corroborate means nothing is changed.
    assert.equal(impliedScaleLimit([share("Hip",0.75)]),null);
    assert.equal(impliedScaleLimit([share("Hip",0.75),amount("Hip",3_750)]),null,"a single pair is not agreement");
  });
  test("A fracture row printed as a share of a fixed limit and as a share of the sum insured is two alternatives, never one pick or a total",()=>{
    // Policy Evidence Reviewer, 20 Oct (mnt/project-files/ux-live/release-set/reviewer-confirmations.md): the product
    // summary's table is "Compensation (% of S$5,000)" (wrist 25%, hip 75%) and the benefit summary's is "Compensation
    // Schedule (% of Sum Insured)" (wrist 20%, hip 75%). The second heading PRINTS its base, so it is not rewritten to a
    // share of the S$5,000 limit implied by the first document (the Benefits page showed the wrist as S$1,000), and the
    // two readings are alternatives the insurer decides between.
    const headingNote=(p:number)=>"DearPolicy read this as "+p+"% of the sum insured, from the heading of the schedule this row sits in.";
    const row=(over:Partial<CatalogBenefit>):CatalogBenefit=>({id:String(over.id),policyId:"doc",productName:"Group Personal Accident",
      benefitName:"x",traits:["bodily_injury","accident"],requires:["accident"],formulaKind:"none",formulaValue:null,currency:"SGD",factKey:null,
      offsetDays:null,maximumDays:null,sourcePage:1,quote:"",conditions:[],requirements:[],needsReview:false,...over});
    const fixedLimit=(id:string,name:string,percent:number)=>row({id,benefitName:name,policyId:"summary",sourcePage:13,formulaKind:"fixed",
      formulaValue:50*percent,quote:name+" "+percent+"%",conditions:["DearPolicy read this as "+percent+"% of the S$5,000 limit stated in the heading of this schedule."]});
    // The real stored shape: read from the heading (basisInferred), the heading printing "% of Sum Insured".
    const statedBase=(id:string,name:string,percent:number,inferred=true)=>row({id,benefitName:name,policyId:"benefit-summary",sourcePage:8,formulaKind:"sum_insured",
      formulaValue:percent/100,basisInferred:inferred,needsConfirmation:inferred,quote:name+" "+percent+"%",conditions:[headingNote(percent)]});
    const catalog=[
      fixedLimit("ps-hip","Hip",75),statedBase("bs-hip","Hip",75),
      fixedLimit("ps-wrist","Arm , Elbow, Wrist or Ribs",25),statedBase("bs-wrist","Arm, Elbow, Wrist or Ribs (Other Fracture)",20),
      fixedLimit("ps-ankle","Jaw, Pelvis, Leg^, Ankle or Knee",50),statedBase("bs-ankle","Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)",50),
      fixedLimit("ps-neck","Neck, Skull or Spine (Full Break)",100),statedBase("bs-neck","Neck, Skull or Spine (Full Break)",100,false),
      // A dismemberment row really is a share of the sum insured.
      row({id:"bs-eye",benefitName:"Sight in one eye, except perception of light",policyId:"benefit-summary",sourcePage:6,formulaKind:"sum_insured",formulaValue:0.5,basisInferred:true,conditions:[headingNote(50)]}),
    ];
    const resolved=resolveStoredRules(catalog);
    const byId=(id:string)=>resolved.find(b=>b.id===id)!;
    // Negative control: the stated-base rows are not rewritten to a fixed S$3,750 / S$1,000, and the dismemberment row stays.
    for(const id of ["bs-hip","bs-wrist","bs-ankle","bs-neck","bs-eye"])assert.equal(byId(id).formulaKind,"sum_insured",id+" keeps the base its own heading prints");
    assert.equal(byId("bs-hip").formulaValue,0.75);
    assert.equal(byId("bs-wrist").formulaValue,0.2);
    assert.doesNotMatch(byId("bs-wrist").conditions.join(" "),/not of the plan's sum insured|does not say what the percentage is of/);
    const scheme:PolicyContract={...contract,coverages:[
      coverage({id:"gtl",category:"Group Term Life",amount:1_000_000,productName:"Group Term Life"}),
      coverage({id:"gpa",category:"Group Personal Accident",amount:600_000,productName:"Group Personal Accident"}),
    ]};
    const groups=amountAlternatives(scheme,resolved,id=>id==="summary"?"Product Summary":"Benefit Summary");
    const figures=(id:string)=>groups.get(id)?.options.map(o=>o.amountText).sort();
    assert.deepEqual(figures("bs-hip"),["S$3,750","S$450,000"].sort(),"hip: 75% of S$5,000 or 75% of S$600,000");
    assert.deepEqual(figures("bs-wrist"),["S$1,250","S$120,000"].sort(),"wrist: 25% of S$5,000 or 20% of S$600,000");
    assert.deepEqual(figures("ps-wrist"),figures("bs-wrist"),"the same group on every member row");
    assert.equal(groups.get("ps-wrist")?.groupId,groups.get("bs-wrist")?.groupId);
    assert.deepEqual(figures("bs-ankle"),["S$2,500","S$300,000"].sort(),"ankle: 50% of S$5,000 or 50% of S$600,000");
    assert.deepEqual(figures("bs-neck"),["S$5,000","S$600,000"].sort(),"a stated base that was never heading-inferred groups the same way");
    // No single pick, no total, and the insurer decides.
    const wrist=groups.get("bs-wrist")!;
    assert.equal(wrist.options.length,2);
    assert.equal(wrist.note,ALTERNATIVES_NOTE);
    assert.match(wrist.note,/never added together; the insurer decides/);
    const shown=JSON.stringify([...groups.values()]);
    assert.doesNotMatch(shown,/121,250|453,750|302,500|S\$1,000(?![,\d])/);
    assert.match(wrist.options.find(o=>o.rowId==="bs-wrist")!.basis,/20% of the S\$600,000 Group Personal Accident sum insured/);
    assert.match(wrist.options.find(o=>o.rowId==="ps-wrist")!.basis,/25% of the S\$5,000 limit/);
    assert.equal(groups.has("bs-eye"),false,"a row stated once has no alternatives");
    // One option that cannot be worked out (no sum insured to take the share of) drops the whole group.
    assert.equal(amountAlternatives({...scheme,coverages:[]},resolved,()=>"x").size,0);
  });
  test("Rows of different benefits that share a name, or a generic name, are never alternatives (Critic R29-2)",()=>{
    const row=(over:Partial<CatalogBenefit>):CatalogBenefit=>({id:String(over.id),policyId:"doc",productName:"Group Personal Accident",
      benefitName:"Leg",traits:["bodily_injury","accident"],requires:["accident"],formulaKind:"sum_insured",formulaValue:0.5,currency:"SGD",factKey:null,
      offsetDays:null,maximumDays:null,sourcePage:1,quote:"Leg 50%",conditions:[],requirements:[],needsReview:false,...over});
    const scheme:PolicyContract={...contract,coverages:[coverage({id:"gpa",category:"Group Personal Accident",amount:600_000,productName:"Group Personal Accident"})]};
    const name=()=>"Benefit Summary";
    // One document, two tables, both with a "Leg" row: a fracture of the leg and the loss of a leg.
    const oneDocument=[row({id:"fracture-leg",sourcePage:8,formulaKind:"fixed",formulaValue:2500,quote:"Leg 50%"}),
      row({id:"loss-leg",sourcePage:6,formulaValue:0.5,traits:["bodily_injury","disability","accident"],quote:"Leg 50%"})];
    assert.equal(amountAlternatives(scheme,oneDocument,name).size,0,"two tables of one document are two benefits");
    // Two documents: the fracture row in one, the loss-of-limb row in the other.
    const twoDocuments=[row({id:"fracture-leg",policyId:"summary",formulaKind:"fixed",formulaValue:2500,quote:"Leg 50%"}),
      row({id:"loss-leg",policyId:"benefit-summary",formulaValue:0.5,traits:["bodily_injury","disability","accident"],quote:"Leg 50%"})];
    assert.equal(amountAlternatives(scheme,twoDocuments,name).size,0,"a fracture and a loss of limb are not alternatives");
    // The same name with words naming different events.
    const namedApart=[row({id:"a",policyId:"summary",formulaKind:"fixed",formulaValue:2500,quote:"Leg (fracture) 50%"}),
      row({id:"b",policyId:"benefit-summary",formulaValue:0.5,quote:"Leg (loss of leg) 50%"})];
    assert.equal(amountAlternatives(scheme,namedApart,name).size,0,"rows naming different events are different benefits");
    // Generic names are never matched.
    const generic=[row({id:"o1",policyId:"summary",benefitName:"Others",formulaKind:"fixed",formulaValue:500,quote:"Others 10%"}),
      row({id:"o2",policyId:"benefit-summary",benefitName:"Others",quote:"Others 10%",formulaValue:0.1})];
    assert.equal(amountAlternatives(scheme,generic,name).size,0,"\"Others\" says nothing about which benefit it is");
    // Critic R31-2: one row printed by two documents, its traits given by different paths (keywords in one, the reader's
    // category in the other), is still one benefit.
    const twoPaths=[row({id:"k1",policyId:"summary",formulaKind:"fixed",formulaValue:2500,traits:["bodily_injury","accident"],quote:"Leg 50%"}),
      row({id:"k2",policyId:"benefit-summary",traits:["accident","bodily_injury","medical_expense"],quote:"Leg 50%"})];
    assert.equal(amountAlternatives(scheme,twoPaths,name).get("k1")?.options.length,2);
    // Control: the same fracture row printed by two documents still groups.
    const same=[row({id:"s1",policyId:"summary",formulaKind:"fixed",formulaValue:2500,quote:"Leg 50%"}),row({id:"s2",policyId:"benefit-summary",quote:"Leg 50%"})];
    assert.equal(amountAlternatives(scheme,same,name).get("s1")?.options.length,2);
  });
  test("A row's quote saying the insurer \"shall not be liable\" does not make it a liability row (Critic R29-1)",()=>{
    const page="Accidental Death 100% of Sum Insured. The Company shall not be liable for death caused by war.\nIf you are liable for accidental death, injury or damage to other people S$500,000";
    const death={planName:"Group Personal Accident",sourcePage:1,benefitName:"Accidental Death",eventType:"accidental_death" as const,paysKind:"percent_of_sum" as const,
      amount:1,quote:"Accidental Death 100% of Sum Insured. The Company shall not be liable for death caused by war."};
    assert.equal(rowSupported(death,page),true,"the person's own accidental death row is kept");
    const liability={planName:"Travel",sourcePage:1,benefitName:"If you are liable for accidental death, injury or damage to other people",eventType:"accidental_death" as const,
      paysKind:"lump_sum" as const,amount:500000,quote:"If you are liable for accidental death, injury or damage to other people S$500,000"};
    assert.equal(rowSupported(liability,page),false,"liability to other people is still not the person's accidental death");
    // Critic R31-1: a liability quote the model labelled "Accidental Death" is still liability to other people.
    const labelled={planName:"Travel",sourcePage:1,benefitName:"Accidental Death",eventType:"accidental_death" as const,paysKind:"lump_sum" as const,amount:500000,
      quote:"Legal liability for accidental death or bodily injury to third parties S$500,000"};
    const thirdPartyPage="Accidental Death\nLegal liability for accidental death or bodily injury to third parties S$500,000";
    assert.equal(rowSupported(labelled,thirdPartyPage),false,"the quote's third-party liability is not the person's own death cover");
    assert.equal(rowSupported({...death,quote:"Accidental Death 100% of Sum Insured. We are not liable to pay for death caused by war."},
      "Accidental Death 100% of Sum Insured. We are not liable to pay for death caused by war."),true,"\"not liable to pay\" is still an exclusion");
    // Critic R33-1: a third party named as the cause of the person's own accident is not liability cover.
    const assault="Accidental Death 100% of Sum Insured, including death from assault by a third party.";
    assert.equal(rowSupported({...death,quote:assault},assault),true,"assault by a third party is the person's own cover");
    const injuryTo="Accidental Death If you become legally liable for accidental death or bodily injury to other people S$500,000";
    assert.equal(rowSupported({...labelled,quote:injuryTo},injuryTo),false,"liable ... to other people is still liability cover");
  });
  test("Two people on one scheme catch a certificate whose columns drifted",()=>{
    // Straight out of the live data. Both members hold the same four sums under
    // one group policy number, but the certificate reading attaches them to
    // different plans for each of them. No amount of correct arithmetic can
    // catch that, because every figure is a real figure from a real page.
    const scheme=(owner:string,ownerId:string,rows:[string,number][]):PolicyContract=>({
      id:"c-"+ownerId,ownerId,ownerName:owner,name:"MINDEF & MHA Group Insurance",insurer:"Singlife",
      documents:[document({id:"cert-"+ownerId})],references:[],confirmed:true,effectiveDate:"2022-10-06",ownershipBasis:"evidence",
      coverages:rows.map(([product,amount],index)=>coverage({id:ownerId+"-"+index,productName:product,amount,
        policyNumber:"3037850",documentRole:"certificate"}))});
    const desmond=scheme("Desmond","p1",[["Group Term Life",1_000_000],["Living Care",350_000],
      ["Living Care Plus",300_000],["Group Personal Accident",600_000]]);
    const charmaine=scheme("Charmaine","p2",[["Group Term Life",300_000],["Living Care",600_000],
      ["Living Care Plus",350_000],["Group Personal Accident",1_000_000]]);
    const warnings=transposedScheduleWarnings([desmond,charmaine]);
    assert.equal(warnings.length,1);
    assert.equal(warnings[0].policyNumber,"3037850");
    assert.match(warnings[0].detail,/lists the same amounts for Desmond and Charmaine/);
    assert.match(warnings[0].detail,/only the certificate can say which/);
    // Agreeing schedules say nothing.
    const agreeing=scheme("Charmaine","p2",[["Group Term Life",1_000_000],["Living Care",350_000],
      ["Living Care Plus",300_000],["Group Personal Accident",600_000]]);
    assert.deepEqual(transposedScheduleWarnings([desmond,agreeing]),[]);
    // Genuinely different cover is not a drifted column, so it is left alone.
    const different=scheme("Charmaine","p2",[["Group Term Life",250_000],["Living Care",100_000],
      ["Living Care Plus",50_000],["Group Personal Accident",75_000]]);
    assert.deepEqual(transposedScheduleWarnings([desmond,different]),[]);
    // One person alone cannot disagree with anyone.
    assert.deepEqual(transposedScheduleWarnings([desmond]),[]);
  });
  test("A line from a certificate's cover table is not a benefit",()=>{
    // Straight out of the live benefit table: a certificate prints one row per
    // person per plan, the table parser read those rows like any other table,
    // and a row NAMED after a person and an identity number was then matched
    // to a death claim by the word "accident" in it, and paid.
    assert.equal(looksLikeCoverageLine("S****195A Ong Pei Lin Charmaine GROUP PERSONAL ACCIDENT(POLICY NO. 3037850)"),true);
    assert.equal(looksLikeCoverageLine("S****048I Tan Yi Chuen, Desmond"),true);
    assert.equal(looksLikeCoverageLine("GROUP LIVING CARE (POLICY NO. 3037850)"),true);
    assert.equal(looksLikeCoverageLine("S1234567A"),true);
    assert.equal(looksLikeCoverageLine("   "),true);
    // A rule about what a plan pays names no person and carries no identity
    // number, and must survive untouched.
    assert.equal(looksLikeCoverageLine("Death due to Accident"),false);
    assert.equal(looksLikeCoverageLine("Daily Hospital Cash Benefit"),false);
    assert.equal(looksLikeCoverageLine("Accidental Hospital Recuperation Benefit"),false);
    assert.equal(looksLikeCoverageLine("22. Loss of speech"),false);
    assert.equal(looksLikeCoverageLine("Total and Permanent Disablement due to Accident"),false);
    assert.equal(looksLikeCoverageLine("Surgical procedure (Table 6B)"),false);
  });
  test("An event before the cover on file is flagged, never silently denied",()=>{
    // A group certificate prints the current period's effective date, not the
    // day the member joined the scheme. Treating it as the start of cover would
    // deny claims that are perfectly good, so the person is told what the
    // document says and asked for the date that actually settles it.
    const early=eventPredatesCover(contract,{deathDate:fact("2021-03-04")});
    assert.match(String(early),/cover on file starts on 2022-01-01/);
    assert.match(String(early),/renewed continuously from an earlier date/);
    assert.equal(eventPredatesCover(contract,{deathDate:fact("2023-03-04")}),null);
    assert.equal(eventPredatesCover(contract,{}),null,"no date reported says nothing either way");
    assert.equal(eventPredatesCover({...contract,effectiveDate:null},{deathDate:fact("2021-03-04")}),null);
  });
  test("Confidence is a claim about the evidence, not about whether a number exists",()=>{
    const card=(override:Partial<ClaimItem>={}):ClaimItem=>({title:"A · Death Benefit",status:"likely_applicable",
      amountText:"S$1,000,000",estimateBasis:"confirmed",calculatedAmount:1_000_000,currency:"SGD",
      calculationKind:"sum_insured",aggregation:"additive",reason:"",conditions:[],...override});
    assert.equal(claimConfidence([card()]),"strong_match");
    // A figure printed in a booklet for everybody is not the person's schedule.
    assert.equal(claimConfidence([card(),card({title:"A · PA",estimateBasis:"estimated"})]),"partial_match");
    // Nor is a figure with a fact still outstanding behind it.
    assert.equal(claimConfidence([card({conditions:["Still needed: the number of nights in hospital"]})]),"partial_match");
    // A benefit paid instead of another does not weaken the answer.
    assert.equal(claimConfidence([card(),card({title:"A · Dup",estimateBasis:"estimated",supersededBy:"A · Death Benefit",calculatedAmount:undefined})]),"strong_match");
    assert.equal(claimConfidence([]),"insufficient_evidence");
    assert.equal(claimConfidence([card({calculatedAmount:undefined,amountText:null,status:"needs_document"})]),"partial_match");
  });
  test("A benefit read live out of a booklet gets the same gate as one read at upload",()=>{
    const text="Group Living Care pays 100% of the Sum Insured on diagnosis of a Critical Illness. Cover ends on death.";
    const livingCare=benefit(text);
    livingCare.title="Group Living Care";
    const onDeath=assessmentFromBenefit({benefit:livingCare,contract,sources:[source(text)],
      facts:{death:fact(true)},now,events:["death"]});
    assert.equal(onDeath.item.status,"not_applicable");
    assert.equal(onDeath.item.amountText,null,"no figure is put on a benefit written for a different event");
    assert.match(onDeath.item.reason,/pays the person who was diagnosed, while they are alive/);
    // And the same benefit still answers the event it IS written for.
    const onDiagnosis=assessmentFromBenefit({benefit:livingCare,contract,sources:[source(text)],
      facts:{diagnosis:fact("stage 2 breast cancer")},now,events:["critical_illness"]});
    assert.notEqual(onDiagnosis.item.status,"not_applicable");
    assert.equal(onDiagnosis.item.payingEvent,"critical_illness");
    // Every figure from this path is tied to a cover, so two readings of the
    // same cover can be recognised as one.
    assert.ok(onDiagnosis.item.coverKey?.startsWith("policy:P100"));
  });
  test("A critical-illness benefit is defined by its schedule, not by how serious the illness is",()=>{
    // The answer that started this: dengue offered S$650,000 of critical
    // illness cover. Dengue is severe, and severity is not the test.
    assert.deepEqual(definedConditionsFor("dengue fever"),[]);
    assert.deepEqual(definedConditionsFor("severe dengue with warning signs"),[]);
    assert.deepEqual(definedConditionsFor("food poisoning"),[]);
    assert.deepEqual(definedConditionsFor("broken wrist"),[]);
    // The listed ones are recognised from the words a person actually uses.
    assert.ok(definedConditionsFor("stage 2 breast cancer").includes("Major Cancer"));
    assert.ok(definedConditionsFor("he had a heart attack").includes("Heart Attack of Specified Severity"));
    assert.ok(definedConditionsFor("suffered a stroke").includes("Stroke with Permanent Neurological Deficit"));
    assert.ok(definedConditionsFor("diagnosed with Parkinson's").includes("Idiopathic Parkinson's Disease"));
    // No diagnosis stated says nothing either way.
    assert.deepEqual(definedConditionsFor("   "),[]);
    // Which benefits the check applies to: the ones that pay on a named
    // condition, including plans whose name gives nothing away.
    assert.equal(paysOnDefinedCondition("GROUP LIVING CARE 100% of Sum Insured on diagnosis of a Critical Illness"),true);
    assert.equal(paysOnDefinedCondition("Early Critical Illness Benefit"),true);
    assert.equal(paysOnDefinedCondition("Major Cancer Benefit"),true);
    assert.equal(paysOnDefinedCondition("Daily Hospital Cash Benefit S$100 per day"),false);
    assert.equal(paysOnDefinedCondition("Accidental Hospital Recuperation Benefit"),false);
  });
  test("A benefit's trigger is read from its own name, not from a passing mention in the clause",()=>{
    // The S$3,600,000 death answer: a critical-illness product was offered for
    // a death because its clause mentions death in passing. It does not pay on
    // one.
    const livingCare=benefitTriggerEvents("Group Living Care",
      "We pay 100% of the Sum Insured on diagnosis of a Critical Illness. This benefit terminates on the death of the insured member.");
    assert.ok(livingCare.includes("critical_illness"));
    assert.equal(livingCare.includes("death"),false,"a clause that mentions death is not a death benefit");
    const accidentalDeath=benefitTriggerEvents("Death due to Accident","We pay 100% of the Sum Insured.");
    assert.ok(accidentalDeath.includes("death"));
    const cash=benefitTriggerEvents("Daily Hospital Cash Benefit","S$100 for each day of confinement.");
    assert.deepEqual(cash,["hospitalisation"]);
    // A clause-only death benefit is still a death benefit when its name says
    // nothing at all.
    assert.ok(benefitTriggerEvents("Sum Assured","The Sum Assured is payable on death.").includes("death"));
  });
  test("What happened is read in the contract's vocabulary, and only a named diagnosis closes a door",()=>{
    assert.ok(reportedClaimEvents({death:fact(true)},["death"]).includes("death"));
    // No diagnosis named: the critical-illness benefits stay in play, because
    // "what if I am diagnosed with cancer" must still reach them.
    assert.ok(reportedClaimEvents({},["illness","diagnosis"],[]).includes("critical_illness"));
    assert.ok(reportedClaimEvents({},["illness","diagnosis"],["stage 2 breast cancer"]).includes("critical_illness"));
    // Named, and not a condition those benefits are defined to pay for.
    assert.equal(reportedClaimEvents({},["illness","diagnosis"],["dengue fever"]).includes("critical_illness"),false);
    // A death is not a diagnosis, which is why the earlier diagnosis-only
    // check never fired on the death that returned S$3,600,000.
    assert.equal(reportedClaimEvents({death:fact(true)},["death"]).includes("critical_illness"),false);
  });
  test("A critical-illness product is not offered for a death, and a death benefit is not offered for dengue",()=>{
    const entry=(name:string,quote:string):CatalogBenefit=>({id:name,policyId:"wording",productName:"Group Plan",benefitName:name,
      traits:benefitTraits(name,quote),formulaKind:"none",formulaValue:null,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,
      sourcePage:1,quote,conditions:[],requirements:[],needsReview:false});
    const catalog=[
      entry("Group Living Care","100% of the Sum Insured on diagnosis of a Critical Illness. Cover ends on death."),
      entry("Group Term Life Death Benefit","On death we pay the full Sum Insured."),
      entry("Death due to Accident","We pay 100% of the Sum Insured where death results from an accident."),
      entry("Daily Hospital Cash","S$100 for each day of hospital confinement."),
    ];
    const deathFacts:SubjectFacts={death:fact(true),accidentalDeath:fact(true)};
    const deathTraits=eventTraits(deathFacts);
    const deathEvents=reportedClaimEvents(deathFacts,deathTraits);
    const onDeath=matchBenefits(catalog,deathTraits,deathEvents).map(m=>m.benefit.benefitName);
    assert.equal(onDeath.includes("Group Living Care"),false,"a critical-illness product does not pay on a death");
    assert.ok(onDeath.includes("Group Term Life Death Benefit"));
    assert.ok(onDeath.includes("Death due to Accident"));
    // And the reason is said out loud rather than the row silently vanishing.
    const reasons=ruledOutBenefits(catalog,deathTraits,deathEvents).map(r=>r.benefit.benefitName+": "+r.because);
    assert.match(reasons.join(" | "),/Group Living Care: pays the person who was diagnosed, while they are alive/);
    // The other direction: the dengue answer.
    const illFacts:SubjectFacts={diagnosis:fact("dengue fever"),hospitalised:fact(true),hospitalNights:fact(3)};
    const illTraits=eventTraits(illFacts);
    const illEvents=reportedClaimEvents(illFacts,illTraits,["dengue fever"]);
    const onDengue=matchBenefits(catalog,illTraits,illEvents).map(m=>m.benefit.benefitName);
    assert.equal(onDengue.includes("Group Living Care"),false,"dengue is not a defined critical illness");
    assert.equal(onDengue.includes("Group Term Life Death Benefit"),false,"nobody has died");
    assert.ok(onDengue.includes("Daily Hospital Cash"),"but the admission still pays");
  });
  test("Nothing is ruled out while the event is still unknown",()=>{
    assert.equal(ruledOutByEvent(["critical_illness"],[]),null);
    assert.equal(ruledOutByEvent([],["death"]),null);
    // A hospital or expense benefit is never ruled out by this gate.
    assert.equal(ruledOutByEvent(["hospitalisation"],["death"]),null);
    assert.equal(ruledOutByEvent(["medical_expense"],["death"]),null);
  });
  test("One cover pays its sum once, and the figure from the person's own schedule is the one kept",()=>{
    // The other half of S$3,600,000: the same group personal accident cover
    // counted twice, once from the booklet and once from the certificate.
    const item=(title:string,amount:number,basis:"confirmed"|"estimated",cover:string,
      kind:"sum_insured"|"fixed"="sum_insured"):ClaimItem=>({
      title,status:"likely_applicable",amountText:"S$"+amount.toLocaleString("en-SG"),amountLabel:"Calculated benefit (internal)",
      estimateBasis:basis,calculatedAmount:amount,currency:"SGD",calculationKind:kind,aggregation:"additive",
      calculationId:title,coverKey:cover,payingEvent:"death",reason:"",conditions:[]});
    const items=[
      item("Person A · Death due to Accident",1_000_000,"estimated","policy:GPA1"),
      item("Person A · Group Personal Accident",600_000,"confirmed","policy:GPA1"),
      item("Person A · Group Term Life Death Benefit",1_000_000,"confirmed","policy:GTL1"),
    ];
    const {notes}=resolveCoverOverlaps(items);
    assert.equal(items[1].calculatedAmount,600_000,"the certificate figure is the one that counts");
    assert.equal(items[0].calculatedAmount,undefined,"the booklet figure is no longer added");
    assert.equal(items[0].supersededBy,"Person A · Group Personal Accident");
    assert.match(items[0].conditions.join(" "),/Paid instead of/);
    assert.equal(items[0].amountText,"S$1,000,000","the figure stays visible so it can be checked");
    assert.equal(notes.length,1);
    // An advance payment is the death sum arriving early, not a second one.
    const advance=[
      item("Person A · Death Benefit",1_000_000,"confirmed","policy:GTL2"),
      item("Person A · Advance Payment Benefit",1_000_000,"confirmed","policy:GTL2"),
    ];
    resolveCoverOverlaps(advance);
    assert.equal(advance[1].supersededBy,"Person A · Death Benefit","the advance gives way to the benefit it advances");
    assert.equal(advance[0].calculatedAmount,1_000_000);
    assert.deepEqual(aggregatePotentialPayouts(advance),[{currency:"SGD",amount:1_000_000,amountText:"S$1,000,000",itemCount:1}]);
    // Alone, it still pays: an advance is real money.
    const alone=[item("Person A · Advance Payment Benefit",1_000_000,"confirmed","policy:GTL3")];
    resolveCoverOverlaps(alone);
    assert.equal(alone[0].supersededBy,undefined);
    assert.deepEqual(aggregatePotentialPayouts(alone),[{currency:"SGD",amount:1_000_000,amountText:"S$1,000,000",itemCount:1}]);
    // Separate covers still stack, which is the whole point of holding both.
    assert.deepEqual(aggregatePotentialPayouts(items),[{currency:"SGD",amount:1_600_000,amountText:"S$1,600,000",itemCount:2}]);
    // And the total is broken into the plans it came out of, so the person can
    // hold it against their own certificate.
    items[1].coverLabel="Group Personal Accident";items[2].coverLabel="Group Term Life";
    assert.equal(describeCoverSplit(items),
      "S$1,000,000 from your Group Term Life cover and S$600,000 from your Group Personal Accident cover");
    assert.equal(describeCoverSplit([items[2]]),null,"one cover needs no breakdown");
    // But a smaller fixed grant alongside a sum assured is a second benefit
    // that really is paid as well. Collapsing it would fix the double count by
    // inventing an undercount.
    const withGrant=[
      item("Person A · Death Benefit",1_000_000,"confirmed","policy:GTL1"),
      item("Person A · Funeral Expenses",5_000,"confirmed","policy:GTL1","fixed"),
    ];
    resolveCoverOverlaps(withGrant);
    assert.equal(withGrant[1].supersededBy,undefined,"a funeral grant is not an alternative to the death sum");
    assert.deepEqual(aggregatePotentialPayouts(withGrant),[{currency:"SGD",amount:1_005_000,amountText:"S$1,005,000",itemCount:2}]);
  });
  test("A benefit figure is tied to one cover and one triggering event",()=>{
    const death:CatalogBenefit={id:"d1",policyId:"wording",productName:"Group Term Life",benefitName:"Death Benefit",
      traits:["death"],formulaKind:"sum_insured",formulaValue:1,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,
      sourcePage:2,quote:"On death we pay 100% of the Sum Insured.",conditions:[],requirements:[],needsReview:false};
    const assessed=assessCatalogBenefit({benefit:death,coverage:coverage({amount:600_000,documentRole:"certificate"}),
      ownerName:"Person A",facts:{death:fact(true)},contractId:"contract",insurer:"Example Insurer",events:["death"]});
    assert.equal(assessed.item.payingEvent,"death");
    assert.equal(assessed.item.coverKey,"policy:P100|flexible plan",
      "identity is the cover the money comes from, not the document the rule was read from");
    assert.equal(assessed.item.amountText,"S$600,000");
    // Two rows describing the same cover share the key; a different policy does not.
    assert.equal(coverKey({policyNumber:"P-100",productName:"group personal accident",contractId:"a"}),
      coverKey({policyNumber:"p100",productName:"Group Personal Accident",contractId:"b"}));
    assert.notEqual(coverKey({policyNumber:"P-100",productName:"group personal accident",contractId:"a"}),
      coverKey({policyNumber:"P-200",productName:"group personal accident",contractId:"a"}));
    // One master group policy number, several covers that genuinely stack.
    assert.notEqual(coverKey({policyNumber:"3037850",productName:"group term life",contractId:"a"}),
      coverKey({policyNumber:"3037850",productName:"group personal accident",contractId:"a"}));
  });
console.log("DearPolicy contextual system regressions passed ("+cases+" checks, including 90- and 900-policy inventories).");
}
