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
function rank(item:ClaimItem){
  return (BASIS_RANK[item.estimateBasis??""]??0)*1_000_000_000+(item.calculatedAmount??0);
}

export function resolveCoverOverlaps(items:ClaimItem[]):OverlapResolution{
  const groups=new Map<string,ClaimItem[]>();
  for(const item of items){
    if(item.aggregation!=="additive")continue;
    if(typeof item.calculatedAmount!=="number"||!Number.isFinite(item.calculatedAmount)||item.calculatedAmount<=0)continue;
    if(!item.coverKey||!item.payingEvent)continue;
    const key=item.coverKey+"|"+item.payingEvent;
    groups.set(key,[...(groups.get(key)??[]),item]);
  }
  const notes:string[]=[];
  for(const group of groups.values()){
    if(group.length<2)continue;
    // The figure taken from the person's own schedule wins over one printed in
    // a booklet for everybody, and only then does size decide. Taking the
    // largest first would have preferred a generic S$1,000,000 over the
    // S$600,000 the certificate actually says is theirs.
    const ordered=[...group].sort((a,b)=>rank(b)-rank(a));
    const kept=ordered[0];
    for(const item of ordered.slice(1)){
      item.supersededBy=kept.title;
      item.status="potentially_applicable";
      item.amountLabel="What this benefit pays";
      item.conditions=[...new Set([...item.conditions,
        "Paid instead of “"+kept.title+"”, not in addition to it: both are paid by the same policy for the same event, so only one of them settles. "
        +"The larger figure on file, "+(kept.amountText??"the other benefit")+", is the one counted."])];
      delete (item as {calculatedAmount?:number}).calculatedAmount;
    }
    const others=ordered.slice(1).map(item=>"“"+item.title.split(" · ").slice(1).join(" · ")+"”").join(", ");
    notes.push("“"+kept.title.split(" · ").slice(1).join(" · ")+"” and "+others+" are the same cover paying on the same event, so "
      +(kept.amountText?kept.amountText+" is counted once":"only one of them is counted")+" rather than added together.");
  }
  return {items,notes};
}

/** What a figure is worth saying out loud when several covers respond. Kept
 * separate from the arithmetic so the wording can change without touching it. */
export function describeCoverSplit(items:ClaimItem[]){
  const byCover=new Map<string,number>();
  for(const item of items){
    if(typeof item.calculatedAmount!=="number"||!item.coverKey||item.aggregation!=="additive")continue;
    byCover.set(item.coverKey,(byCover.get(item.coverKey)??0)+item.calculatedAmount);
  }
  if(byCover.size<2)return null;
  const currency=items.find(item=>item.currency)?.currency??"SGD";
  return [...byCover.values()].map(amount=>formatMoney(amount,currency)).join(" + ");
}
