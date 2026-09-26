import { readFileSync } from "node:fs";
import path from "node:path";
import { assessContractFromCatalog,eventTraits,repairStoredRules,type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { reportedClaimEvents } from "@/lib/insurance/claim-events";
import { resolveCoverOverlaps,applyPolicyAggregateCaps } from "@/lib/insurance/cover-composition";
import { aggregatePotentialPayouts } from "@/lib/chat/policy-analysis";
import { applyCoverConditions,type CoverCondition } from "@/lib/insurance/cover-conditions";
import type { InventoryDocument,PolicyContract } from "@/lib/policies/inventory";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimItem } from "@/types";
import type { ScenarioTrait,SubjectFacts } from "@/lib/chat/types";

/** One real household, replayed through the real answer path.
 *
 * Everything else in this repository tests a part, with data written to test
 * that part. This is the product: a real Singapore group scheme, exactly as
 * DearPolicy stored it after reading the documents -- 125 rules across four
 * covers and three documents, the same sums insured, the same page numbers,
 * the same quotes -- put through the same code a question goes through, and
 * printed.
 *
 * It exists because nobody, including the person who built it, could say
 * whether the system was right. Passing tests written by whoever wrote the
 * code is not an answer to that. Printed answers for a household somebody
 * actually holds is.
 *
 * Names and the policy number are replaced. Nothing else is.
 */
const here=path.resolve("scripts/fixtures");
const spec=JSON.parse(readFileSync(path.join(here,"real-household.json"),"utf8"));
const rules=JSON.parse(readFileSync(path.join(here,"real-household-rules.json"),"utf8")) as
  [string,string,string[],string[],string,number|null,number,string,boolean,boolean][];

const MEMBER="member-1",CONTRACT="contract-1";
const DOCUMENTS:Record<string,string>={certificate:"cert",summary:"summary",product:"product"};

const document=(id:string,role:string,authority:number,personal:boolean):InventoryDocument=>({
  id,insurer:spec.insurer,product_name:spec.scheme,policy_number:spec.policyNumber,
  group_policy_number:spec.groupPolicyNumber,policy_type:"Group Insurance",document_role:role,
  personal_coverage_confirmed:personal,document_authority:authority,needs_review:false,
  processing_status:"ready",original_filename:id+".pdf",updated_at:"2026-09-19",
  effective_date:role==="certificate"&&personal?spec.effectiveDate:null,renewal_or_expiry_date:null,
  member_ids:[MEMBER],products:spec.coverages.map((c:{productName:string})=>c.productName),
  header:"",page_total:20,chunk_total:40} as InventoryDocument);

const coverages:OwnedCoverage[]=spec.coverages.map((cover:{category:string;amount:number;productName:string},index:number)=>({
  id:"cov-"+index,policyId:DOCUMENTS.certificate,familyMemberId:MEMBER,category:cover.category,
  amount:cover.amount,currency:"SGD",productName:cover.productName,sourcePage:1,
  evidenceText:"Certificate of insurance",insurer:spec.insurer,policyName:spec.scheme,
  policyNumber:spec.policyNumber,groupPolicyNumber:spec.groupPolicyNumber,documentRole:"certificate",
  effectiveDate:spec.effectiveDate,renewalOrExpiryDate:null, currencyVerified: true}));

const contract:PolicyContract={
  id:CONTRACT,ownerId:MEMBER,ownerName:spec.members[0].name,name:spec.scheme,insurer:spec.insurer,
  documents:[document(DOCUMENTS.certificate,"certificate",95,true)],
  references:[document(DOCUMENTS.summary,"benefit_summary",30,false),
    document(DOCUMENTS.product,"product_summary",40,false)],
  coverages,confirmed:true,effectiveDate:spec.effectiveDate,ownershipBasis:"evidence"};

const catalog:CatalogBenefit[]=repairStoredRules(rules.map(([doc,name,traits,requires,kind,value,page,quote,review,inferred],index)=>({
  id:"rule-"+index,policyId:DOCUMENTS[doc]??doc,productName:spec.scheme,benefitName:name,
  traits:traits as ScenarioTrait[],requires:requires as ScenarioTrait[],
  formulaKind:kind as CatalogBenefit["formulaKind"],formulaValue:value,
  currency:kind==="none"?null:"SGD",
  factKey:name.includes("Ambulance")?"ambulanceBill":kind==="daily"?"hospitalNights":name.includes("Home Rehabilitation")?"outOfPocket":null,
  offsetDays:kind==="daily"?0:null,maximumDays:null,
  sourcePage:page,quote,conditions:[],requirements:[],needsReview:review,
  basisInferred:inferred,needsConfirmation:inferred,reviewedAt:null} as CatalogBenefit)));

