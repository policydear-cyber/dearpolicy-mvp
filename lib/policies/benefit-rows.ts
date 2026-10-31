import { explicitCurrency } from "@/lib/chat/policy-analysis";
import { normalizeCurrencyCode } from "@/lib/format/currency";
import { linesFromStoredText } from "@/lib/documents/layout";
import type { CatalogFormulaKind } from "./benefit-catalog";

/** Reading the "what it pays" cell of a benefit schedule.
 *
 * Now that a page is read as a table, the payout rule is not buried in prose —
 * it is a short cell next to the benefit's name: "25% of S$5,000", "Up to
 * S$500 per incident", "S$30 per day". Those are a small, closed grammar, so
 * they are parsed in plain code. No model, no quote-shaped regexes over whole
 * paragraphs, and the same cell always yields the same rule.
 *
 * Anything outside the grammar returns null and is left for review rather than
 * guessed at. */
export type ParsedBenefitValue={
  kind:Exclude<CatalogFormulaKind,"none">;
  value:number;
  /** Only a currency written in the cell/heading itself; null when none is
   * (never defaulted to SGD). */
  currency:string|null;
  /** Set when a percentage was applied to a limit printed in the same cell, so
   * the reasoning can be shown back to the user. */
  basis?:string;
  /** True when the rule came from a HEADING above the row rather than from the
   * row itself. Weaker evidence: the same fracture table appears in one of this
   * household's documents under "(% of Sum Insured)" and in another under
   * "(% of S$5,000)", which differ by a factor of 120. A rule read this way is
   * shown to the person for confirmation and never turned into money first. */
  inferred?:boolean;
  period?:"day"|"month"|"year"|"week";
};
const NUMBER=String.raw`\d[\d,]*(?:\.\d{1,2})?`;
// Any printed currency marker in front of the figure (S$, US$, HK$, SGD, USD,
// EUR, RM, €, £ …). The marker only locates the number; the currency itself
// is read by statedCode() from what is printed, never defaulted.
// Round 10: a figure a scan printed unclearly ("S$5O,000", "S$2,l84") is not a
// figure at all -- never "S$5" or "S$2" (see lib/documents/messy.ts).
const MONEY=String.raw`(?:(?:US|S|SG|A|AU|HK|NZ|C|CA)?\$|SGD|USD|EUR|GBP|AUD|HKD|MYR|NZD|CAD|JPY|CNY|RM|€|£|¥)\s?(${NUMBER})(?![,.]?[OoIl|])`;
function amount(raw:string|undefined){
  if(!raw)return null;
  const value=Number(raw.replace(/,/g,""));
  return Number.isFinite(value)&&value>=0?value:null;
}
/** A schedule of bare percentages states its basis once, in a heading:
 * "Schedule of Indemnities (% of Sum Insured)", "Compensation (% of S$5,000)".
 * Without it a cell reading "50%" is fifty percent of nothing, which is why a
 * personal-accident schedule — the most common benefit table there is — used to
 * yield no amounts at all. The heading is printed on the page, so this is
 * reading, not inferring.
 *
 * Only a heading-shaped cell counts, and it applies only to rows BELOW it, so a
 * sentence mentioning the sum insured never turns every stray percentage on the
 * page into a payout, and two tables on one page keep their own bases. */
/** The currency code written in `text`, or null when none is. */
export function statedCurrencyCode(text:string):string|null{return statedCode(text);}
function statedCode(text:string):string|null{
  const q=explicitCurrency(text)??printedMarker(text);
  if(!q)return null;
  // No fallback: a marker that does not resolve to a real ISO code stays null.
  const code=normalizeCurrencyCode(q,"");
  return /^[A-Z]{3}$/.test(code)?code:null;
}
/** Markers explicitCurrency() does not know: RM, ₹, ₱, ฿, ₩, ₫, Rp, NT$, HK$, A$/AU$, SG$, NZ$, C$/CA$.
 * A bare "$" is deliberately NOT a currency -- it stays null. */
function printedMarker(text:string):string|null{
  if(/(?:^|[^A-Za-z])RM\s?\d/.test(text))return "MYR";
  // Signs of one currency only (TE #145 India parity). "Rs" is left out: rupees of several countries print it.
  if(/₹\s?\d/.test(text))return "INR";
  if(/₱\s?\d/.test(text))return "PHP";
  if(/฿\s?\d/.test(text))return "THB";
  if(/₩\s?\d/.test(text))return "KRW";
  if(/₫|\d\s?₫/.test(text))return "VND";
  if(/(?:^|[^A-Za-z])Rp\.?\s?\d/.test(text))return "IDR";
  if(/\bNT\$/.test(text))return "TWD";
  if(/\bHK\$/i.test(text))return "HKD";
  if(/\bAU?\$/.test(text))return "AUD";
  if(/\bSG\$/i.test(text))return "SGD";
  if(/\bNZ\$/i.test(text))return "NZD";
  if(/\bCA?\$/.test(text))return "CAD";
  return null;
}
/** An amount with its stated currency; without one, the figure is labelled as
 * having no stated currency rather than being given a guessed one. */
