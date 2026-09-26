import assert from "node:assert/strict";
import { applyPolicyAggregateCaps,resolveCoverOverlaps } from "@/lib/insurance/cover-composition";
import { aggregatePotentialPayouts } from "@/lib/chat/policy-analysis";
import type { ClaimItem } from "@/types";

/** Adversarial tests for the arithmetic that produces the number.
 *
 * The figure on the screen is the product. Everything else -- the reading, the
 * matching, the conditions -- exists to feed three small functions that decide
 * which benefits are alternatives, what a cover's own cap does to them, and
 * what gets added up. Each of them has already been wrong in production, in
 * both directions: a personal accident sum counted twice for S$3,600,000, and
 * an injury schedule that paid every fixed row at once.
 *
 * So these are properties, over generated households, not scenarios. No model,
 * no database, no clock. */

const COVERS=["policy:3037850|group term life","policy:3037850|group personal accident",
  "policy:3037850|living care","policy:G00012|group hospital","product:singlife|mortgage cover",
  "contract:c-9|travel"];
const EVENTS=["death","critical_illness","total_permanent_disability","accidental_injury",
  "terminal_illness",undefined] as (string|undefined)[];

let seed=771020;
function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
function pick<T>(list:T[]):T{return list[Math.floor(rnd()*list.length)%list.length];}

/** A sum insured belongs to a cover, not to a row. Generating one per row
 * produced households no certificate could describe, and let the suite assert
 * an invariant the code was never claiming. */
const SUM_INSURED=new Map(COVERS.map((cover,index)=>[cover,[5_000,600_000,1_000_000,350_000,undefined,300_000][index]]));
function randomItem(index:number):ClaimItem{
  const kind=pick(["sum_insured","fixed","expense_cap","daily","limit_percentage"] as const);
  const amount=pick([0,1,60,220,1_250,5_000,50_000,300_000,350_000,600_000,1_000_000]);
  const scale=rnd()<0.3;
  const coverKey=pick(COVERS);
  return {
    title:"Person · Benefit "+index,
    status:pick(["likely_applicable","potentially_applicable"] as const),
    amountText:"S$"+amount.toLocaleString("en-SG"),
    amountLabel:"Calculated benefit (internal)",
    estimateBasis:pick(["confirmed","estimated","indicative"] as const),
    calculatedAmount:amount,
    currency:pick(["SGD","SGD","SGD","USD"]),
    calculationKind:kind,
    aggregation:rnd()<0.85?"additive":"reimbursement",
    calculationId:"calc-"+index,
    coverKey,
    coverLabel:"A cover",
    ...(pick(EVENTS)?{payingEvent:pick(EVENTS) as string}:{}),
    coverAmount:SUM_INSURED.get(coverKey),
    ...(scale?{scaleGroup:pick(["doc-a#7","doc-a#8","doc-b#6"])}:{}),
    contractId:"contract-1",
    reason:rnd()<0.1?"Advance Payment Benefit of the sum insured":"Read from the policy.",
    conditions:[],
  } as ClaimItem;
}
function household(size:number){return Array.from({length:size},(_,index)=>randomItem(index));}
function clone(items:ClaimItem[]){return items.map(item=>({...item,conditions:[...item.conditions]}));}
function counted(items:ClaimItem[]){
  return items.filter(item=>["likely_applicable","potentially_applicable"].includes(item.status)
    &&item.aggregation==="additive"&&!item.supersededBy&&item.estimateBasis!=="indicative"
    &&typeof item.calculatedAmount==="number"&&item.calculatedAmount>0);
}
function totalOf(items:ClaimItem[]){return counted(items).reduce((sum,item)=>sum+(item.calculatedAmount??0),0);}
function money(items:ClaimItem[]){return items.map(item=>item.calculatedAmount??null);}

/** The whole pipeline, in the order lib/chat/workflow.ts runs it. */
function settle(items:ClaimItem[]){
  const {notes}=resolveCoverOverlaps(items);
  const capNotes=applyPolicyAggregateCaps(items);
  return {items,totals:aggregatePotentialPayouts(items),notes:[...notes,...capNotes]};
}

