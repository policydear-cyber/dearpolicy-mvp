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
/** A row whose table heading prints its base ("Compensation Schedule (% of Sum Insured)") states what its percentage is
 * of: the heading is printed on the page, not a guess. The catalog builder records it as read from the heading
 * (lib/policies/benefit-rows.ts), with this note, and asks a person to confirm it like any heading-read rule, but no
 * limit worked out from ANOTHER document replaces the base its own page prints. The reviewer's reading of the
 * household's two fracture tables (20 Oct): 20% "(% of Sum Insured)" and 25% "(% of S$5,000)" are two different
 * terms, alternatives the insurer decides between, not one scale stated twice. */
export const SUM_INSURED_HEADING_NOTE=/% of the sum insured, from the heading of the schedule this row sits in/i;
export function statesItsOwnBase(benefit:CatalogBenefit){
  return benefit.formulaKind==="sum_insured"&&benefit.conditions.some(c=>SUM_INSURED_HEADING_NOTE.test(c));
}
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
    const shares=rows.filter(row=>row.formulaKind==="sum_insured"&&row.basisInferred&&!statesItsOwnBase(row)
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
    if(benefit.formulaKind!=="sum_insured"||!benefit.basisInferred||statesItsOwnBase(benefit))return benefit;
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
    if(benefit.formulaKind!=="sum_insured"||!benefit.basisInferred||benefit.reviewedAt||statesItsOwnBase(benefit))return benefit;
    if(!documents.has(benefit.policyId))return benefit;
    const family=scheduleFamily(benefit.benefitName);
    if(!family||!families.has(family))return benefit;
    return {...benefit,needsConfirmation:true,conditions:[...new Set([...benefit.conditions,note])]};
  });
}
export function resolveStoredRules(benefits:CatalogBenefit[]):CatalogBenefit[]{
  return holdPlanColumnFigures(holdNonMonotonicBands(holdUnresolvedPercentagesAlongsideAScale(
    corroborateInferredRules(applyImpliedScaleLimit(benefits)))));
}

/** A row of a table that prints one figure per plan ("If you need to return home early  S$5,000  S$10,000  S$15,000",
 * "Reinstatement fees  Not Applicable  S$1,000  S$1,500"), stored with no plan of its own, holds whichever column the
 * reader took, usually the first. Which plan the household holds is not known from the row, so no figure is taken from
 * it: the row is shown with the policy's words. The Coverage ledger
 * already seeds such rows without a figure (lib/ledger/store.ts); chat and the Benefits page now agree with it. A row
 * read for one plan (tier set), or one a person has corrected, is kept as it is. */
export const PLAN_COLUMNS_NOTE="The document prints a different figure for each plan, and which plan is yours is not shown here, so DearPolicy does not take a figure from it.";
// A cell of a plan table: an amount with its currency printed (and the unit each column repeats: "S$100 per day",
// "RM150 sehari", TE pr190 F1), or a plan that does not have the benefit ("Not covered", "Nil", "Tidak dilindungi", F2).
const UNIT=String.raw`(?:\s*(?:\/\s*(?:day|night|week|month|year|visit)|(?:per|each)\s+(?:day|night|week|month|year|visit|trip|claim|incident)|a\s+(?:day|night)|daily|sehari|setiap\s+hari))?`;
const MONEY_CELL=String.raw`(?:S\$|US\$|A\$|HK\$|RM|£|€|\$|(?<![A-Za-z])(?:SGD|USD|MYR|GBP|EUR|AUD|HKD)\s?)\s?\d[\d,]*(?:\.\d+)?`+UNIT;
const NONE_CELL=String.raw`(?:[Nn]ot\s+(?:[Cc]overed|[Aa]pplicable|[Ii]ncluded|[Aa]vailable)|[Ee]xcluded|N\/A|[Nn]il|NIL|[Tt]idak\s+[Dd]ilindungi|[Tt]iada)`;
const PLAN_CELL=`(?:${MONEY_CELL}|${NONE_CELL})`;
const PLAN_ROW=new RegExp(`${PLAN_CELL}(?:\\s+${PLAN_CELL})+`,"g");
// A table whose header prints the currency ("Benefits (S$)") gives bare figures: three or more side by side, each in
// thousands ("250,000 500,000 1,000,000", TE pr190 F4). Two bare figures are as likely a code and an amount.
const BARE_ROW=/(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d{2})?(?:\s+\d{1,3}(?:,\d{3})+(?:\.\d{2})?){2,}(?![\d.,])/g;
const SIGN=/^(?:S\$|US\$|A\$|HK\$|RM|£|€|\$|SGD|USD|MYR|GBP|EUR|AUD|HKD)/;
/** Whether a row's quote prints two or more plan cells side by side that do not all say the same figure. A row whose
 * columns all print one figure ("$3,540 $3,540 $3,540") pays that figure whichever plan is held. Plan columns print one
 * currency and one style: figures in different currencies ("S$1,000,000 US$750,000"), or a pair of a whole figure and one
 * with cents ("Basic Plan S$100,000 S$1,234.56": a sum assured and its premium, TE pr190 F3), are not plans. */
