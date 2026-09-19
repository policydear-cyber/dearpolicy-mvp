import { formatMoney } from "@/lib/format/currency";
import type { ClaimItem } from "@/types";

/** Benefits do not simply add up.
 *
 * Adding every responding benefit together is a claim about the contracts, and
 * it is usually false. Within one cover, the benefits that pay on the same
 * event are alternatives: a group personal accident policy pays its accidental
 * death sum once, whether the schedule row, the certificate and the benefit
 * table each describe it or not. Across separate covers, life and personal
 * accident sums genuinely do stack, and nothing here interferes with that.
 *
 * So the rule is narrow and checkable: same cover, same triggering event, more
 * than one lump sum -- keep one, and say plainly that the others are paid
 * instead of it rather than as well as it. The figure stays on the card,
 * because a person who cannot see it cannot check it; it just stops being
 * added. */
export type OverlapResolution={items:ClaimItem[];notes:string[]};

const BASIS_RANK:Record<string,number>={confirmed:3,estimated:2,indicative:1};
/** A benefit that says it is an advance, or an acceleration, of another one.
 *
 * "Advance Payment Benefit -- 100% of the sum insured" sits in the same plan as
 * the death benefit and pays the same sum: it is that money arriving early, not
 * a second lot of it. Where anything else in the cover pays the same event,
 * this is the row that gives way, whatever the arithmetic ranks it. Alone, it
 * still pays, because an advance is real money. */
function saysItIsAnAdvance(item:ClaimItem){
  return /\b(?:advance(?:d)? payment|advance benefit|accelerat\w*)\b/i.test(item.title+" "+item.reason);
}
function rank(item:ClaimItem){
  if(saysItIsAnAdvance(item))return -1;
  // A figure computed from the person's own verified sum insured beats one
  // printed in a booklet for everybody, whichever is larger.
  const fromOwnSchedule=item.calculationKind==="sum_insured"?1:0;
  return ((BASIS_RANK[item.estimateBasis??""]??0)*2+fromOwnSchedule)*1_000_000_000+(item.calculatedAmount??0);
}

export function resolveCoverOverlaps(items:ClaimItem[]):OverlapResolution{
  const groups=new Map<string,ClaimItem[]>();
  for(const item of items){
    if(item.aggregation!=="additive")continue;
    if(typeof item.calculatedAmount!=="number"||!Number.isFinite(item.calculatedAmount)||item.calculatedAmount<=0)continue;
    if(!item.coverKey||!item.payingEvent)continue;
    // Which rows are genuinely alternatives, and which only look like it.
    //
    // Two rows computed from the same sum insured are the same money described
    // twice -- a certificate line and a benefit table saying what the policy
    // pays on a death. So are two rows that arrive at an identical figure. But
    // a fixed funeral grant alongside a death sum assured is a second, smaller
    // benefit that really is paid as well, and collapsing those would fix the
    // double count by inventing an undercount. So only the first two shapes
    // are treated as alternatives.
    const shape=item.calculationKind==="sum_insured"?"sum-insured":"amount:"+item.calculatedAmount;
    const key=item.coverKey+"|"+item.payingEvent+"|"+shape;
    groups.set(key,[...(groups.get(key)??[]),item]);
  }
  // A schedule of injuries pays for the injury that happened, not for every
  // line that could describe it. "I lost my thumb" matches the thumb row, the
  // phalanx-of-thumb row and the fingers row -- subdivisions of one injury, not
  // three payouts. Rows from the same table, one page of one document, resolve
  // to the largest, and the rest say so.
  const scales=new Map<string,ClaimItem[]>();
  for(const item of items){
    if(item.aggregation!=="additive"||item.supersededBy)continue;
    if(typeof item.calculatedAmount!=="number"||!(item.calculatedAmount>0))continue;
    if(!item.scaleGroup)continue;
    scales.set(item.scaleGroup,[...(scales.get(item.scaleGroup)??[]),item]);
  }
  const notes:string[]=[];
  for(const group of scales.values()){
    if(group.length<2)continue;
    const ordered=[...group].sort((a,b)=>(b.calculatedAmount??0)-(a.calculatedAmount??0)||a.title.localeCompare(b.title));
    const kept=ordered[0];
    for(const item of ordered.slice(1)){
      item.supersededBy=kept.title;
      item.status="potentially_applicable";
      item.amountLabel="What this benefit pays";
      item.conditions=[...new Set([...item.conditions,
        "One line of a schedule of injuries, which pays for the injury that happened rather than for every line that could describe it. "
        +"\u201c"+kept.title+"\u201d is the largest line on that schedule matching what you described, and is the one counted."])];
      delete (item as {calculatedAmount?:number}).calculatedAmount;
    }
    notes.push("More than one line of the same schedule of injuries matches what you described, so "
      +(kept.amountText??"the largest")+" is counted once rather than added up. "
      +"If there were separate injuries, each can pay on its own \u2014 say which, and DearPolicy will work them out separately.");
  }
  for(const raw of groups.values()){
    // A row the schedule pass already resolved is out of the running here: it
    // no longer carries an amount, so it can neither be counted nor stand in
    // for the row that is.
    const group=raw.filter(item=>!item.supersededBy);
    if(group.length<2)continue;
    // The figure taken from the person's own schedule wins over one printed in
    // a booklet for everybody, and only then does size decide. Taking the
    // largest first would have preferred a generic S$1,000,000 over the
    // S$600,000 the certificate actually says is theirs.
    // The last tie-break is the title, and it is arbitrary on purpose: when
    // two rows describe the same money on the same evidence there is no better
    // row, only a need to pick the same one every time. The note below says
    // both names out loud so nothing disappears.
    const ordered=[...group].sort((a,b)=>rank(b)-rank(a)||a.title.localeCompare(b.title));
    const kept=ordered[0];
    for(const item of ordered.slice(1)){
      item.supersededBy=kept.title;
      item.status="potentially_applicable";
      item.amountLabel="What this benefit pays";
      item.conditions=[...new Set([...item.conditions,
        "Paid instead of \u201c"+kept.title+"\u201d, not in addition to it: both are paid by the same policy for the same event, so only one of them settles. "
        +"The figure counted is "+(kept.amountText??"the other benefit")+"."])];
      delete (item as {calculatedAmount?:number}).calculatedAmount;
    }
    const others=ordered.slice(1).map(item=>"\u201c"+item.title.split(" \u00b7 ").slice(1).join(" \u00b7 ")+"\u201d").join(", ");
    notes.push("\u201c"+kept.title.split(" \u00b7 ").slice(1).join(" \u00b7 ")+"\u201d and "+others+" are the same cover paying on the same event, so "
      +(kept.amountText?kept.amountText+" is counted once":"only one of them is counted")+" rather than added together.");
  }
  return {items,notes};
}

