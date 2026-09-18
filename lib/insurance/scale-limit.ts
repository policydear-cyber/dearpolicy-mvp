import { formatMoney } from "@/lib/format/currency";
import type { CatalogBenefit } from "@/lib/policies/benefit-catalog";

/** Working out what a fracture scale is a percentage OF.
 *
 * A personal accident plan states its fracture scale twice: as percentages in
 * one document ("Hip -- 75%") and as amounts in another ("Hip -- S$3,750").
 * Those percentages are not of the plan's S$600,000 sum insured; they are of a
 * separate fracture benefit limit the table's heading names and the row does
 * not. Applied to the death sum, "20% for a fractured wrist" becomes
 * S$120,000, which is a hundred times the S$1,250 the other document prints.
 *
 * Nothing needs to be read again to resolve it. Wherever the same benefit
 * appears once as an amount and once as a percentage, the limit is the amount
 * divided by the percentage, and the household's own documents state enough
 * pairs to agree on it: S$3,750/75%, S$2,500/50%, S$1,500/30% and S$5,000/100%
 * all say S$5,000. Two independent rows have to agree before the limit is
 * used, and it is then applied only to the percentage rows on the very pages
 * that produced those pairs -- so a dismemberment scale, which really is a
 * percentage of the sum insured, is never touched.
 *
 * The point is not the arithmetic. It is that the person stops being asked to
 * confirm a hundred rows their own documents already answer. */
export type ImpliedScale={limit:number;currency:string;support:number;pages:Set<string>};

function scaleKey(name:string){return (name??"").toLowerCase().replace(/\(.*?\)/g,"").replace(/[^a-z]/g,"");}
function pageKey(benefit:CatalogBenefit){return benefit.policyId+"#"+(benefit.sourcePage??0);}

export function impliedScaleLimit(benefits:CatalogBenefit[]):ImpliedScale|null{
  const byKey=new Map<string,CatalogBenefit[]>();
  for(const benefit of benefits){
    const key=scaleKey(benefit.benefitName);
    if(!key)continue;
    byKey.set(key,[...(byKey.get(key)??[]),benefit]);
  }
  type Candidate={limit:number;key:string;page:string;currency:string};
  const candidates:Candidate[]=[];
  for(const [key,rows] of byKey){
    const amounts=rows.filter(row=>row.formulaKind==="fixed"&&(row.formulaValue??0)>0);
    const shares=rows.filter(row=>row.formulaKind==="sum_insured"&&row.basisInferred
      &&(row.formulaValue??0)>0&&(row.formulaValue??0)<=1);
    for(const amount of amounts)for(const share of shares){
      const limit=Math.round((amount.formulaValue as number)/(share.formulaValue as number));
      if(!Number.isFinite(limit)||limit<100||limit>10_000_000)continue;
      candidates.push({limit,key,page:pageKey(share),currency:amount.currency??"SGD"});
    }
  }
  if(!candidates.length)return null;
  const buckets=new Map<number,Candidate[]>();
  for(const candidate of candidates)buckets.set(candidate.limit,[...(buckets.get(candidate.limit)??[]),candidate]);
  let best:{limit:number;rows:Candidate[]}|null=null;
  for(const [limit,rows] of buckets){
    const distinct=new Set(rows.map(row=>row.key)).size;
    const bestDistinct=best?new Set(best.rows.map(row=>row.key)).size:0;
    if(!best||distinct>bestDistinct||(distinct===bestDistinct&&limit>best.limit))best={limit,rows};
  }
  if(!best)return null;
  const support=new Set(best.rows.map(row=>row.key)).size;
  // One coincidence is not a scale. Two independent rows agreeing is.
  if(support<2)return null;
  return {limit:best.limit,currency:best.rows[0].currency,support,pages:new Set(best.rows.map(row=>row.page))};
}

/** Rewrites the percentage rows the implied limit explains, and leaves every
 * other row exactly as it was. */
export function applyImpliedScaleLimit(benefits:CatalogBenefit[]):CatalogBenefit[]{
  const scale=impliedScaleLimit(benefits);
  if(!scale)return benefits;
  const note="Calculated against the "+formatMoney(scale.limit,scale.currency)+" benefit limit this scale is stated as a percentage of. "
    +"Your own documents give "+scale.support+" of these rows both ways — as a percentage in one and as an amount in another — and they agree on that limit. "
    +"The percentage is not of the plan's sum insured.";
  return benefits.map(benefit=>{
    if(benefit.formulaKind!=="sum_insured"||!benefit.basisInferred)return benefit;
    const share=benefit.formulaValue;
    if(share==null||!(share>0)||share>1)return benefit;
    if(!scale.pages.has(pageKey(benefit)))return benefit;
    return {...benefit,
      formulaKind:"fixed" as const,
      formulaValue:Math.round(share*scale.limit*100)/100,
      currency:benefit.currency??scale.currency,
      basisInferred:false,
      needsConfirmation:false,
      conditions:[...new Set([...benefit.conditions,note])]};
  });
}
