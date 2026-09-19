import assert from "node:assert/strict";
import { applyImpliedScaleLimit,holdNonMonotonicBands,impliedScaleLimit,resolveStoredRules } from "@/lib/insurance/scale-limit";
import type { CatalogBenefit } from "@/lib/policies/benefit-catalog";

/** Adversarial tests for the inference with the largest blast radius.
 *
 * A fracture table states "Arm, Elbow, Wrist or Ribs -- 20%" and never says
 * what the 20% is of. Read as the plan's S$600,000 sum insured it is
 * S$120,000; the household's other document prints S$1,250 for the same
 * injury. Everything this module does is work out the missing denominator
 * from the documents themselves -- which means a wrong answer here is wrong by
 * a factor of a hundred, in whichever direction it lands. */

let seed=900771;
function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
function pick<T>(list:T[]):T{return list[Math.floor(rnd()*list.length)%list.length];}

let counter=0;
const row=(over:Partial<CatalogBenefit>={}):CatalogBenefit=>({
  id:"b-"+(counter++),policyId:"doc-a",productName:"Group Personal Accident",benefitName:"Hip",
  traits:["accident"],requires:[],formulaKind:"fixed",formulaValue:3_750,currency:"SGD",factKey:null,
  offsetDays:null,maximumDays:null,sourcePage:8,quote:"Hip 75%",conditions:[],requirements:[],
  needsReview:false,basisInferred:false,...over} as CatalogBenefit);

/** The household's real shape: one document states the scale as amounts, the
 * other as percentages read from a column heading. */
function realScale(){
  const pairs:[string,number,number][]=[["Hip",3_750,0.75],["Jaw, Pelvis, Leg, Ankle or Knee",2_500,0.5],
    ["Cheekbone, Shoulder or Hairline Fracture of Skull",1_500,0.3],["Neck, Skull or Spine (Full Break)",5_000,1]];
  return pairs.flatMap(([name,amount,share])=>[
    row({policyId:"doc-b",sourcePage:14,benefitName:name,formulaKind:"fixed",formulaValue:amount}),
    row({policyId:"doc-a",sourcePage:8,benefitName:name,formulaKind:"sum_insured",formulaValue:share,
      basisInferred:true,needsConfirmation:true}),
  ]);
}
/** A dismemberment scale really IS a percentage of the sum insured, stated in
 * the row itself. It must never be touched by any of this. */
function dismemberment(){
  return [row({policyId:"doc-a",sourcePage:6,benefitName:"Loss of one limb",formulaKind:"sum_insured",
    formulaValue:1,basisInferred:false,quote:"Loss of or Permanent Total Loss of use of at least one limb 100%"})];
}
const names=(list:CatalogBenefit[])=>list.map(entry=>entry.id).join(",");
const shape=(list:CatalogBenefit[])=>JSON.stringify(list.map(entry=>
  [entry.id,entry.formulaKind,entry.formulaValue,entry.needsConfirmation===true]));

