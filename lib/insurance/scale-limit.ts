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

/** Two rows naming the same benefit, however the two documents punctuate it.
 *
 * Digits are kept. Dropping them made every band of a burns table the same
 * row -- "15% but less than 25%" and "25% but less than 40%" both reduce to
 * "equalstoorgreaterthanbutlessthan" -- so two documents stating an identical
 * scale looked like two documents contradicting each other, and every band
 * stayed waiting for a person to confirm what both of their documents already
 * said. Bracketed text is still dropped, because "(Other Fracture)" is how one
 * document annotates what the other states plainly. */
function scaleKey(name:string){return (name??"").toLowerCase().replace(/\(.*?\)/g,"").replace(/[^a-z0-9]/g,"");}
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
  const ranked=[...buckets.entries()]
    .map(([limit,rows])=>({limit,rows,support:new Set(rows.map(row=>row.key)).size}))
    .sort((a,b)=>b.support-a.support||b.limit-a.limit);
  const best=ranked[0];
  if(!best)return null;
  // One coincidence is not a scale. Two independent rows agreeing is.
  if(best.support<2)return null;
  // Two limits supported equally well is not weak evidence for the better one;
  // it is the documents contradicting each other, and there is no reading of
  // them that settles it. Taking the higher one made a fractured wrist worth
  // eight times what the household's own schedule prints. So nothing is
  // inferred, the rows stay waiting for a person, and the one question they
  // are asked is the one their documents genuinely do not answer.
  if(ranked.length>1&&ranked[1].support===best.support)return null;
  return {limit:best.limit,currency:best.rows[0].currency,support:best.support,
    pages:new Set(best.rows.map(row=>row.page))};
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
/** Two documents agreeing on a PERCENTAGE is not two documents agreeing on
 * what the percentage is OF.
 *
 * Corroboration exists so a household is not asked to confirm a hundred rows
 * their own documents already answer twice over. But where this household also
 * states the same schedule in dollars -- so an implied limit was derived at
 * all -- the open question about every other heading-read percentage in that
 * document is exactly the one corroboration cannot answer. Both documents say
 * "Fractured leg or patella 20%"; neither says 20% of what, and read against
 * the accident sum insured that row pays S$120,000 for a bone the same
 * schedule prices at S$2,500 two pages later.
 *
 * So where a limit was derived, the rows it did not rewrite stay for a person
 * to settle. They are still shown; they are not calculated from. */
/** Which schedule a row belongs to. A policy states several: a dismemberment
 * scale that really is a percentage of the sum insured, a burns table, and a
 * fracture table that is a percentage of its own small limit. Only rows of the
 * schedule the limit was derived FROM are in dispute; holding the others back
 * as well stopped a lost thumb being worth anything at all. */
function scheduleFamily(name:string){
  const text=(name??"").toLowerCase();
  if(/\bburns?\b|\bscald/.test(text))return "burns";
  if(/\bfractur|\bfull break\b|non-union|\bshortening of\b|\bdislocat/.test(text))return "fracture";
  if(/\bloss of\b|\bpermanent total loss\b|\bamputat|\bdismember|insanity/.test(text))return "dismemberment";
  return null;
}
function holdUnresolvedPercentagesAlongsideAScale(benefits:CatalogBenefit[]):CatalogBenefit[]{
  const scale=impliedScaleLimit(benefits);
  if(!scale)return benefits;
  const documents=new Set([...scale.pages].map(page=>page.split("#")[0]));
  // The schedules the limit was actually derived from.
  const families=new Set(benefits.filter(benefit=>scale.pages.has(benefit.policyId+"#"+(benefit.sourcePage??0)))
    .map(benefit=>scheduleFamily(benefit.benefitName)).filter((family):family is NonNullable<ReturnType<typeof scheduleFamily>>=>!!family));
  if(!families.size)return benefits;
  const note="Your documents state this scale as a percentage in one place and in dollars in another. "
    +"DearPolicy worked out the dollar figures it could prove and is holding this row back: "
    +"the page it came from does not say what the percentage is of, and reading it against the plan's sum insured "
    +"would price it far above what the same schedule pays elsewhere.";
  return benefits.map(benefit=>{
    if(benefit.formulaKind!=="sum_insured"||!benefit.basisInferred||benefit.reviewedAt)return benefit;
    if(!documents.has(benefit.policyId))return benefit;
    const family=scheduleFamily(benefit.benefitName);
    if(!family||!families.has(family))return benefit;
    return {...benefit,needsConfirmation:true,conditions:[...new Set([...benefit.conditions,note])]};
  });
}
export function resolveStoredRules(benefits:CatalogBenefit[]):CatalogBenefit[]{
  return holdNonMonotonicBands(holdUnresolvedPercentagesAlongsideAScale(
    corroborateInferredRules(applyImpliedScaleLimit(benefits))));
}