export function figuresDifferByPlan(quote:string|null|undefined):boolean{
  for(const run of String(quote??"").match(PLAN_ROW)??[]){
    const cells=run.match(new RegExp(PLAN_CELL,"g"))??[];
    const money=cells.filter(c=>/\d/.test(c));
    const signs=new Set(money.map(c=>c.trim().match(SIGN)?.[0].replace(/^SGD$/,"S$").replace(/^MYR$/,"RM").replace(/^GBP$/,"£").replace(/^USD$/,"US$")));
    const cents=new Set(money.map(c=>/\d\.\d{2}(?!\d)/.test(c)));
    // A pair whose second figure is a small part of the first ("SGD 100,000.00 SGD 1,234.56", "S$100,000 S$1,234") is a sum
    // and its premium, never two plans (TE pr190 r2 G1). A schedule prints the sum first: a larger second figure ("S$40,000
    // S$1,000,000") is a higher plan's column (TE pr190 r3 D41).
    const amounts=money.map(c=>Number(c.replace(/\s*(?:\/|per\b|each\b|a\s|daily|sehari|setiap).*$/i,"").replace(/[^\d.]/g,"")));
    const pairOfSumAndPremium=money.length===2&&cells.length===2&&amounts[1]<amounts[0]&&(cents.size>1||amounts[1]<0.05*amounts[0]);
    if(signs.size>1||pairOfSumAndPremium)continue;
    const values=new Set(cells.map(c=>/\d/.test(c)?c.replace(/\s*(?:\/|per\b|each\b|a\s|daily|sehari|setiap).*$/i,"").replace(/[^\d.]/g,"").replace(/\.0+$/,""):"none"));
    if(cells.length>1&&values.size>1)return true;
  }
  for(const run of String(quote??"").match(BARE_ROW)??[])if(new Set(run.split(/\s+/).map(v=>v.replace(/\.00$/,""))).size>1)return true;
  return false;
}
// One money figure with its currency. A schedule term that prints two or more different figures in one currency is
// held unless every later figure carries its own unit or says it is part of the first ("S$300 per trip, S$1,500 per
// year", "S$150,000, of which S$5,000 for outpatient"). Plans are printed in too many ways to list (labels, pipes,
// "Gold - S$500,000", "for Basic and ... for Premier", "respectively", TE pr361 r2), so a term fails closed instead.
const SIGNED_FIGURE=/(S\$|US\$|A\$|HK\$|RM|£|€|\$|(?<![A-Za-z])(?:SGD|USD|MYR|GBP|EUR|AUD|HKD))\s?(\d[\d,]*(?:\.\d+)?)(?![\d,]*\d)/g;
const CURRENCY_OF:Record<string,string>={SGD:"S$",USD:"US$",MYR:"RM",GBP:"£",EUR:"€",AUD:"A$",HKD:"HK$"};
const OWN_UNIT_AFTER=/^\s*\(?\s*(?:(?:per|each|every|an?)\s+(?!plans?\b)([a-z]+(?:\s+(?:year|day|trip|claim|person|visit|disability|period|illness|injury|item|event|incident))?)|\/\s*(day|night|week|month|year|visit|trip|claim|person|item|event|incident)\b|(daily|weekly|monthly|annually|yearly)\b)/iu;
const PART_OF_FIRST_BEFORE=/(?:\bof\s+which|\bwithin\s+which|\bincluding|\bsub-?limit(?:\s+of)?)[\s:,]*(?:up\s+to\s+|a\s+maximum\s+of\s+)?$/iu;
const ADVERB_UNIT:Record<string,string>={daily:"day",weekly:"week",monthly:"month",annually:"year",yearly:"year"};
/** Whether a schedule term's quote may print a figure for each plan (TE pr361; Critic R361b M2, L1): side-by-side cells
 * (figuresDifferByPlan), or two different figures in one currency with the same unit, or both with none ("Gold -
 * S$500,000, Silver - S$250,000", "S$200 per trip | S$500 per trip"). One plan's figures each carry a unit of their own
 * ("S$300 per trip, S$1,500 per year") or say they are part of another ("of which S$5,000"). A term like this is no
 * person's limit until their plan is known, on Benefits and Portfolio alike. Benefit rows are not judged by this: a
 * benefit's own sub-items ("Ward S$300; ICU S$600") are one plan's figures (Critic R361b M1). */
export function termFiguresDifferByPlan(quote:string|null|undefined):boolean{
  const text=String(quote??"");
  if(figuresDifferByPlan(text))return true;
  const figures=[...text.matchAll(SIGNED_FIGURE)].flatMap(m=>{
    const start=m.index!,end=start+m[0].length;
    if(PART_OF_FIRST_BEFORE.test(text.slice(0,start)))return [];
    const u=text.slice(end).match(OWN_UNIT_AFTER);
    const unit=u?(u[1]??u[2]??ADVERB_UNIT[u[3].toLowerCase()]).toLowerCase().replace(/^policy\s+/,"").replace(/\s+/g," "):"";
    return [{key:`${CURRENCY_OF[m[1]]??m[1]}|${unit}`,value:m[2].replace(/,/g,"").replace(/\.0+$/,"")}];
  });
  const values=new Map<string,Set<string>>();
  for(const f of figures)values.set(f.key,(values.get(f.key)??new Set()).add(f.value));
  return [...values.values()].some(v=>v.size>1);
}
/** A "benefit" whose name is only a plan's empty cell ("Not covered", "N/A") and whose quote begins with that name
 * followed by the other plans' cells ("Not covered S$500 S$1,000"): the reader took the first cell of a plan-table row
 * as its name, so the row's own name is lost and it names nothing. A name like this with any other quote is kept. */
export function namesOnlyAPlanCell(name:string|null|undefined,quote:string|null|undefined):boolean{
  const n=spaced(String(name??"")).replace(/[.:]+$/,"");
  if(!n||!new RegExp(`^${NONE_CELL}$`).test(n))return false;
  const q=spaced(String(quote??""));
  if(!q.startsWith(n))return false;
  const runs=q.match(PLAN_ROW)??[];
  return runs.length===1&&runs[0]===q;
}
export function holdPlanColumnFigures(benefits:CatalogBenefit[]):CatalogBenefit[]{
  // A schedule term (a limit, a deductible) is held the same way: its stored figure may be the first plan's column (FWD
  // re-read 5 Nov: "Overall limit S$300 S$800 S$1,500" shown as a limit of S$300 for a Business plan holder).
  return benefits.map(benefit=>!benefit.tier&&!benefit.reviewedAt&&(benefit.formulaKind!=="none"||(!!benefit.rowKind&&benefit.rowKind!=="benefit"))&&benefit.formulaValue!=null&&(benefit.rowKind&&benefit.rowKind!=="benefit"?termFiguresDifferByPlan(benefit.quote):figuresDifferByPlan(benefit.quote))
    ?{...benefit,formulaKind:"none" as CatalogBenefit["formulaKind"],formulaValue:null,conditions:[...new Set([...benefit.conditions,PLAN_COLUMNS_NOTE])]}
    :benefit);
}
/** A plan-table row's own plan column, from the benefit table's checked reading of the same page: the household's plan
 * ("The Business column matches the held Business plan") and the figure it prints there. Taken only when every reading
 * of that page that prints this row (its own words, then its cells, and no other run of cells: a neighbouring row's
 * reading never lends its figure, TE #197 H1, Critic R370) names one column, a printed figure in the row's own currency
 * that is one of its cells, and no qualifier ("per family", "child"); anything else gives no figure (the row stays held,
 * PLAN_COLUMNS_NOTE).
 *
 * A reading may quote only the row's cells ("S$500,000  S$750,000  S$1,000,000") with the row's words read as its
 * benefit name instead. Such a reading is taken only when the run of cells is the page's alone on both sides: no other
 * stored row of the page prints the same cells (the caller says so with runIsUnique), and every reading of the page that
 * prints them quotes nothing but the cells and names one benefit, whose name shares a naming word with the row's. Any reading that prints them with other words gives
 * none, as above. */
export type PlanColumnReading={documentId:string;page:number;excerpt:string;column:string|null;qualifier:string|null;
  figure:{kind:string;amount?:number;currency?:string|null};figureText:string;benefit?:string};
const spaced=(text:string)=>text.replace(/\s+/g," ").trim();
const cellAmount=(cell:string)=>Number(cell.replace(/\s*(?:\/|per\b|each\b|a\s|daily|sehari|setiap).*$/i,"").replace(/[^\d.]/g,""));
const CELL_CODE:Record<string,string>={"S$":"SGD",SGD:"SGD","US$":"USD",USD:"USD",RM:"MYR",MYR:"MYR","£":"GBP",GBP:"GBP","€":"EUR",EUR:"EUR","HK$":"HKD",HKD:"HKD","A$":"AUD",AUD:"AUD"};
/** A quote's one run of plan cells, spaced, or null when it prints none or more than one. */
export function planCellRun(quote:string|null|undefined):string|null{
  const runs=spaced(String(quote??"")).match(PLAN_ROW)??[];
  return runs.length===1?runs[0]:null;
}
/** Words that name no particular benefit: two benefits of one travel table share them ("… while on your trip"). */
const GENERIC_WORD=/^(?:with|from|that|this|will|your|while|trips?|travel(?:l?ing)?|overseas|abroad|journey|during|benefits?|cover(?:ed|age)?|insured|insurance|policy|plan|persons?|people|others?|each|also|have|been|under|upon|after|before|which|where|when|such|what|them|they|their|there|into|only|more|than|made|make|paid|pays|payable|amounts?|maximum|limits?|items?)$/;
/** The first four letters of each word that names something ("liable" and "liability" share "liab"). */
const nameStems=(text:string)=>new Set((text.toLowerCase().match(/[a-z]{4,}/g)??[]).filter(w=>!GENERIC_WORD.test(w)).map(w=>w.slice(0,4)));
export function planColumnFigure(row:{policyId:string;sourcePage:number|null;quote:string|null;benefitName?:string|null},readings:PlanColumnReading[],
  o:{runIsUnique?:boolean}={}):{plan:string;figureText:string}|null{
  const quote=spaced(String(row.quote??""));
  const runs=quote.match(PLAN_ROW)??[];
  if(runs.length!==1||row.sourcePage==null)return null;
  const run=runs[0];
  // The row's own last words before its cells: the reading must print them right before the same cells.
  const words=quote.slice(0,quote.indexOf(run)).trim().split(" ").filter(Boolean).slice(-3).join(" ");
  if(!words)return null;
  const money=(run.match(new RegExp(PLAN_CELL,"g"))??[]).filter(c=>/\d/.test(c));
  const codes=new Set(money.map(c=>CELL_CODE[c.trim().match(SIGN)?.[0]??""]??null));
  const code=codes.size===1?[...codes][0]:null;
  if(!code)return null;
  const cells=money.map(cellAmount);
  const onPage=readings.filter(r=>r.documentId===row.policyId&&r.page===row.sourcePage);
  // A page's text layer may print a row's cells before its words ("S$500 S$1,000 S$1,500\nIf you have to postpone your
  // trip"), so a reading may quote the row that way round. Taken only when the reading prints this row's own cells
  // right before the row's own first words, prints no other run of cells, and is a reading of this row's benefit (its
  // name shares a naming word with the row's, as below).
  const lead=quote.slice(0,quote.indexOf(run)).trim().split(" ").filter(Boolean).slice(0,3).join(" ");
  const own=nameStems((row.benefitName??"")+" "+quote.slice(0,quote.indexOf(run)));
  const ofThisRow=(r:PlanColumnReading)=>[...nameStems(r.benefit??"")].some(w=>own.has(w));
  let found=onPage.filter(r=>{
    const excerpt=spaced(r.excerpt);
    if((excerpt.match(PLAN_ROW)??[]).length!==1)return false;
    return excerpt.includes(words+" "+run)||(excerpt.includes(run+" "+lead)&&ofThisRow(r));
  });
  if(!found.length&&o.runIsUnique){
    const printing=onPage.filter(r=>spaced(r.excerpt).includes(run));
    const cellsOnly=printing.every(r=>spaced(r.excerpt)===run);
    const names=new Set(printing.map(r=>spaced(r.benefit??"")));
    // The reading's benefit must be this row's: its name shares a naming word with the row's name or words, so a
    // reading of another benefit whose row was not stored never lends its cells (TE pr200 G6, Critic R389 L1).
    const ours=[...names].every(n=>[...nameStems(n)].some(w=>own.has(w)));
    if(cellsOnly&&names.size===1&&!names.has("")&&ours)found=printing;
  }
  if(!found.length)return null;
  const picks=new Set(found.map(r=>{
    const column=(r.column??"").trim();
    return column&&!r.qualifier&&r.figure.kind==="printed"&&r.figure.amount!=null&&cells.includes(r.figure.amount)&&r.figure.currency===code
      ?JSON.stringify([column,r.figureText]):"none";
  }));
  if(picks.size!==1||picks.has("none"))return null;
  const [plan,figureText]=JSON.parse([...picks][0]) as [string,string];
  return {plan,figureText};
}
/** A plan-table row's name as shown, without the first plan's empty cell the reader ran into it ("Reinstatement fees
 * for frequent flyer miles Not Applicable", quote "… miles Not Applicable S$1,000 S$1,500"): beside the household's plan
 * figure, the name would say the benefit does not apply. Taken off only when the quote prints the name's words, then
 * that cell opening its one run of plan cells, the run prints a money cell, and the household's own plan has a figure
 * in it; any other name is shown as stored. Display only: the stored name is
 * what rules and links key on. */
export function nameWithoutPlanCell(name:string,quote:string|null|undefined,o:{householdFigure:boolean}={householdFigure:false}):string{
  // Only beside a figure of the household's own plan: if their plan's cell is the empty one, the cell is what the name
  // should say (Critic R394 M2).
  if(!o.householdFigure)return name;
  const n=name.replace(/\s+/g," ").trim(),q=String(quote??"").replace(/\s+/g," ").trim();
  const cell=n.match(new RegExp(`\\s(${NONE_CELL})$`))?.[1];
  if(!cell)return name;
  const words=n.slice(0,n.length-cell.length).trim();
  const runs=q.match(PLAN_ROW)??[];
  if(!words||runs.length!==1||!runs[0].startsWith(cell)||q!==`${words} ${runs[0]}`)return name;
  // A row of empty cells only ("Cosmetic surgery Excluded Excluded Excluded") keeps its cell: without it the name reads as
  // covered (TE pr204 K1/K2).
  if(!(runs[0].match(new RegExp(PLAN_CELL,"g"))??[]).some(c=>/\d/.test(c)))return name;
  return words;
}