export function runClaimArithmeticStress(){
  let checks=0;
  const fail=(why:string,detail:unknown)=>{
    throw new Error("claim-arithmetic stress: "+why+"\n  seed at failure: "+seed+"\n  "
      +JSON.stringify(detail,null,2).slice(0,1400));
  };

  for(let round=0;round<3000;round++){
    const start=household(2+Math.floor(rnd()*8));
    const before=totalOf(start);
    const beforeAmounts=start.map(item=>item.calculatedAmount??0);
    const items=clone(start);
    let settled;
    try{settled=settle(items);}
    catch(error){fail("threw on a generated household: "+(error instanceof Error?error.message:String(error)),start);}

    // 1. Settling is a subtraction. It removes double counts and applies caps.
    //    It must never find money that was not there.
    const after=totalOf(items);
    if(after>before+0.0001)fail("settling INCREASED the total",{before,after,start});
    items.forEach((item,index)=>{
      const now=item.calculatedAmount;
      if(now!=null&&!Number.isFinite(now))fail("a figure stopped being a number",{item});
      if(now!=null&&now<0)fail("a figure went negative",{item});
      if(now!=null&&now>beforeAmounts[index]+0.0001)fail("a benefit's own figure went UP",{was:beforeAmounts[index],now,item});
    });

    // 2. A figure that stops counting still has to be visible. A person who
    //    cannot see what their policy says it pays cannot check it, and cannot
    //    argue with the insurer about it.
    for(const item of items)
      if(item.supersededBy&&!item.amountText)fail("a superseded benefit lost its printed amount",{item});

    // 3. Within one cover, one event and one shape, exactly one row is counted.
    //    This is the S$3,600,000 answer, as an assertion.
    const groups=new Map<string,ClaimItem[]>();
    for(const item of counted(items)){
      if(!item.coverKey||!item.payingEvent)continue;
      const shape=item.calculationKind==="sum_insured"?"sum-insured":"amount:"+item.calculatedAmount;
      const key=item.coverKey+"|"+item.payingEvent+"|"+shape;
      groups.set(key,[...(groups.get(key)??[]),item]);
    }
    for(const [key,group] of groups)
      if(group.length>1)fail("the same money is counted "+group.length+" times",
        {key,titles:group.map(entry=>entry.title+" "+entry.amountText)});

    // 4. A cover's own cap on its injury schedule is not advice. Everything it
    //    pays for injuries from one accident is held at the sum insured.
    const byCover=new Map<string,ClaimItem[]>();
    for(const item of counted(items))
      if(item.coverKey&&item.scaleGroup)byCover.set(item.coverKey,[...(byCover.get(item.coverKey)??[]),item]);
    for(const [coverKey,group] of byCover){
      const stated=group.map(entry=>entry.coverAmount)
        .filter((amount):amount is number=>typeof amount==="number"&&amount>0);
      if(!stated.length)continue;
      const cap=Math.max(...stated);
      const scheduleTotal=group.reduce((sum,entry)=>sum+(entry.calculatedAmount??0),0);
      if(scheduleTotal>cap+0.0001)
        fail("an injury schedule paid "+scheduleTotal+" against a sum insured of "+cap,
          {coverKey,rows:group.map(entry=>entry.title+" "+entry.calculatedAmount)});
    }

    // 5. The total the person is shown is the sum of the rows the person can
    //    see being counted. Nothing hidden either way.
    const shown=settled!.totals.reduce((sum,total)=>sum+total.amount,0);
    const expect=counted(items).filter(item=>item.currency).reduce((sum,item)=>sum+(item.calculatedAmount??0),0);
    if(Math.abs(shown-expect)>0.0001)fail("the total does not match the rows it is made of",{shown,expect,
      rows:counted(items).map(item=>item.title+" "+item.calculatedAmount+" "+item.currency)});

    // 6. Currencies are never added together.
    const currencies=new Set(settled!.totals.map(total=>total.currency));
    if(currencies.size!==settled!.totals.length)fail("a currency was totalled twice",{totals:settled!.totals});

    checks+=6;
  }

  // 7. Asking twice changes nothing, and the order the rows happen to be in is
  //    not a fact about the policy.
  for(let round=0;round<800;round++){
    const start=household(3+Math.floor(rnd()*6));
    const once=clone(start);settle(once);
    const twice=clone(once);settle(twice);
    if(JSON.stringify(money(once))!==JSON.stringify(money(twice)))
      fail("settling twice changed the answer",{once:money(once),twice:money(twice),start});
    const forwards=clone(start);settle(forwards);
    const backwards=clone(start).reverse();settle(backwards);
    if(Math.abs(totalOf(forwards)-totalOf(backwards))>0.0001)
      fail("the order the rows were read in changed the total",
        {forwards:totalOf(forwards),backwards:totalOf(backwards),start});
    checks+=2;
  }

  // 8. Separate covers stack. That is the point of holding both, and an
  //    over-eager de-duplication is as wrong as a double count.
  {
    const life:ClaimItem={title:"A · Death Benefit",status:"likely_applicable",amountText:"S$1,000,000",
      estimateBasis:"confirmed",calculatedAmount:1_000_000,currency:"SGD",calculationKind:"sum_insured",
      aggregation:"additive",coverKey:"policy:3037850|group term life",payingEvent:"death",
      reason:"",conditions:[]} as ClaimItem;
    const accident:ClaimItem={...life,title:"A · Accidental Death",amountText:"S$600,000",
      calculatedAmount:600_000,coverKey:"policy:3037850|group personal accident",conditions:[]};
    const items=[life,accident];
    settle(items);
    assert.equal(totalOf(items),1_600_000,"two separate covers both pay");
    checks++;
  }
  // ...and one cover describing the same death three ways pays once.
  {
    const base={status:"likely_applicable" as const,estimateBasis:"confirmed" as const,currency:"SGD",
      calculationKind:"sum_insured" as const,aggregation:"additive" as const,
      coverKey:"policy:3037850|group term life",payingEvent:"death",reason:"",conditions:[] as string[]};
    const items=[
      {...base,title:"A · Death Benefit",amountText:"S$1,000,000",calculatedAmount:1_000_000,conditions:[]},
      {...base,title:"A · Death",amountText:"S$1,000,000",calculatedAmount:1_000_000,conditions:[]},
      {...base,title:"A · Loss of Life",amountText:"S$1,000,000",calculatedAmount:1_000_000,conditions:[]},
    ] as ClaimItem[];
    settle(items);
    assert.equal(totalOf(items),1_000_000,"one cover, one death, one payment");
    assert.equal(items.filter(item=>item.supersededBy).length,2,"the other two stay visible, saying what pays instead");
    assert.ok(items.every(item=>item.amountText==="S$1,000,000"),"and they still show what the policy prints");
    checks+=3;
  }
  // ...and a smaller fixed grant beside a sum insured is real extra money.
  {
    const base={status:"likely_applicable" as const,estimateBasis:"confirmed" as const,currency:"SGD",
      aggregation:"additive" as const,coverKey:"policy:3037850|group term life",payingEvent:"death",
      reason:"",conditions:[] as string[]};
    const items=[
      {...base,title:"A · Death Benefit",amountText:"S$1,000,000",calculatedAmount:1_000_000,
        calculationKind:"sum_insured" as const,conditions:[]},
      {...base,title:"A · Compassionate Death Allowance",amountText:"S$2,000",calculatedAmount:2_000,
        calculationKind:"fixed" as const,conditions:[]},
    ] as ClaimItem[];
    settle(items);
    assert.equal(totalOf(items),1_002_000,"a funeral grant is paid as well, not instead");
    checks++;
  }
  // ...and an advance gives way to the benefit it is an advance of.
  {
    const base={status:"likely_applicable" as const,estimateBasis:"confirmed" as const,currency:"SGD",
      calculationKind:"sum_insured" as const,aggregation:"additive" as const,
      coverKey:"policy:3037850|group term life",payingEvent:"death",conditions:[] as string[]};
    const items=[
      {...base,title:"A · Advance Payment Benefit",amountText:"S$400,000",calculatedAmount:400_000,
        reason:"Advance Payment Benefit of the sum insured",conditions:[]},
      {...base,title:"A · Death Benefit",amountText:"S$400,000",calculatedAmount:400_000,
        reason:"On death we pay the sum insured.",conditions:[]},
    ] as ClaimItem[];
    settle(items);
    const paid=counted(items);
    assert.equal(paid.length,1);
    assert.match(paid[0].title,/Death Benefit/,"the advance is what gives way, not the benefit");
    checks+=2;
  }

  console.log("DearPolicy claim-arithmetic stress passed ("+checks.toLocaleString("en-SG")
    +" assertions over generated households).");
}
