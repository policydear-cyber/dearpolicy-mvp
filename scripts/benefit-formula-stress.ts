import assert from "node:assert/strict";
import { assessCatalogBenefit,validateCatalogFormula,type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { SubjectFacts } from "@/lib/chat/types";

/** Adversarial tests for the step that turns a stored rule into money.
 *
 * Two functions decide every figure this product shows. One accepts a rule
 * only if the quoted clause proves it; the other does the arithmetic. The
 * first is the guard that stopped a heading being read as a payout, and the
 * second is where a wrong sum insured or a wrong day count becomes a number a
 * person acts on.
 *
 * Properties, over generated rules and clauses. No model, no database. */

let seed=44031;
function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
function pick<T>(list:T[]):T{return list[Math.floor(rnd()*list.length)%list.length];}

const QUOTES=[
  "We pay 100% of the Sum Insured on the death of the Insured Member.",
  "We pay 25% of the sum insured for loss of one eye.",
  "On death we pay the full Sum Insured.",
  "One twelfth of Sum Insured is payable each month.",
  "We pay S$2,000 as a funeral benefit.",
  "Reimbursement of the actual ambulance cost incurred, up to S$500 per incident.",
  "S$30 per day of hospital confinement after the first 2 days, up to a maximum of 30 days.",
  "Payable from the 11th to the 40th day of confinement at S$100 per day.",
  "Arm, Elbow, Wrist or Ribs 25%",
  "Sum Insured less any previous payment.",
  "Up to S$500 per incident.",
  "We pay 1000% of the Sum Insured.",
  "We pay 150% of the Sum Insured where death results from an accident.",
  "",
];
const KINDS=["none","sum_insured","fixed","expense_cap","daily"];
const VALUES=[null,0,0.25,1,1.5,10,30,100,500,2_000,-1,NaN,Infinity,0.0833];

const coverage=(amount:number|null,currency="SGD"):OwnedCoverage=>({
  id:"cov-1",policyId:"doc-1",familyMemberId:"m-1",category:"Death",amount,currency,
  productName:"Group Term Life",sourcePage:1,evidenceText:"Certificate",insurer:"Singlife",
  policyName:"Scheme",policyNumber:"3037850",groupPolicyNumber:null,documentRole:"certificate",
  effectiveDate:"2022-10-06",renewalOrExpiryDate:null, currencyVerified: true});

const benefit=(over:Partial<CatalogBenefit>={}):CatalogBenefit=>({
  id:"b-1",policyId:"doc-1",productName:"Group Term Life",benefitName:"Death Benefit",
  traits:["death"],requires:[],formulaKind:"sum_insured",formulaValue:1,currency:"SGD",factKey:null,
  offsetDays:null,maximumDays:null,sourcePage:2,quote:"We pay 100% of the Sum Insured on death.",
  conditions:[],requirements:[],needsReview:false,...over} as CatalogBenefit);

const fact=(value:string|number|boolean|null)=>({value,state:"known" as const,quote:String(value),
  recordedAt:"2026-09-01T00:00:00.000Z",source:"user" as const});

/** Reads a formatted figure back off the card, the way a person does. */
function readAmount(text:string|null|undefined){
  if(!text)return null;
  const match=text.replace(/,/g,"").match(/(-?\d+(?:\.\d+)?)/);
  return match?Number(match[1]):null;
}

export function runBenefitFormulaStress(){
  let checks=0;
  const fail=(why:string,detail:unknown)=>{
    throw new Error("benefit-formula stress: "+why+"\n  seed at failure: "+seed+"\n  "
      +JSON.stringify(detail,null,2).slice(0,1200));
  };

  // -----------------------------------------------------------------------
  // 1. A rule is only accepted if the quoted clause proves it. This is the
  //    guard that stopped a table heading becoming a payout, so it is checked
  //    against every combination rather than a few.
  // -----------------------------------------------------------------------
  for(const quote of QUOTES)for(const kind of KINDS)for(const value of VALUES){
    const got=validateCatalogFormula({kind,value,currency:"SGD",quote,factKey:pick([null,"ambulanceBill","hospitalNights"]),
      offsetDays:null,maximumDays:null});
    if(got.formulaKind==="none"){checks++;continue;}
    if(got.formulaValue==null||!Number.isFinite(got.formulaValue)||got.formulaValue<0)
      fail("accepted a rule with an impossible value",{quote,kind,value,got});
    // Whatever it accepted has to be traceable to the words on the page.
    const share=got.formulaValue as number;
    if(got.formulaKind==="sum_insured"){
      const text=quote.toLowerCase();
      const stated=Math.round(share*1000)/10;
      const written=text.includes(stated+"%")||text.includes(Math.round(stated)+"%");
      const wholeSum=share===1&&/sum insured/.test(text);
      const worded=/one twelfth|one third|one half|one quarter/.test(text);
      if(!written&&!wholeSum&&!worded)
        fail("a share of the sum insured that the clause never states",{quote,value,got});
    } else if(share>0&&!quote.replace(/,/g,"").includes(String(share)))
      fail("a figure that is not in the clause",{quote,kind,value,got});
    // A daily rule without both ends of its scale cannot be calculated.
    if(got.formulaKind==="daily"&&(got.offsetDays==null||got.maximumDays==null))
      fail("a daily rule was accepted without its day limits",{quote,got});
    if(got.formulaKind==="daily"&&(got.maximumDays!<=0||got.offsetDays!<0))
      fail("a daily rule with impossible day limits",{quote,got});
    checks+=2;
  }

  // -----------------------------------------------------------------------
  // 2. The arithmetic. Every figure must be finite, non-negative, and exactly
  //    what the card says it is.
  // -----------------------------------------------------------------------
  for(let round=0;round<6000;round++){
    const kind=pick(["none","sum_insured","fixed","expense_cap","daily"] as const);
    const rule=benefit({
      formulaKind:kind,
      formulaValue:pick([null,0,0.25,1,1.5,30,100,500,2_000,1_000_000]),
      factKey:kind==="expense_cap"?"ambulanceBill":kind==="daily"?"hospitalNights":null,
      offsetDays:kind==="daily"?pick([0,2,10,null]):null,
      maximumDays:kind==="daily"?pick([1,30,365,null]):null,
      benefitName:pick(["Death Benefit","Ambulance Fee","Daily Hospital Cash","Simple Fracture (wrist)"]),
      needsReview:rnd()<0.2,
    });
    const cover=rnd()<0.2?null:coverage(pick([null,0,5_000,350_000,600_000,1_000_000]),pick(["SGD","SGD","USD"]));
    const facts:SubjectFacts={} as SubjectFacts;
    if(rnd()<0.7)(facts as Record<string,unknown>).hospitalNights=fact(pick([0,1,4,30,400]));
    if(rnd()<0.6)(facts as Record<string,unknown>).ambulanceBill=fact(pick([0,120,220,5_000]));
    if(rnd()<0.15)(facts as Record<string,unknown>).hospitalStayOngoing=fact(true);

    let assessed;
    try{assessed=assessCatalogBenefit({benefit:rule,coverage:cover,ownerName:"Charmaine",facts,
      contractId:"contract-1",contractName:"Scheme",insurer:"Singlife",events:["death"]});}
    catch(error){fail("threw on a generated rule: "+(error instanceof Error?error.message:String(error)),{rule,cover,facts});}
    const item=assessed!.item;
    const amount=item.calculatedAmount;
    if(amount!=null&&(!Number.isFinite(amount)||amount<0))fail("produced an impossible figure",{amount,rule,cover});
    if(amount!=null&&item.amountText){
      const shown=readAmount(item.amountText);
      if(shown==null||Math.abs(shown-amount)>0.011)
        fail("the figure on the card is not the figure being counted",{shown,amount,text:item.amountText,rule});
    }
    if(kind==="none"&&amount!=null)fail("a rule with no formula produced a figure",{rule,amount});

    // An expense benefit reimburses a bill. It can never pay more than the
    // bill, and never more than the cap the clause states.
    if(kind==="expense_cap"&&amount!=null){
      const spent=Number((facts as Record<string,{value:unknown}>).ambulanceBill?.value??NaN);
      if(Number.isFinite(spent)&&amount>spent+0.001)fail("reimbursed more than was spent",{amount,spent,rule});
      if(rule.formulaValue!=null&&amount>rule.formulaValue+0.001)fail("reimbursed more than the cap",{amount,rule});
      if(item.aggregation!=="reimbursement")fail("a reimbursement was treated as a lump sum",{item});
    }
    // A per-day benefit pays the rate, for days the person actually had,
    // never beyond the maximum the clause states.
    if(kind==="daily"&&amount!=null&&rule.formulaValue!=null){
      const nights=Number((facts as Record<string,{value:unknown}>).hospitalNights?.value??NaN);
      const offset=rule.offsetDays??0;
      const payable=Number.isFinite(nights)?Math.max(0,nights-offset):0;
      const cap=rule.maximumDays??payable;
      const most=Math.min(cap,payable)*rule.formulaValue;
      if(amount>most+0.001)fail("paid for more days than the clause allows",{amount,most,nights,rule});
    }
    // A share of the sum insured is a share of THAT cover's sum insured, in
    // that cover's currency. A figure in one currency computed from a sum in
    // another is not a figure at all.
    if(kind==="sum_insured"&&amount!=null){
      const insured=cover?.amount;
      if(insured==null||!cover)fail("a share of a sum insured nobody has on file produced a figure",{amount,rule});
      else{
        if(cover.currency!==item.currency)fail("mixed a sum insured in one currency with a figure in another",
          {coverage:cover.currency,item:item.currency,amount});
        const expected=Math.round(insured*(rule.formulaValue??0)*100)/100;
        if(Math.abs(amount-expected)>0.011)fail("the share does not match the rule",{amount,expected,rule,cover});
      }
    }
    // A rule read from a heading rather than the row is never presented as
    // confirmed, whatever the arithmetic came to.
    if(rule.needsConfirmation&&item.estimateBasis!=="indicative")
      fail("an unconfirmed rule was shown as if it were confirmed",{item});
    // Anything still needed is said on the card, in words, not left implicit.
    if(assessed!.missing.length&&!item.conditions.some(line=>line.startsWith("Still needed: ")))
      fail("something is missing and the card does not say so",{missing:assessed!.missing,conditions:item.conditions});
    checks+=4;
  }

  // -----------------------------------------------------------------------
  // 3. The specific failures this system has actually produced.
  // -----------------------------------------------------------------------
  {
    // A heading read as a payout: "Arm, Elbow, Wrist or Ribs 25%" with no
    // statement of what the 25% is OF.
    const got=validateCatalogFormula({kind:"sum_insured",value:0.25,currency:"SGD",
      quote:"Arm, Elbow, Wrist or Ribs 25%",factKey:null,offsetDays:null,maximumDays:null});
    assert.equal(got.formulaKind,"none","a percentage of nothing is not a rule");
    checks++;
  }
  {
    // "Sum Insured less any previous payment" is not the sum insured.
    const got=validateCatalogFormula({kind:"sum_insured",value:1,currency:"SGD",
      quote:"We pay the Sum Insured less any previous payment.",factKey:null,offsetDays:null,maximumDays:null});
    assert.equal(got.formulaKind,"none");
    checks++;
  }
  {
    // A clause in one currency must never be paid out of a sum insured in
    // another.
    const item=assessCatalogBenefit({benefit:benefit({currency:"USD"}),coverage:coverage(1_000_000,"SGD"),
      ownerName:"A",facts:{} as SubjectFacts,events:["death"]}).item;
    assert.equal(item.calculatedAmount,undefined,"USD rule against an SGD sum insured pays nothing until it is sorted out");
    checks++;
  }
  {
    // A multiple of the sum insured no policy pays. The clause states it, so
    // it is read -- but it is shown rather than counted, and it says why.
    const wild=benefit({formulaValue:10,quote:"We pay 1000% of the Sum Insured."});
    const assessed=assessCatalogBenefit({benefit:wild,coverage:coverage(1_000_000),ownerName:"A",
      facts:{} as SubjectFacts,events:["death"]});
    assert.equal(assessed.item.calculatedAmount,10_000_000,"the number is still shown; a figure nobody sees is one nobody corrects");
    assert.equal(assessed.item.estimateBasis,"indicative","and it never reaches the household total");
    assert.ok(assessed.item.conditions.some(line=>/far more than any policy pays/.test(line)),
      "and the card says why: "+assessed.item.conditions.join(" | "));
    // Two and three times the sum insured are real accidental-death riders.
    for(const share of [1,1.5,2,3]){
      const fine=assessCatalogBenefit({benefit:benefit({formulaValue:share,
        quote:"We pay "+share*100+"% of the Sum Insured."}),coverage:coverage(1_000_000),ownerName:"A",
        facts:{} as SubjectFacts,events:["death"]}).item;
      assert.notEqual(fine.estimateBasis,"indicative","a "+share*100+"% benefit is ordinary and must still count");
    }
    // Unless a person has read their own policy and said it is right.
    const confirmed=assessCatalogBenefit({benefit:benefit({formulaValue:10,
      quote:"We pay 1000% of the Sum Insured.",reviewedAt:"2026-09-19T00:00:00.000Z"}),
      coverage:coverage(1_000_000),ownerName:"A",facts:{} as SubjectFacts,events:["death"]}).item;
    assert.notEqual(confirmed.estimateBasis,"indicative","a person reading their own policy outranks this check");
    checks+=7;
  }
  {
    // The one that has to keep working.
    const item=assessCatalogBenefit({benefit:benefit(),coverage:coverage(1_000_000),ownerName:"Charmaine",
      facts:{death:fact(true)} as SubjectFacts,events:["death"]}).item;
    assert.equal(item.calculatedAmount,1_000_000);
    assert.equal(item.estimateBasis,"confirmed","a certificate sum insured and a quoted clause is as good as it gets");
    checks+=2;
  }

  console.log("DearPolicy benefit-formula stress passed ("+checks.toLocaleString("en-SG")
    +" assertions over generated rules and clauses).");
}