/** What the policy itself says about adding injuries up.
 *
 * Two sentences from the household's own wording, which nothing in the system
 * was following:
 *
 *   "No compensation is payable for a specific disability where such specific
 *    disability ... qualifies for Total and Permanent Disability Benefit under
 *    this Policy."
 *
 *   "The total compensation payable ... for all Accidental Permanent
 *    Dismemberment due to the same Accident shall not exceed in the aggregate
 *    the Sum Insured under the Policy."
 *
 * So: where total and permanent disability pays, the schedule of injuries does
 * not pay as well; and whatever the schedule does come to, it cannot exceed the
 * cover it is a percentage of. The second is applied by reducing the smallest
 * figure that breaches the cap rather than by dropping benefits, because the
 * contract caps the total, not the list.
 */
export function applyPolicyAggregateCaps(items:ClaimItem[]):string[]{
  const notes:string[]=[];
  const counted=(item:ClaimItem)=>item.aggregation==="additive"&&!item.supersededBy
    &&typeof item.calculatedAmount==="number"&&item.calculatedAmount>0;
  const byCover=new Map<string,ClaimItem[]>();
  for(const item of items){
    if(!counted(item)||!item.coverKey)continue;
    byCover.set(item.coverKey,[...(byCover.get(item.coverKey)??[]),item]);
  }
  for(const group of byCover.values()){
    const disability=group.find(item=>item.payingEvent==="total_permanent_disability");
    const schedule=group.filter(item=>item.scaleGroup);
    if(disability&&schedule.length){
      for(const item of schedule){
        item.supersededBy=disability.title;
        item.status="potentially_applicable";
        item.amountLabel="What this benefit pays";
        item.conditions=[...new Set([...item.conditions,
          "Your policy does not pay a schedule-of-injuries amount for a disability that also qualifies for the Total and Permanent Disability benefit, "
          +"and \u201c"+disability.title+"\u201d is paying instead."])];
        delete (item as {calculatedAmount?:number}).calculatedAmount;
      }
      notes.push("The schedule of injuries is not paid alongside "+(disability.amountText??"the total and permanent disability benefit")
        +" of total and permanent disability cover: the policy says the same disability cannot be claimed under both.");
      continue;
    }
    // The sum insured is a property of the COVER, so every row under it should
    // state the same one. Where they disagree -- a row whose own sub-limit was
    // read as the cover amount, say -- taking whichever happened to be first
    // in the list made the household's total depend on the order its rows came
    // out of the database. The largest is the cover's own figure, and it is
    // the reading that cannot wrongly withhold money.
    const stated=schedule.map(item=>item.coverAmount).filter((amount):amount is number=>
      typeof amount==="number"&&Number.isFinite(amount)&&amount>0);
    if(!stated.length||!schedule.length)continue;
    const cap=Math.max(...stated);
    const total=schedule.reduce((sum,item)=>sum+(item.calculatedAmount??0),0);
    if(total<=cap)continue;
    // Same figure, same order, every time: which row is truncated and which is
    // superseded must not depend on how the rows arrived.
    const ordered=[...schedule].sort((a,b)=>(b.calculatedAmount??0)-(a.calculatedAmount??0)||a.title.localeCompare(b.title));
    let running=0;
    for(const item of ordered){
      const headroom=Math.max(0,cap-running);
      const amount=item.calculatedAmount??0;
      if(headroom<=0){
        item.supersededBy=ordered[0].title;
        item.status="potentially_applicable";
        item.amountLabel="What this benefit pays";
        item.conditions=[...new Set([...item.conditions,
          "Everything the policy pays for injuries from one accident is already accounted for: it caps that total at the sum insured."])];
        delete (item as {calculatedAmount?:number}).calculatedAmount;
        continue;
      }
      if(amount>headroom){
        item.calculatedAmount=headroom;
        item.amountText=formatMoney(headroom,item.currency??"SGD");
        item.conditions=[...new Set([...item.conditions,
          "Reduced from "+formatMoney(amount,item.currency??"SGD")+": your policy caps everything it pays for injuries from one accident at the sum insured of "
          +formatMoney(cap,item.currency??"SGD")+"."])];
        running=cap;
        continue;
      }
      running+=amount;
    }
    notes.push("Everything your policy pays for injuries from one accident is capped at the sum insured, "
      +formatMoney(cap,ordered[0].currency??"SGD")+", so the total is held there rather than added beyond it.");
  }
  return notes;
}