export function runScaleLimitStress(){
  let checks=0;
  const fail=(why:string,detail:unknown)=>{
    throw new Error("scale-limit stress: "+why+"\n  seed at failure: "+seed+"\n  "
      +JSON.stringify(detail,null,2).slice(0,1200));
  };

  // 1. The real household. The limit is S$5,000, and only the percentage rows
  //    on the page that produced the pairs are rewritten.
  {
    const benefits=[...realScale(),...dismemberment()];
    const scale=impliedScaleLimit(benefits);
    assert.ok(scale,"four rows stated both ways must settle the limit");
    assert.equal(scale!.limit,5_000);
    assert.ok(scale!.support>=2);
    const applied=applyImpliedScaleLimit(benefits);
    const wrist=applied.find(entry=>entry.benefitName==="Hip"&&entry.policyId==="doc-a")!;
    assert.equal(wrist.formulaKind,"fixed");
    assert.equal(wrist.formulaValue,3_750,"75% of S$5,000, not 75% of the sum insured");
    const limb=applied.find(entry=>entry.benefitName==="Loss of one limb")!;
    assert.equal(limb.formulaKind,"sum_insured");
    assert.equal(limb.formulaValue,1,"a dismemberment scale is a share of the sum insured and stays one");
    checks+=6;
  }

  // 2. One coincidence is not a scale.
  {
    const only=[row({policyId:"doc-b",benefitName:"Hip",formulaKind:"fixed",formulaValue:3_750}),
      row({policyId:"doc-a",benefitName:"Hip",formulaKind:"sum_insured",formulaValue:0.75,basisInferred:true})];
    assert.equal(impliedScaleLimit(only),null,"a single pair could be a coincidence and must not become a limit");
    assert.equal(shape(applyImpliedScaleLimit(only)),shape(only),"and nothing is rewritten on the strength of it");
    checks+=2;
  }

  // 3. Documents that disagree. Two limits with the same support is the
  //    documents contradicting each other, and a contradiction is not evidence.
  {
    const conflicting=[
      row({policyId:"doc-b",benefitName:"Hip",formulaKind:"fixed",formulaValue:3_750}),
      row({policyId:"doc-a",benefitName:"Hip",formulaKind:"sum_insured",formulaValue:0.75,basisInferred:true}),
      row({policyId:"doc-b",benefitName:"Jaw",formulaKind:"fixed",formulaValue:2_500}),
      row({policyId:"doc-a",benefitName:"Jaw",formulaKind:"sum_insured",formulaValue:0.5,basisInferred:true}),
      // Another two rows that agree just as strongly on a different limit.
      row({policyId:"doc-b",benefitName:"Ribs",formulaKind:"fixed",formulaValue:20_000}),
      row({policyId:"doc-a",benefitName:"Ribs",formulaKind:"sum_insured",formulaValue:0.5,basisInferred:true}),
      row({policyId:"doc-b",benefitName:"Ankle",formulaKind:"fixed",formulaValue:30_000}),
      row({policyId:"doc-a",benefitName:"Ankle",formulaKind:"sum_insured",formulaValue:0.75,basisInferred:true}),
    ];
    const scale=impliedScaleLimit(conflicting);
    if(scale)fail("two equally supported limits were resolved by picking one, rather than left to a person",
      {limit:scale.limit,support:scale.support});
    checks++;
  }

  // 4. Running it twice must not apply the scale twice. The first pass rewrites
  //    percentages into amounts -- which are then themselves candidates for
  //    pairing, and a second derived limit would move every figure again.
  {
    const benefits=[...realScale(),...dismemberment()];
    const once=resolveStoredRules(benefits);
    const twice=resolveStoredRules(once);
    if(shape(once)!==shape(twice))fail("resolving the stored rules twice changed them",
      {once:shape(once),twice:shape(twice)});
    checks++;
  }

  // 5. A scale that pays less for a worse injury is held back, and one that
  //    reads correctly is not.
  {
    const band=(bound:number,share:number)=>row({benefitName:"Third Degree Burns · Body - Equals to or greater than "
      +bound+"% but less than 90%",formulaKind:"sum_insured",formulaValue:share,basisInferred:true,sourcePage:7});
    const wrong=holdNonMonotonicBands([band(10,0.5),band(15,0.3),band(20,1)]);
    assert.ok(wrong.every(entry=>entry.needsConfirmation===true),"a scale that falls must wait for a person");
    const right=holdNonMonotonicBands([band(10,0.5),band(15,0.75),band(20,1)]);
    assert.ok(right.every(entry=>entry.needsConfirmation!==true),"a scale that rises is left alone");
    // Two different tables on one page are not one scale.
    const head=row({benefitName:"Third Degree Burns · Head - Equals to or greater than 2% but less than 5%",
      formulaKind:"sum_insured",formulaValue:0.5,basisInferred:true,sourcePage:7});
    const body=row({benefitName:"Third Degree Burns · Body - Equals to or greater than 10% but less than 15%",
      formulaKind:"sum_insured",formulaValue:0.5,basisInferred:true,sourcePage:7});
    assert.ok(holdNonMonotonicBands([head,body]).every(entry=>entry.needsConfirmation!==true),
      "the head table and the body table are separate scales");
    checks+=3;
  }

  // 6. Fuzz. Whatever comes in, no row is lost, no figure becomes impossible,
  //    and nothing that was not a heading-read percentage is ever rewritten.
  for(let round=0;round<2500;round++){
    const benefits=Array.from({length:2+Math.floor(rnd()*10)},()=>row({
      policyId:pick(["doc-a","doc-b","doc-c"]),
      sourcePage:pick([6,7,8,14]),
      benefitName:pick(["Hip","Jaw","Ribs","Wrist","Loss of one limb","Third Degree Burns · Body - Equals to or greater than 15% but less than 25%"]),
      formulaKind:pick(["fixed","sum_insured","none","daily","expense_cap"] as const),
      formulaValue:pick([null,0,0.3,0.75,1,1.5,1_250,3_750,5_000,999_999_999]),
      basisInferred:rnd()<0.5,
      needsConfirmation:rnd()<0.3,
      reviewedAt:rnd()<0.1?"2026-01-01T00:00:00.000Z":null,
    }));
    const before=new Map(benefits.map(entry=>[entry.id,entry]));
    let after;
    try{after=resolveStoredRules(benefits);}
    catch(error){fail("threw on generated rules: "+(error instanceof Error?error.message:String(error)),benefits);}
    if(after!.length!==benefits.length)fail("a rule was lost or duplicated",{was:names(benefits),now:names(after!)});
    for(const entry of after!){
      const was=before.get(entry.id)!;
      if(entry.formulaValue!=null&&(!Number.isFinite(entry.formulaValue)||entry.formulaValue<0))
        fail("produced an impossible figure",{was,entry});
      // Only a heading-read share of a sum insured is ever rewritten.
      const rewritten=entry.formulaKind!==was.formulaKind||entry.formulaValue!==was.formulaValue;
      if(rewritten&&!(was.formulaKind==="sum_insured"&&was.basisInferred===true))
        fail("rewrote a rule that was not a heading-read percentage",{was,entry});
      if(rewritten&&entry.formulaKind!=="fixed")fail("rewrote a percentage into something other than an amount",{was,entry});
      // A person's own correction outranks every inference here.
      if(was.reviewedAt&&entry.needsConfirmation===true&&was.needsConfirmation!==true)
        fail("asked a person to confirm a rule they had already confirmed",{was,entry});
    }
    checks+=3;
  }

  console.log("DearPolicy scale-limit stress passed ("+checks.toLocaleString("en-SG")
    +" assertions over generated scales).");
}