/** The conditions the benefit summary's prose states, as the conditions pass
 * would store them. Kept here so the replay shows what the household is
 * actually told, not what it would be told with half the contract missing. */
const condition=(over:Partial<CoverCondition>&{kind:CoverCondition["kind"]}):CoverCondition=>({
  productName:null,cause:null,appliesToEvents:[],conditionNames:[],days:null,amount:null,
  amountBasis:null,scope:null,carveOut:null,sourcePage:null,quote:"",...over});
const conditions:CoverCondition[]=[
  condition({kind:"time_bar_from_inception",productName:"GROUP TERM LIFE",cause:"suicide",days:365,sourcePage:5,
    quote:"no benefit is payable if the Insured Member dies by suicide within 12 months of the commencement date"}),
  condition({kind:"exclusion",productName:"GROUP PERSONAL ACCIDENT",cause:"suicide",sourcePage:10,
    quote:"this policy does not cover suicide or any attempt at suicide"}),
  condition({kind:"exclusion",productName:"GROUP PERSONAL ACCIDENT",cause:"racing",sourcePage:10,
    quote:"taking part in racing on wheels"}),
  condition({kind:"waiting_period",productName:"GROUP LIVING CARE",days:90,sourcePage:19,
    carveOut:"unless caused solely and directly by an Accident",
    quote:"a waiting period of 90 days from the commencement date applies"}),
  condition({kind:"survival_period",productName:"GROUP LIVING CARE",days:30,sourcePage:19,
    quote:"the Insured Member must survive 30 days from the date of diagnosis"}),
  condition({kind:"aggregate_cap",productName:"GROUP LIVING CARE",amount:350_000,sourcePage:19,
    quote:"we will not pay more than S$350,000 in the aggregate"}),
  condition({kind:"waiting_period",productName:"GROUP LIVING CARE PLUS",days:60,sourcePage:22,
    quote:"a waiting period of 60 days from the commencement date applies"}),
  condition({kind:"notice_period",days:120,sourcePage:30,
    quote:"written notice of claim must be given within 120 days"}),
];

const fact=(value:string|number|boolean|null)=>({value,state:"known" as const,quote:String(value),
  recordedAt:"2026-09-01T00:00:00.000Z",source:"user" as const});

type Question={ask:string;facts:SubjectFacts;traits?:ScenarioTrait[]};
const questions:Question[]=[
  {ask:"My husband died in a car accident last month.",
   facts:{death:fact(true),accidentalDeath:fact(true),eventType:fact("accident"),
     deathDate:fact("2026-08-14"),eventDate:fact("2026-08-14")} as SubjectFacts},
  {ask:"My husband died of a heart attack at home.",
   facts:{death:fact(true),eventType:fact("illness"),causeOfDeath:fact("heart attack"),
     deathDate:fact("2026-08-14")} as SubjectFacts},
  {ask:"I was diagnosed with stage 3 colon cancer in March.",
   facts:{diagnosis:fact("stage 3 colon cancer"),eventType:fact("diagnosis"),
     diagnosisDate:fact("2026-03-02")} as SubjectFacts},
  {ask:"I joined the scheme six weeks ago and have just been diagnosed with cancer.",
   facts:{diagnosis:fact("major cancer"),eventType:fact("diagnosis"),
     diagnosisDate:fact("2026-08-01")} as SubjectFacts},
  {ask:"I broke my wrist falling off my bike, five nights in hospital, ambulance was $220.",
   facts:{eventType:fact("accident"),injured:fact(true),fractureBodyPart:fact("wrist"),
     accidentDate:fact("2026-09-01"),hospitalised:fact(true),hospitalNights:fact(5),
     ambulanceUsed:fact(true),ambulanceBill:fact(220)} as SubjectFacts},
  {ask:"I have dengue and was warded for four nights.",
   facts:{diagnosis:fact("dengue fever"),eventType:fact("diagnosis"),hospitalised:fact(true),
     hospitalNights:fact(4)} as SubjectFacts},
  {ask:"I lost my left thumb in a workshop accident.",
   facts:{eventType:fact("accident"),injured:fact(true),
     injuries:fact("amputation of left thumb"),accidentDate:fact("2026-09-01")} as SubjectFacts},
  {ask:"What would my family get if I died?",facts:{} as SubjectFacts,traits:["death"]},
  {ask:"What could I claim if I were diagnosed with cancer?",facts:{} as SubjectFacts,traits:["illness","diagnosis"]},
];