function moneyLabel(currency:string|null,value:number){return currency?currency+" "+value.toLocaleString("en-SG"):value.toLocaleString("en-SG")+" (currency not stated)";}
export type PercentageBasis={kind:"sum_insured"}|{kind:"limit";amount:number;currency:string|null};
const OF_SUM_INSURED=/^\(?\s*(?:in\s+|as\s+a\s+)?(?:%|percent(?:age)?s?)\s*(?:of|based on)\s*(?:the\s+)?(?:sum\s+(?:insured|assured)|insured\s+amount|principal\s+sum|benefit\s+amount)\s*\)?[.:]?$/i;
const OF_LIMIT=new RegExp(String.raw`^\(?\s*(?:in\s+|as\s+a\s+)?(?:%|percent(?:age)?s?)\s*(?:of|based on)\s*(?:the\s+)?`+MONEY+String.raw`\s*\)?[.:]?$`,"i");
function headingBasis(cell:string):PercentageBasis|null{
  const text=cell.replace(/\s+/g," ").trim();
  if(text.length>70||text.length<6)return null;
  if(OF_SUM_INSURED.test(text))return {kind:"sum_insured"};
  const limit=text.match(OF_LIMIT);
  const value=amount(limit?.[1]);
  if(value!=null&&value>0)return {kind:"limit",amount:value,currency:statedCode(text)};
  return null;
}
/** Every basis heading on the page, with the line it appears on.
 *
 * A narrow column wraps its own heading: "Schedule of Indemnities  (% of Sum" /
 * "Insured)". The two halves are read together so the table below is still
 * understood. */
