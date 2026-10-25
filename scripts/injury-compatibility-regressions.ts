import assert from "node:assert/strict";
import { assessContractFromCatalog,classifyInjuryLine,eventTraits,injuryCompatibility,injuryNotReported,matchBenefits,preferStatedRules,
  type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { reportedClaimEvents } from "@/lib/insurance/claim-events";
import type { InventoryDocument,PolicyContract } from "@/lib/policies/inventory";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { SubjectFacts } from "@/lib/chat/types";

/** "Josephine broke her arm" -> "An accident" surfaced "Loss of arm ...".
 * A schedule pays for the injury that happened: the row's KIND must agree with
 * a reported kind before a body part is looked at, and incompatible rows never
 * become candidates in the claim path. */
const fact=(value:string|number|boolean|null)=>({value,state:"known" as const,quote:String(value),
  recordedAt:"2026-09-28T00:00:00Z",source:"user" as const});
const PERSON="josephine",CERT="cert-1";
const row=(benefitName:string,quote="",extra:Partial<CatalogBenefit>={}):CatalogBenefit=>({
  id:benefitName.toLowerCase().replace(/[^a-z0-9]+/g,"-"),policyId:CERT,productName:"Group Personal Accident",benefitName,
  traits:["bodily_injury","accident"],formulaKind:"none",formulaValue:null,currency:"SGD",factKey:null,offsetDays:null,
  maximumDays:null,sourcePage:3,quote,conditions:[],requirements:[],needsReview:false,...extra});
const LOSS_OF_ARM=row("Loss of arm (at shoulder, between shoulder and elbow, at elbow, between elbow and wrist)",
  "100% of the Sum Insured.",{formulaKind:"sum_insured",formulaValue:1});
const MEDICAL=row("Accident medical reimbursement","We reimburse medical expenses for bodily injury, including fractures, up to S$2,000.",
  {traits:["medical_expense","accident"],formulaKind:"expense_cap",formulaValue:2000,factKey:"hospitalBill"});
const HOSPITAL_CASH=row("Daily Hospital Cash","S$30 for each day of hospital confinement after the first 2 days, up to 30 days.",
  {traits:["hospitalisation"],formulaKind:"daily",formulaValue:30,factKey:"hospitalNights",offsetDays:2,maximumDays:30});
const FRACTURE_OF_ARM=row("Fracture of arm","S$1,000 for a fracture of the arm.",{formulaKind:"fixed",formulaValue:1000});
const BURNS=row("Body - Equals to or greater than 10% but less than 15%","",{formulaKind:"sum_insured",formulaValue:0.5});

const armFracture:SubjectFacts={eventType:fact("accident"),injured:fact(true),injuryKind:fact("fracture"),
  fractureBodyPart:fact("arm"),injuryBodyPart:fact("arm"),injuries:fact("broke her arm")};
let cases=0;
const check=(name:string,body:()=>void)=>{body();cases++;void name;};

check("1. a broken arm never answers Loss of arm",()=>{
  const verdict=injuryCompatibility(LOSS_OF_ARM,armFracture);
  assert.equal(verdict.visible,false);assert.equal(verdict.lineKind,"permanent_loss");assert.ok(verdict.reason);
  // Even when only the text heuristics are available (no injuryKind fact).
  assert.equal(injuryCompatibility(LOSS_OF_ARM,{injured:fact(true),fractureBodyPart:fact("arm")}).visible,false);
  assert.equal(injuryNotReported(LOSS_OF_ARM,armFracture),LOSS_OF_ARM.benefitName,"second guard agrees");
});
check("2. a generic row name is classified from its wording",()=>{
  const item7=row("Schedule item 7","Permanent loss of use of one arm: 70% of the Sum Insured.",{formulaKind:"sum_insured",formulaValue:0.7});
  assert.equal(classifyInjuryLine(item7).kind,"permanent_loss");
  const verdict=injuryCompatibility(item7,armFracture);
  assert.equal(verdict.visible,false);assert.equal(verdict.lineKind,"permanent_loss");
});
check("3. genuine fracture coverage stays visible for an arm fracture",()=>{
  for(const name of ["Fracture of arm","Fractures (simple)","Simple fracture of upper limb","Simple Fracture"]){
    const verdict=injuryCompatibility(row(name),armFracture);
    assert.equal(verdict.visible,true,name);assert.equal(verdict.lineKind,"fracture",name);
  }
  // A more specific report inside a generic row: a left elbow is part of the arm.
  assert.equal(injuryCompatibility(row("Fracture of arm"),{injured:fact(true),injuryKind:fact("fracture"),
    fractureBodyPart:fact("left elbow")}).visible,true);
});
check("4. a wrist-only row does not answer an arm fracture (the report does not establish the wrist)",()=>{
  // Decision: conservative. "Arm" is broader than the wrist, so the wrist row
  // waits for a fact that says wrist. The reverse -- a wrist report against a
  // generic "upper limb" row -- is covered.
  assert.equal(injuryCompatibility(row("Simple fracture of wrist"),armFracture).visible,false);
  const wrist:SubjectFacts={injured:fact(true),fractureBodyPart:fact("wrist")};
  assert.equal(injuryCompatibility(row("Simple fracture of wrist"),wrist).visible,true);
  assert.equal(injuryCompatibility(row("Simple fracture of upper limb"),wrist).visible,true);
  assert.equal(injuryCompatibility(row("Fracture of arm"),wrist).visible,false,"a wrist is not established as the arm row");
  // Laterality still applies when kinds agree.
  assert.equal(injuryCompatibility(row("Fracture of right arm"),{...armFracture,injurySide:fact("left")}).visible,false);
  assert.equal(injuryCompatibility(row("Fracture of left arm"),{...armFracture,injurySide:fact("left")}).visible,true);
});
check("5. a stated permanent loss opens the loss-of-arm row",()=>{
  const lost:SubjectFacts={injured:fact(true),permanentImpairment:fact("lost use of her arm")};
  assert.equal(injuryCompatibility(LOSS_OF_ARM,lost).visible,true);
  const kind:SubjectFacts={injured:fact(true),injuryKind:fact("permanent_loss"),injuryBodyPart:fact("arm")};
  assert.equal(injuryCompatibility(LOSS_OF_ARM,kind).visible,true);
  // ...and the kind still has to meet the body part.
  assert.equal(injuryCompatibility(row("Loss of one leg"),kind).visible,false);
});
check("6. an injury of unknown kind opens no schedule line, but treatment benefits stay",()=>{
  const hurt:SubjectFacts={injured:fact(true),injuryBodyPart:fact("arm"),injuries:fact("hurt her arm")};
  assert.equal(injuryCompatibility(LOSS_OF_ARM,hurt).visible,false);
  assert.equal(injuryCompatibility(FRACTURE_OF_ARM,hurt).visible,false);
  assert.equal(injuryCompatibility(row("Arm"),hurt).visible,false,"an ambiguous body-part row is never visible");
  assert.equal(injuryCompatibility(row("Arm"),hurt).lineKind,"ambiguous_injury");
  const medical=injuryCompatibility(MEDICAL,hurt);
  assert.equal(medical.visible,true);assert.equal(medical.lineKind,null);
  // "injured arm" with nothing else, as the model sometimes records it.
  assert.equal(injuryCompatibility(LOSS_OF_ARM,{injured:fact(true),injuries:fact("injured arm")}).visible,false);
});
check("7. a burns band is hidden for a fracture",()=>{
  const verdict=injuryCompatibility(BURNS,armFracture);
  assert.equal(verdict.visible,false);assert.equal(verdict.lineKind,"burn");
  assert.equal(injuryCompatibility(BURNS,{injuries:fact("burns to 12% of the body")}).visible,true);
  assert.equal(injuryCompatibility(BURNS,{permanentImpairment:fact("assessed impairment of 22%")}).visible,true);
});
check("8. medical reimbursement and hospital cash answer a fracture whatever the bills",()=>{
  for(const benefit of [MEDICAL,HOSPITAL_CASH,row("Ambulance Fee","We reimburse ambulance costs up to S$500.",{traits:["medical_expense"]}),
    row("Accidental Death Benefit","100% of the Sum Insured on death from an accident, including dismemberment.",{traits:["death","accident"]})]){
    const verdict=injuryCompatibility(benefit,armFracture);
    assert.equal(verdict.visible,true,benefit.benefitName);assert.equal(verdict.lineKind,null,benefit.benefitName);
  }
  // Words that contain a body part are not a body part.
  assert.equal(classifyInjuryLine(row("Legal expenses")).kind,null);
  assert.equal(classifyInjuryLine(row("Loss of baggage")).kind,null);
  assert.equal(classifyInjuryLine(row("Loss of income")).kind,null);
  // No injury reported at all (a hypothetical): unchanged, still visible.
  assert.equal(injuryCompatibility(LOSS_OF_ARM,{}).visible,true);
  assert.equal(injuryCompatibility(LOSS_OF_ARM,{death:fact(true),eventType:fact("accident")}).visible,true);
});
check("9. matchBenefits screens with facts and is unchanged without them",()=>{
  const catalog=[LOSS_OF_ARM,FRACTURE_OF_ARM,MEDICAL,HOSPITAL_CASH];
  const traits=eventTraits(armFracture);
  const without=matchBenefits(catalog,traits).map(m=>m.benefit.benefitName);
  assert.ok(without.includes(LOSS_OF_ARM.benefitName),"backward compatible: no facts, no screening");
  const withFacts=matchBenefits(catalog,traits,[],armFracture).map(m=>m.benefit.benefitName);
  assert.equal(withFacts.includes(LOSS_OF_ARM.benefitName),false);
  assert.ok(withFacts.includes("Fracture of arm")&&withFacts.includes("Accident medical reimbursement")&&withFacts.includes("Daily Hospital Cash"));
});
check("10. the claim path returns Loss of arm only as internal audit data",()=>{
  const document:InventoryDocument={id:CERT,insurer:"Singlife",product_name:"Group Insurance",policy_number:"1",group_policy_number:"G1",
    policy_type:"group",document_role:"certificate",personal_coverage_confirmed:true,document_authority:95,needs_review:false,
    processing_status:"ready",original_filename:"certificate.pdf",updated_at:"2026-09-01",effective_date:"2022-10-06",
    renewal_or_expiry_date:null,member_ids:[PERSON],products:["Group Personal Accident"],header:"",page_total:4,chunk_total:8};
  const cover:OwnedCoverage={id:"c-gpa",policyId:CERT,familyMemberId:PERSON,category:"Personal Accident",amount:600_000,currency:"SGD",
    productName:"Group Personal Accident",sourcePage:1,evidenceText:"Certificate",insurer:"Singlife",policyName:"Group Insurance",
    policyNumber:"1",groupPolicyNumber:"G1",documentRole:"certificate",effectiveDate:"2022-10-06",renewalOrExpiryDate:null,currencyVerified:true};
  const contract:PolicyContract={id:"contract-1",ownerId:PERSON,ownerName:"Josephine",name:"Group Insurance",insurer:"Singlife",
    documents:[document],references:[],coverages:[cover],confirmed:true,effectiveDate:"2022-10-06",ownershipBasis:"evidence"};
  const catalog=[LOSS_OF_ARM,FRACTURE_OF_ARM,MEDICAL,HOSPITAL_CASH,BURNS];
  for(const facts of [armFracture,{eventType:fact("accident"),injured:fact(true),injuryBodyPart:fact("arm"),injuries:fact("injured arm")}] as SubjectFacts[]){
    const traits=eventTraits(facts);
    const assessed=assessContractFromCatalog({contract,catalog,facts,traits,events:reportedClaimEvents(facts,traits)});
    const lossTitle=(title:string)=>title.includes("Loss of arm");
    assert.equal(assessed.items.some(item=>lossTitle(item.title)),false,"never an item");
    assert.equal(assessed.matches.some(m=>m.benefit.id===LOSS_OF_ARM.id),false,"never a match");
    assert.equal(assessed.ruledOut.some(r=>r.benefit.id===LOSS_OF_ARM.id),false,"never in the user-visible ruledOut");
    assert.ok(assessed.incompatible.some(entry=>entry.benefit.id===LOSS_OF_ARM.id&&entry.reason.length>0),"kept for audit");
    assert.ok(assessed.items.some(item=>item.title.includes("Accident medical reimbursement")),"treatment benefit stays");
    assert.equal(assessed.items.some(item=>item.title.includes("Body - Equals")),false,"burn band never an item");
    const fractureShown=assessed.items.some(item=>item.title.includes("Fracture of arm"));
    assert.equal(fractureShown,facts===armFracture,"fracture row only once a fracture is established");
  }
});
check("11. two documents' statements of one fracture benefit: the printed figure wins and keeps its kind",()=>{
  // The benefit summary heads the row "(Other Fracture)" but infers its rate
  // from a heading; the product summary prints the figure but its title lost
  // the table heading. The printed one outranks, and must not then be hidden
  // as an unclassifiable schedule line.
  const inferred=row("Arm, Elbow, Wrist or Ribs (Other Fracture)","Arm, Elbow, Wrist or Ribs (Other Fracture) 20%",
    {formulaKind:"sum_insured",formulaValue:0.2,basisInferred:true});
  const printed=row("Arm , Elbow, Wrist or Ribs","Arm , Elbow, Wrist or Ribs 25%",{id:"printed",formulaKind:"fixed",formulaValue:1250,basisInferred:true});
  assert.equal(classifyInjuryLine(printed).kind,"ambiguous_injury","on its own the printed row states no kind");
  const kept=preferStatedRules([inferred,printed]);
  assert.equal(kept.length,1);assert.equal(kept[0].id,"printed","the printed figure outranks the heading-inferred percentage");
  assert.equal(classifyInjuryLine(kept[0]).kind,"fracture","…and carries the kind its sibling states");
  const forearm:SubjectFacts={eventType:fact("accident"),injured:fact(true),injuryKind:fact("fracture"),fractureBodyPart:fact("forearm"),injuryBodyPart:fact("forearm")};
  assert.equal(injuryCompatibility(kept[0],forearm).visible,true,"a broken forearm answers the arm fracture row");
  // Never carried when the siblings disagree, and never onto a row that has its own kind.
  const loss=row("Arm , Elbow, Wrist or Ribs (Loss of use)","",{id:"loss"});
  assert.equal(classifyInjuryLine(preferStatedRules([inferred,printed,loss])[0]).kind,"ambiguous_injury","conflicting sibling kinds carry nothing");
  assert.equal(preferStatedRules([FRACTURE_OF_ARM])[0],FRACTURE_OF_ARM,"a lone row is returned untouched");
  // A permanent-loss row stays permanent loss for a fracture, whatever its sibling says.
  assert.equal(injuryCompatibility(preferStatedRules([LOSS_OF_ARM])[0],armFracture).visible,false);
});
console.log("injury compatibility regressions passed ("+cases+" cases)");
