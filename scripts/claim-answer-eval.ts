import assert from "node:assert/strict";
import { assessContractFromCatalog,type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { eventTraits } from "@/lib/policies/benefit-catalog";
import { reportedClaimEvents } from "@/lib/insurance/claim-events";
import { resolveCoverOverlaps } from "@/lib/insurance/cover-composition";
import { aggregatePotentialPayouts } from "@/lib/chat/policy-analysis";
import type { InventoryDocument,PolicyContract } from "@/lib/policies/inventory";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { SubjectFacts } from "@/lib/chat/types";

/** What the whole answer comes to, for a household and an event.
 *
 * Every other suite checks a part. This one checks the thing the product
 * actually sells: given these policies and this event, which benefits respond,
 * which do not, and what is the number. It runs end to end through the real
 * code and calls no model at all, so it is fast, free and identical every run
 * -- which means a change can be judged by whether these numbers moved, rather
 * than by reading one answer on a screen and forming an impression.
 *
 * The household is the one that produced the wrong answers: a Singapore group
 * scheme where group term life, group personal accident and two critical
 * illness plans all sit under a single master policy number. Every case here
 * is an answer the system has actually given, with the figure it should have
 * given beside it. */

const PERSON="member-1",CONTRACT="contract-1",CERT="cert-1";
const now=new Date("2026-09-18T12:00:00Z");
const fact=(value:string|number|boolean|null)=>({value,state:"known" as const,quote:String(value),recordedAt:now.toISOString(),source:"user" as const});

const document=(override:Partial<InventoryDocument>={}):InventoryDocument=>({
  id:CERT,insurer:"Singlife",product_name:"MINDEF & MHA Group Insurance",policy_number:"3037850",group_policy_number:"G007500",
  policy_type:"group",document_role:"certificate",personal_coverage_confirmed:true,document_authority:95,
  needs_review:false,processing_status:"ready",original_filename:"certificate.pdf",updated_at:"2026-09-01",
  effective_date:"2022-10-06",renewal_or_expiry_date:null,member_ids:[PERSON],products:["Group Term Life","Group Personal Accident","Living Care","Living Care Plus"],
  header:"",page_total:4,chunk_total:8,...override});

const cover=(id:string,category:string,amount:number,productName:string):OwnedCoverage=>({
  id,policyId:CERT,familyMemberId:PERSON,category,amount,currency:"SGD",productName,sourcePage:1,
  evidenceText:"Certificate of insurance",insurer:"Singlife",policyName:"MINDEF & MHA Group Insurance",
  policyNumber:"3037850",groupPolicyNumber:"G007500",documentRole:"certificate",effectiveDate:"2022-10-06",renewalOrExpiryDate:null});

const contract:PolicyContract={
  id:CONTRACT,ownerId:PERSON,ownerName:"Charmaine",name:"MINDEF & MHA Group Insurance",insurer:"Singlife",
  documents:[document()],references:[document({id:"wording",document_role:"policy_wording",personal_coverage_confirmed:false})],
  coverages:[
    cover("c-gtl","Death",1_000_000,"Group Term Life"),
    cover("c-gpa","Personal Accident",600_000,"Group Personal Accident"),
    cover("c-lc","Critical Illness",350_000,"Living Care"),
    cover("c-lcp","Early Critical Illness",300_000,"Living Care Plus"),
  ],
  confirmed:true,effectiveDate:"2022-10-06",ownershipBasis:"evidence"};

type Rule=Pick<CatalogBenefit,"formulaKind"|"formulaValue"|"currency"|"factKey"|"offsetDays"|"maximumDays">;
const rule=(override:Partial<Rule>={}):Rule=>({formulaKind:"none",formulaValue:null,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,...override});
const benefit=(benefitName:string,productName:string,quote:string,traits:CatalogBenefit["traits"],formula:Partial<Rule>={},
  requires?:CatalogBenefit["requires"]):CatalogBenefit=>({
  id:benefitName.toLowerCase().replace(/[^a-z0-9]+/g,"-"),policyId:CERT,productName,benefitName,traits,requires,
  ...rule(formula),sourcePage:2,quote,conditions:[],requirements:[],needsReview:false});

const catalog:CatalogBenefit[]=[
  benefit("Death Benefit","Group Term Life","On the death of the insured member we pay 100% of the Sum Insured.",
    ["death"],{formulaKind:"sum_insured",formulaValue:1},["death"]),
  benefit("Total and Permanent Disability","Group Term Life",
    "We pay 100% of the Sum Insured on total and permanent disability.",["disability"],{formulaKind:"sum_insured",formulaValue:1}),
  benefit("Daily Hospital Cash","Group Term Life",
    "S$30 for each day of hospital confinement after the first 2 days, up to 30 days.",
    ["hospitalisation"],{formulaKind:"daily",formulaValue:30,factKey:"hospitalNights",offsetDays:2,maximumDays:30}),
  benefit("Death due to Accident","Group Personal Accident",
    "We pay 100% of the Sum Insured where death results from an accident.",["death","accident"],
    {formulaKind:"sum_insured",formulaValue:1},["death","accident"]),
  // The same cover described a second time, in the benefit table rather than
  // the certificate. This row is the other half of the S$3,600,000.
  benefit("Accidental Death Benefit","Group Personal Accident",
    "Accidental Death: 100% of the Sum Insured.",["death","accident"],
    {formulaKind:"sum_insured",formulaValue:1},["death","accident"]),
  benefit("Simple Fracture","Group Personal Accident",
    "Simple fracture of the wrist: S$1,250.",["bodily_injury","accident"],{formulaKind:"fixed",formulaValue:1_250},["accident"]),
  benefit("Ambulance Fee","Group Personal Accident","We reimburse the ambulance cost up to S$500 per incident.",
    ["medical_expense"],{formulaKind:"expense_cap",formulaValue:500,factKey:"ambulanceBill"}),
  benefit("Group Living Care","Living Care",
    "We pay 100% of the Sum Insured on the diagnosis of a Critical Illness as defined in the Schedule. Cover ends on the death of the member.",
    ["illness","diagnosis"],{formulaKind:"sum_insured",formulaValue:1}),
  benefit("Early Critical Illness Benefit","Living Care Plus",
    "We pay 50% of the Sum Insured on the diagnosis of an early stage Critical Illness.",
    ["illness","diagnosis"],{formulaKind:"sum_insured",formulaValue:0.5}),
];

type Case={
  question:string;
  facts:SubjectFacts;
  /** Benefit names that must be offered with a figure. */
  pays:Record<string,string>;
  /** Benefit names that must NOT be offered, whatever else happens. */
  never:string[];
  /** Rows that describe the same money: exactly one is counted, at this
   * amount, and the rest stay visible as alternatives. Which one is kept is
   * arbitrary and deliberately not asserted. */
  oneOf?:{names:string[];amount:string};
  total:string|null;
};

const cases:Case[]=[
  {
    question:"charmaine died in an accident in japan",
    facts:{death:fact(true),accidentalDeath:fact(true),eventType:fact("accident")},
    pays:{"Death Benefit":"S$1,000,000"},
    oneOf:{names:["Death due to Accident","Accidental Death Benefit"],amount:"S$600,000"},
    // The answer that started this was S$3,600,000: a critical-illness product
    // paying on a death, and the personal accident cover counted twice. The
    // fracture benefit is here too, because an accidental death is not an
    // accidental injury claim and offering S$1,250 for a broken wrist to a
    // bereaved family is its own kind of wrong.
    never:["Group Living Care","Early Critical Illness Benefit","Total and Permanent Disability","Daily Hospital Cash","Simple Fracture"],
    total:"S$1,600,000",
  },
  {
    question:"i have dengue and was warded for 4 nights",
    facts:{diagnosis:fact("dengue fever"),eventType:fact("diagnosis"),hospitalised:fact(true),hospitalNights:fact(4)},
    pays:{"Daily Hospital Cash":"S$60.00"},
    // Dengue is severe. Severity is not the test; the schedule of defined
    // conditions is, and dengue is not in it.
    never:["Group Living Care","Early Critical Illness Benefit","Death Benefit","Death due to Accident"],
    total:"S$60.00",
  },
  {
    question:"i was diagnosed with stage 3 colon cancer",
    facts:{diagnosis:fact("stage 3 colon cancer"),eventType:fact("diagnosis")},
    pays:{"Group Living Care":"S$350,000","Early Critical Illness Benefit":"S$150,000"},
    never:["Death Benefit","Death due to Accident","Total and Permanent Disability"],
    total:"S$500,000",
  },
  {
    question:"i broke my wrist falling off my bike and was warded for 5 nights, ambulance cost $220",
    facts:{eventType:fact("accident"),injured:fact(true),fractureBodyPart:fact("wrist"),
      hospitalised:fact(true),hospitalNights:fact(5),ambulanceUsed:fact(true),ambulanceBill:fact(220)},
    pays:{"Simple Fracture":"S$1,250","Daily Hospital Cash":"S$90.00","Ambulance Fee":"S$220.00"},
    never:["Death Benefit","Death due to Accident","Group Living Care","Early Critical Illness Benefit"],
    // The ambulance is a reimbursement of an actual bill, so it is shown on its
    // own card and never folded into the lump-sum total.
    total:"S$1,340",
  },
];

export function runClaimAnswerEval(){
  let checked=0;
  for(const testCase of cases){
    const traits=eventTraits(testCase.facts);
    const diagnosis=testCase.facts.diagnosis?.value;
    const events=reportedClaimEvents(testCase.facts,traits,typeof diagnosis==="string"?[diagnosis]:[]);
    const assessed=assessContractFromCatalog({contract,catalog,facts:testCase.facts,traits,events});
    const {items}=resolveCoverOverlaps(assessed.items);
    const totals=aggregatePotentialPayouts(items);
    const named=(item:{title:string})=>item.title.split(" · ").slice(1).join(" · ");
    const shown=new Map(items.map(item=>[named(item),item]));
    const fail=(why:string)=>{
      const lines=items.map(item=>"    "+named(item)+" -> "+(item.amountText??"no amount")+(item.supersededBy?" (instead of "+item.supersededBy+")":""));
      throw new Error("“"+testCase.question+"”: "+why+"\n  What DearPolicy would answer:\n"+lines.join("\n")
        +"\n    TOTAL "+(totals.map(t=>t.amountText).join(" and ")||"none"));
    };
    for(const [name,amount] of Object.entries(testCase.pays)){
      const item=shown.get(name);
      if(!item)fail("“"+name+"” should respond and was not offered at all");
      if(item!.supersededBy)fail("“"+name+"” should be paid, not replaced by “"+item!.supersededBy+"”");
      if(item!.amountText!==amount)fail("“"+name+"” should pay "+amount+", not "+(item!.amountText??"nothing"));
      checked++;
    }
    for(const name of testCase.never){
      if(shown.has(name))fail("“"+name+"” must not be offered for this event");
      checked++;
    }
    if(testCase.oneOf){
      const found=testCase.oneOf.names.map(name=>shown.get(name));
      if(found.some(item=>!item))fail("every row describing the same cover should still be shown: "+testCase.oneOf.names.join(", "));
      const counted=found.filter(item=>typeof item!.calculatedAmount==="number");
      if(counted.length!==1)fail(counted.length+" of "+found.length+" rows describing the same cover are being counted; exactly one should be");
      if(counted[0]!.amountText!==testCase.oneOf.amount)fail("the counted row should pay "+testCase.oneOf.amount+", not "+counted[0]!.amountText);
      for(const item of found)if(item!==counted[0]&&!item!.supersededBy)fail("“"+named(item!)+"” should say which benefit is paid instead of it");
      checked+=3;
    }
    const total=totals.map(entry=>entry.amountText).join(" and ")||null;
    if(total!==testCase.total)fail("the total should be "+(testCase.total??"nothing")+", not "+(total??"nothing"));
    checked++;
  }
  assert.ok(checked>0);
  console.log("DearPolicy claim-answer evaluation passed ("+cases.length+" household scenarios, "+checked+" expectations).");
}