/** Two critical-illness plans under one scheme, both responding.
 *
 * An early-stage plan and a main plan are separate covers, so the arithmetic
 * adds them -- and for two plans genuinely bought as extra cover, that is
 * right. But insurers commonly write the early-stage benefit as an ADVANCE
 * against the main sum rather than as money on top of it, and the word that
 * decides it ("accelerated", or "in addition to") is in the wording rather
 * than in any figure DearPolicy holds.
 *
 * So the total keeps both -- withholding money because a clause MIGHT reduce
 * it is its own kind of wrong answer -- and says exactly what to look for. A
 * death benefit and an accidental death benefit are not treated this way:
 * those genuinely cumulate, and a caveat there would be noise.
 */
export function acceleratedBenefitWarnings(items:ClaimItem[]):string[]{
  const scheme=(coverKey:string)=>coverKey.startsWith("policy:")?coverKey.split("|")[0]:null;
  const groups=new Map<string,ClaimItem[]>();
  for(const item of items){
    if(typeof item.calculatedAmount!=="number"||item.supersededBy)continue;
    if(item.payingEvent!=="critical_illness"&&item.payingEvent!=="terminal_illness")continue;
    const master=item.coverKey?scheme(item.coverKey):null;
    if(!master)continue;
    const key=master+"|"+item.payingEvent;
    groups.set(key,[...(groups.get(key)??[]),item]);
  }
  const notes:string[]=[];
  for(const group of groups.values()){
    if(new Set(group.map(item=>item.coverKey)).size<2)continue;
    const names=group.map(item=>"\u201c"+item.title.split(" \u00b7 ").slice(1).join(" \u00b7 ")+"\u201d").join(" and ");
    notes.push(names+" are separate covers under the same policy, so both are counted. "
      +"Check the wording for the word \u201caccelerated\u201d: where an early-stage or terminal benefit is paid as an advance against the main sum rather than in addition to it, "
      +"the amount settled is the larger of the two rather than the total of both.");
  }
  return notes;
}

/** Where the total came from, cover by cover.
 *
 * A single figure is only checkable if the person can see it broken into the
 * plans it came out of. "S$1,600,000" is an assertion; "S$1,000,000 from your
 * Group Term Life cover and S$600,000 from your Group Personal Accident cover"
 * is something they can hold against their own certificate. */
export function describeCoverSplit(items:ClaimItem[]){
  const byCover=new Map<string,{amount:number;label:string;currency:string}>();
  for(const item of items){
    if(typeof item.calculatedAmount!=="number"||!item.coverKey||item.aggregation!=="additive"||item.supersededBy)continue;
    const existing=byCover.get(item.coverKey);
    byCover.set(item.coverKey,{amount:(existing?.amount??0)+item.calculatedAmount,
      label:existing?.label??item.coverLabel??item.title.split(" \u00b7 ").slice(1).join(" \u00b7 "),
      currency:item.currency??existing?.currency??"SGD"});
  }
  if(byCover.size<2)return null;
  const parts=[...byCover.values()].sort((a,b)=>b.amount-a.amount)
    .map(entry=>formatMoney(entry.amount,entry.currency)+" from your "+entry.label+" cover");
  return parts.slice(0,-1).join(", ")+" and "+parts[parts.length-1];
}
