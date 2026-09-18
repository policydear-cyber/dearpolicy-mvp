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

/** A scale that pays LESS for a worse injury was misread.
 *
 * A burns table runs one way: the more of the body burnt, the more it pays.
 * This household's reads "10% or more of the body -- 50%" and then "15% or more
 * -- 30%", which no insurer wrote. Two tables on one page have been interleaved,
 * or a column has drifted, and the rows carry the largest percentages in the
 * plan, so getting them wrong is expensive in the direction that matters.
 *
 * Nothing here guesses at the right order. The rows are simply held back for a
 * person to confirm, whatever else corroborated them, with the reason said out
 * loud -- because "this scale pays less for a worse injury" is a fact about the
 * reading, not about the policy. */
const BAND_BOUND=/greater than\s*(\d+(?:\.\d+)?)\s*%/i;
function bandGroup(benefit:CatalogBenefit){
  const name=benefit.benefitName??"";
  if(!BAND_BOUND.test(name))return null;
  // Everything the row says BEFORE the band itself: which burns table, and
  // which part of the body. Two bands only belong to one scale when both of
  // those agree, and a row that says neither is its own unlabelled group --
  // which is the shape that used to make three tables look like one.
  const prefix=name.slice(0,name.search(/equals? to or greater than/i))
    .toLowerCase().replace(/[^a-z]+/g," ").trim();
  return benefit.policyId+"#"+(benefit.sourcePage??0)+"#"+prefix;
}
export function holdNonMonotonicBands(benefits:CatalogBenefit[]):CatalogBenefit[]{
  const groups=new Map<string,CatalogBenefit[]>();
  for(const benefit of benefits){
    if(benefit.formulaValue==null||benefit.formulaKind==="none")continue;
    const group=bandGroup(benefit);
    if(!group)continue;
    groups.set(group,[...(groups.get(group)??[]),benefit]);
  }
  const held=new Set<string>();
  for(const rows of groups.values()){
    if(rows.length<2)continue;
    const ordered=[...rows].sort((a,b)=>
      Number(BAND_BOUND.exec(a.benefitName)![1])-Number(BAND_BOUND.exec(b.benefitName)![1]));
    const falls=ordered.some((row,index)=>index>0&&(row.formulaValue as number)<(ordered[index-1].formulaValue as number));
    if(falls)for(const row of ordered)held.add(row.id);
  }
  if(!held.size)return benefits;
  const note="This scale pays less for a worse injury than for a lesser one, which no insurer writes, "
    +"so DearPolicy has read it wrong \u2014 two tables on one page, or a column out of line. "
    +"It will not calculate from these rows until someone checks them against the page.";
  return benefits.map(benefit=>held.has(benefit.id)&&!benefit.reviewedAt
    ?{...benefit,needsConfirmation:true,conditions:[...new Set([...benefit.conditions,note])]}
    :benefit);
}

/** Everything the stored rules can resolve about themselves, in order: work out
 * what a percentage scale is a percentage of, then stop asking a person to
 * confirm what two of their own documents already agree on. */
export function resolveStoredRules(benefits:CatalogBenefit[]):CatalogBenefit[]{
  return holdNonMonotonicBands(corroborateInferredRules(applyImpliedScaleLimit(benefits)));
}
