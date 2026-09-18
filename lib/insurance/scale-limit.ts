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

/** Two documents, read independently, saying the same thing.
 *
 * A rate read from a column heading rather than from the row is held back for a
 * person to confirm, because one reading of one table is not evidence. But this
 * household's dismemberment scale appears in two separate documents, read at
 * different times from different layouts, and both give every row the same
 * percentage. Two independent readings agreeing IS what the confirmation was
 * asking a person to supply, and asking them for it anyway is asking them to do
 * the system's job a hundred times over.
 *
 * So a heading-read rule that two different documents state identically is used
 * without being confirmed, and says on its card that this is why. A rule only
 * one document states still waits, and a rule the two documents disagree about
 * emphatically still waits. */
export function corroborateInferredRules(benefits:CatalogBenefit[]):CatalogBenefit[]{
  const byKey=new Map<string,CatalogBenefit[]>();
  for(const benefit of benefits){
    const key=scaleKey(benefit.benefitName);
    if(!key)continue;
    byKey.set(key,[...(byKey.get(key)??[]),benefit]);
  }
  const corroborated=new Set<string>();
  for(const rows of byKey.values()){
    const inferred=rows.filter(row=>row.needsConfirmation&&row.formulaKind!=="none"&&row.formulaValue!=null);
    if(inferred.length<2)continue;
    const shape=(row:CatalogBenefit)=>row.formulaKind+"|"+row.formulaValue+"|"+(row.currency??"")
      +"|"+(row.offsetDays??"")+"|"+(row.maximumDays??"");
    const agreeing=new Map<string,CatalogBenefit[]>();
    for(const row of inferred)agreeing.set(shape(row),[...(agreeing.get(shape(row))??[]),row]);
    for(const group of agreeing.values()){
      if(new Set(group.map(row=>row.policyId)).size<2)continue;
      // Two documents disagreeing about the same row is the situation
      // confirmation exists for, so nothing in that row is corroborated.
      if(agreeing.size>1)continue;
      for(const row of group)corroborated.add(row.id);
    }
  }
  if(!corroborated.size)return benefits;
  const note="Read from the heading above the row rather than from the row itself, and used anyway: "
    +"two of your documents state this rule identically, which is the agreement the confirmation was asking for.";
  return benefits.map(benefit=>corroborated.has(benefit.id)
    ?{...benefit,needsConfirmation:false,conditions:[...new Set([...benefit.conditions,note])]}
    :benefit);
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

/** Everything the stored rules can resolve about themselves, in order: work out
 * what a percentage scale is a percentage of, then stop asking a person to
 * confirm what two of their own documents already agree on. */
export function resolveStoredRules(benefits:CatalogBenefit[]):CatalogBenefit[]{
  return corroborateInferredRules(applyImpliedScaleLimit(benefits));
}