function money(value:number){return "S$"+value.toLocaleString("en-SG");}

export function runRealHouseholdReplay(options?:{quiet?:boolean}){
  const log=(line=""):void=>{if(!options?.quiet)console.log(line);};
  log("");
  log("=".repeat(78));
  log("REPLAY — "+spec.scheme+"  ·  "+catalog.length+" stored rules  ·  "
    +spec.coverages.map((c:{productName:string;amount:number})=>c.productName+" "+money(c.amount)).join("  ·  "));
  log("=".repeat(78));
  const results:{ask:string;total:string|null;paid:string[];blocked:string[];said:string[]}[]=[];
  for(const question of questions){
    const traits=eventTraits(question.facts,question.traits??[]);
    const diagnosis=question.facts.diagnosis?.value;
    const events=reportedClaimEvents(question.facts,traits,typeof diagnosis==="string"?[diagnosis]:[]);
    const assessed=assessContractFromCatalog({contract,catalog,facts:question.facts,traits,events});
    const items:ClaimItem[]=assessed.items;
    const applied=applyCoverConditions({items,conditions,facts:question.facts,
      coverStart:spec.effectiveDate,today:"2026-09-19"});
    resolveCoverOverlaps(items);
    applyPolicyAggregateCaps(items);
    const totals=aggregatePotentialPayouts(items);
    const named=(item:ClaimItem)=>item.title.split(" · ").slice(1).join(" · ");
    const paid=items.filter(item=>typeof item.calculatedAmount==="number"&&item.calculatedAmount>0
      &&!item.supersededBy&&item.estimateBasis!=="indicative")
      .sort((a,b)=>(b.calculatedAmount??0)-(a.calculatedAmount??0));
    const shownNotCounted=items.filter(item=>!paid.includes(item)&&item.amountText);
    const total=totals.map(entry=>entry.amountText).join(" and ")||null;
    log("");
    log("Q: "+question.ask);
    log("   TOTAL: "+(total??"nothing"));
    for(const item of paid)log("   pays   "+(item.amountText??"").padStart(12)+"  "+named(item));
    for(const item of shownNotCounted.slice(0,6))
      log("   shown  "+(item.amountText??"").padStart(12)+"  "+named(item)
        +(item.supersededBy?"  (instead: "+item.supersededBy.split(" · ").slice(1).join(" · ")+")"
          :item.estimateBasis==="indicative"?"  (not counted: needs confirming)":"  (not counted)"));
    if(shownNotCounted.length>6)log("   shown  "+String(shownNotCounted.length-6).padStart(12)+"  more rows, not counted");
    for(const entry of applied.blocked)log("   NOT PAYABLE  "+named({title:entry.title} as ClaimItem)+" — "+entry.reason);
    for(const line of applied.qualifiers.slice(0,3))log("   note   "+line);
    results.push({ask:question.ask,total,paid:paid.map(item=>named(item)+" "+item.amountText),
      blocked:applied.blocked.map(entry=>entry.title),said:applied.qualifiers});
  }
  log("");
  log("=".repeat(78));
  // The answers this household's own documents settle beyond argument. The
  // rest of the replay is printed rather than asserted, because nobody has
  // yet said what the right answer is -- and inventing one here would be the
  // same mistake as grading your own homework.
  const answer=(fragment:string)=>results.find(entry=>entry.ask.includes(fragment))!;
  const death=answer("heart attack");
  if(death.total!=="S$1,000,000")
    throw new Error("A death from illness pays the group term life sum insured and nothing else. Got: "+death.total);
  const dengue=answer("dengue");
  if(dengue.total!=="S$120.00")
    throw new Error("Four nights at S$30 a day is S$120. Got: "+dengue.total);
  const wrist=answer("broke my wrist");
  if(!wrist.paid.some(line=>/Wrist/.test(line)&&/S\$1,000/.test(line)))
    throw new Error("A fractured wrist is 20% of the S$5,000 fracture limit, not of the S$600,000 sum insured. Got: "
      +wrist.paid.join(" | "));
  if(wrist.paid.some(line=>/S\$\d{3},\d{3}/.test(line)))
    throw new Error("Nothing in a fracture claim pays six figures. Got: "+wrist.paid.join(" | "));
  log("Asserted: death from illness, four nights of hospital cash, and a fractured wrist.");
  log("");
  return results;
}