export function percentageBases(pageText:string){
  const lines=linesFromStoredText(pageText);
  const bases:{index:number;basis:PercentageBasis}[]=[];
  for(const [index,line] of lines.entries()){
    const following=lines[index+1]?.cells.join(" ")??"";
    let found:PercentageBasis|null=null;
    for(const cell of line.cells){
      found=headingBasis(cell)??(following&&cell.length<45?headingBasis(cell+" "+following):null);
      if(found)break;
    }
    if(found)bases.push({index,basis:found});
  }
  return bases;
}
/** The nearest basis heading above this row. */
export function basisForRow(bases:{index:number;basis:PercentageBasis}[],rowIndex:number){
  let found:PercentageBasis|null=null;
  for(const entry of bases){if(entry.index<=rowIndex)found=entry.basis;else break;}
  return found;
}
export function parseBenefitValue(cell:string,options?:{percentageBasis?:PercentageBasis|null}):ParsedBenefitValue|null{
  const text=(cell??"").replace(/\s+/g," ").trim();
  if(!text||text.length>80)return null;
  const currency=statedCode(text);
  const lower=text.toLowerCase();
  // Never treat a deduction or a range as a payout rule.
  if(/\b(?:less|minus|after deducting|co-?insurance|deductible|excess of|to\s+\$)\b/.test(lower))return null;
  // A cell cut off mid-phrase — "15% of Sum Insured or" continues "up to
  // S$50,000, whichever is lesser" on the next line — states half a rule, and
  // half a rule is a wrong number rather than a missing one.
  if(/\b(?:or|and|plus|whichever|subject)$/.test(lower))return null;
  // "15% of Sum Insured or up to S$50,000, whichever is lesser" is a choice
  // between two figures. DearPolicy does not model that, so it says so instead
  // of quietly returning the larger one.
  if(/whichever/.test(lower))return null;

  // "25% of S$5,000" — a percentage of a limit printed right there. Both halves
  // are on the page, so the figure is computable with nothing else.
  const ofLimit=lower.match(new RegExp(String.raw`^(${NUMBER})\s*%\s*of\s*(?:the\s+)?`+MONEY.toLowerCase().replace("s?\\$","s?\\$"),"i"))
    ??text.match(new RegExp(String.raw`^(${NUMBER})\s*%\s*of\s*(?:the\s+)?`+MONEY,"i"));
  if(ofLimit){
    const percent=amount(ofLimit[1]),limit=amount(ofLimit[2]);
    if(percent!=null&&limit!=null&&percent<=100)
      return {kind:"fixed",value:Math.round(limit*(percent/100)*100)/100,currency,
        basis:ofLimit[1]+"% of the "+moneyLabel(currency,limit)+" limit printed in the schedule"};
  }
  // "100% of the Sum Insured" — needs the person's own schedule to become money.
  const ofSum=text.match(new RegExp(String.raw`^(${NUMBER})\s*%\s*of\s*(?:the\s+)?(?:relevant\s+|applicable\s+|full\s+|prevailing\s+|current\s+)?(?:sum\s+(?:insured|assured)|coverage\s+amount|benefit\s+amount|insured\s+amount)`,"i"));
  if(ofSum){
    const percent=amount(ofSum[1]);
    if(percent!=null&&percent<=200)return {kind:"sum_insured",value:percent/100,currency,basis:ofSum[1]+"% of the sum insured on the schedule"};
  }
  // A bare "50%" in a schedule whose heading says what the percentage is of.
  const heading=options?.percentageBasis;
  if(heading){
    const bare=text.match(/^(\d{1,3}(?:\.\d{1,2})?)\s*%$/);
    const percent=amount(bare?.[1]);
    if(percent!=null&&percent>0&&percent<=200){
      if(heading.kind==="sum_insured")
        return {kind:"sum_insured",value:percent/100,currency,inferred:true,
          basis:bare![1]+"% of the sum insured, from the heading of the schedule this row sits in"};
      return {kind:"fixed",value:Math.round(heading.amount*(percent/100)*100)/100,currency:heading.currency,inferred:true,
        basis:bare![1]+"% of the "+moneyLabel(heading.currency,heading.amount)+" limit stated in the heading of this schedule"};
    }
  }
  // "Up to S$500 per incident" — a reimbursement ceiling, never a payout.
  const cap=text.match(new RegExp(String.raw`^(?:(?:reimbursed\s+)?up\s+to|max(?:imum)?(?:\s+of)?|not\s+exceed(?:ing)?|limited\s+to|subject\s+to\s+a?\s*(?:limit\s+of)?)\s*`+MONEY,"i"));
  if(cap){
    const limit=amount(cap[1]);
    if(limit!=null)return {kind:"expense_cap",value:limit,currency,basis:"reimbursed up to the "+moneyLabel(currency,limit)+" limit"};
  }
  // "S$30 per day" / "$689/month"
  // A rate printed with no currency at all ("150 per day") is still the rate
  // the schedule states; it is kept with currency null -- never given one.
  const periodic=text.match(new RegExp("^"+MONEY+String.raw`\s*(?:per|/|a)\s*(day|night|week|month|year)`,"i"))
    ??text.match(new RegExp(String.raw`^(${NUMBER})\s*(?:per|/|a)\s*(day|night|week|month|year)\b`,"i"));
  if(periodic){
    const rate=amount(periodic[1]);
    const unit=periodic[2].toLowerCase()==="night"?"day":periodic[2].toLowerCase() as ParsedBenefitValue["period"];
    if(rate!=null)return unit==="day"
      ?{kind:"daily",value:rate,currency,period:"day",basis:moneyLabel(currency,rate)+" for each day"}
      :{kind:"fixed",value:rate,currency,period:unit,basis:moneyLabel(currency,rate)+" each "+unit};
  }
  // A bare figure in the limit column.
  // "S$50,000 payable on 2040-06-01" / "payable at maturity": the figure is
  // the benefit; when it is paid stays in the quoted row.
  const flat=text.match(new RegExp("^"+MONEY+String.raw`(?:\s*(?:per|each)\s+[a-z ]{3,20}|,?\s*(?:payable|paid)\s+(?:on|at|upon)\s+(?:the\s+)?(?:maturity(?:\s+date)?|death|expiry|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}\s+[a-z]{3,9}\s+\d{4}))?$`,"i"));
  if(flat){
    const value=amount(flat[1]);
    if(value!=null)return {kind:"fixed",value,currency,basis:"the amount printed in the schedule"};
  }
  return null;
}

/** Which reported expense a reimbursement row is compared against. Only a label
 * that clearly names a cost gets bound; anything else stays unbound and the
 * answer asks for the amount instead of guessing which bill it means. */
export function expenseFactKey(label:string){
  const text=label.toLowerCase();
  if(/ambulance/.test(text))return "ambulanceBill";
  if(/hospital|inpatient|in-patient|ward|room and board|confinement/.test(text))return "hospitalBill";
  if(/vehicle|motor|car|repair/.test(text))return "vehicleRepairBill";
  if(/\b(?:bill|cost|charge|expense|fee|reimburs)/.test(text))return "outOfPocket";
  return null;
}
/** A daily benefit's waiting period and cap, when the row itself states them. */
export function dailyLimitsFrom(line:string){
  const text=line.replace(/\s+/g," ").toLowerCase();
  const after=text.match(/after (?:the )?(\d+)(?:st|nd|rd|th)? (?:day|night)/)?.[1];
  const from=text.match(/from (?:the )?(\d+)(?:st|nd|rd|th) (?:day|night)/)?.[1];
  const cap=text.match(/(?:max(?:imum)?(?: of)?|up to|not exceed(?:ing)?)\s*(\d{1,4})\s*(?:continuous |consecutive |payable )?(?:days|nights)/)?.[1];
  return {
    offsetDays:after!=null?Number(after):from!=null?Number(from)-1:0,
    maximumDays:cap!=null?Number(cap):null,
  };
}
