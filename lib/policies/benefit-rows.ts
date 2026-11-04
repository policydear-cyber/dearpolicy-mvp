import { FIGURE_END, NO_SCALE_AFTER, PRINTED_FIGURE, groupsInLakhs, printedNumber } from "@/lib/format/printed-number";
import { explicitCurrency } from "@/lib/chat/policy-analysis";
import { isIsoCurrency, normalizeCurrencyCode } from "@/lib/format/currency";
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
// The figure is captured whole, separators and all, and read by printedNumber: "€50.000" is fifty thousand, never
// fifty, and a figure grouped in no known way ("12,50") is no amount at all.
const MONEY=String.raw`(?:(?:US|S|SG|A|AU|HK|NZ|C|CA)?\$|SGD|USD|EUR|GBP|AUD|HKD|MYR|NZD|CAD|JPY|CNY|CHF|IDR|INR|PHP|THB|RM|(?<![A-Za-z])Rp\.?|€|£|¥|₹|₱|฿)\s?(${PRINTED_FIGURE})${FIGURE_END}${NO_SCALE_AFTER}(?![,.]?[OoIl|])`;
function amount(raw:string|undefined,text?:string){return printedNumber(raw,null,{lakh:groupsInLakhs(text)});}
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
/** A figure that reads as money, not a count: thousands groups ("2.000", "1,500,000", "3 000"), three or more digits,
 * or two decimals. "3" or "10" beside a code-like word is a count. */
// Never a rate, a multiple or a count: "IRR 4.25%", "IRR 1,250 bps", "SAR 1.5x", "TRY 3 times" (Critic #269 M1).
const MONEY_SHAPED=String.raw`(?:\d{1,3}(?:[.,' \u00a0]\d{3})+(?:[.,]\d{1,2})?|\d{3,}(?:[.,]\d{1,2})?|\d+[.,]\d{2})(?![\d.,])(?!\s?(?:%|x\b|×|times\b|per\s?cent|percent|bps\b|basis\s+points?))`;
function printedMarker(text:string):string|null{
  if(/(?:^|[^A-Za-z])RM\s?\d/.test(text))return "MYR";
  // Signs of one currency only (TE #145 India parity). "Rs" is left out: rupees of several countries print it.
  if(/₹\s?\d/.test(text))return "INR";
  if(/₱\s?\d/.test(text))return "PHP";
  if(/฿\s?\d/.test(text))return "THB";
  if(/₩\s?\d/.test(text))return "KRW";
  if(/₫|\d\s?₫/.test(text))return "VND";
  if(/(?:^|[^A-Za-z])Rp\.?\s?\d/.test(text))return "IDR";
  if(/(?:^|[^A-Za-z])CHF\s?\d/.test(text))return "CHF";
  if(/\bNT\$/.test(text))return "TWD";
  if(/\bHK\$/i.test(text))return "HKD";
  if(/\bAU?\$/.test(text))return "AUD";
  if(/\bSG\$/i.test(text))return "SGD";
  if(/\bNZ\$/i.test(text))return "NZD";
  if(/\bCA?\$/.test(text))return "CAD";
  // More signs of one currency only (cross-page check, 31 Oct: "R$ 2.000" had no currency). "Rs", "kr" and "Fr." are left out.
  if(/(?:^|[^A-Za-z])R\$/.test(text))return "BRL";
  if(/(?:^|[^A-Za-z])MX\$/.test(text))return "MXN";
  if(/₺/.test(text))return "TRY";
  if(/₪/.test(text))return "ILS";
  if(/₦/.test(text))return "NGN";
  if(/₴/.test(text))return "UAH";
  if(/₽/.test(text))return "RUB";
  if(/৳/.test(text))return "BDT";
  if(/\d\s?zł|zł\s?\d/i.test(text))return "PLN";
  if(/\d\s?Kč|Kč\s?\d/.test(text))return "CZK";
  // "S/" also starts references ("S/ 12345"): only beside a grouped figure or one with two decimals.
  if(/(?:^|[^A-Za-z])S\/\.?\s?(?:\d{1,3}(?:[.,]\d{3})+|\d+[.,]\d{2})(?![\d%])/.test(text))return "PEN";
  // Any other ISO 4217 code (the runtime's closed list) only directly beside a money-shaped figure: "BRL 2.000",
  // "2,500.00 ZAR", never a code-like word near a count ("TRY 3 times", "ALL 3 PLANS").
  for(const m of text.matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g)){
    if(!isIsoCurrency(m[1])||/^(?:ALL|TOP|CUP|BOB|SOS|GEL|MAD|X..)$/.test(m[1]))continue;
    const before=text.slice(0,m.index!),after=text.slice(m.index!+3);
    if(new RegExp(String.raw`^\s?${MONEY_SHAPED}`).test(after)||new RegExp(String.raw`${MONEY_SHAPED}\s?$`).test(before))return m[1];
  }
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
  const value=amount(limit?.[1],text);
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
/** The units after "per"/"each" that name an event, a person or the policy year, never a shorter period: a figure printed
 * "per claim" or "each accident" is one fixed payment for that event, and a ceiling "per year" or "per policy year" is one
 * total for the year. Closed list, whole unit only. */
const PER_EVENT_BODY=String.raw`(?:(?:insured\s+)?(?:person|life|member|child|family)|insured|life\s+assured|policy(?:\s+(?:year|term))?|lifetime|(?:calendar\s+)?year|annum|`
  +String.raw`(?:(?:any\s+)?one\s+)?(?:claim|incident|accident|event|occurrence|loss|disability|injury|illness|condition|admission|confinement|`
  +String.raw`hospitali[sz]ation|surgery|operation|treatment|visit|trip|journey|item|article|bag)s?)`;
const PER_EVENT_UNIT=new RegExp("^"+PER_EVENT_BODY+"$","i");
const PER_EVENT_AFTER=new RegExp(String.raw`^\s*(?:and\s+every\s+)?`+PER_EVENT_BODY+String.raw`(?![\p{L}\p{N}])`,"iu");
/** A period shorter than a year anywhere in a ceiling's trailer makes it a rate, never one total: "in any one day",
 * "incurred per day", "as daily allowance", "during each 24 hours", "per visit, per day". */
const SHORT_PERIOD=/(?<![\p{L}\p{N}])(?:days?|nights?|hours?|hrs?|weeks?|fortnights?|months?|quarters?|daily|nightly|hourly|weekly|fortnightly|monthly|quarterly|diem|\d+\s?h(?:rs?)?)(?![\p{L}\p{N}])/iu;
/** What may follow a ceiling's figure and leave it one total. The whole trailer is checked:
 * - no period shorter than a year anywhere (SHORT_PERIOD);
 * - every "per", "each", "every" or "/" in it is followed by a closed-list unit (PER_EVENT_AFTER);
 * - no second money figure (a sub-limit);
 * - and then it is nothing, a "per"/"each" clause, punctuation alone, or an English connector from a closed list
 *   ("for surgery", "in total", "subject to ...").
 * Anything else, an unknown unit or a word in another language, is not, and the row stays as printed. */
function capTrailerKnown(rest:string){
  const t=rest.trim().replace(/\s+/g," ");
  if(!t)return true;
  if(SHORT_PERIOD.test(t))return false;
  // A second figure in the trailer is a sub-limit or another rule ("per policy year, S$100 per visit"): one total would
  // show more than the sub-limit, so the row stays as printed.
  if(new RegExp(MONEY,"i").test(t))return false;
  for(const m of t.matchAll(/(?<![\p{L}\p{N}])(?:per|each|every)(?![\p{L}\p{N}])|\//giu))
    if(!PER_EVENT_AFTER.test(t.slice((m.index??0)+m[0].length)))return false;
  const opened=/^[,;(.:]/.test(t),clause=t.replace(/^[,;(.:\s]+/,"");
  if(/^(?:(?:for\s+)?(?:per|each|every)\b|\/)/i.test(clause))return true;
  if(opened&&!clause)return true;
  return /^(?:for|in|under|on|during|within|subject|including|inclusive|excluding|overall|total|of|while|when|if|after|before|from|towards?|incurred|payable|paid|reimbursed|as|across|combined|aggregate|limit|maximum|max|see|refer|unless|except|provided|where|less)\b/i.test(clause);
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
    const percent=amount(ofLimit[1]),limit=amount(ofLimit[2],text);
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
    // A ceiling "per day" is a rate, not one total (finding 1, real-model run on d687296f): what follows
    // the figure must be nothing, a clause the closed list knows, or "per"/"each" + a closed-list event. Anything else
    // stays as printed.
    if(!capTrailerKnown(text.slice((cap.index??0)+cap[0].length)))return null;
    const limit=amount(cap[1],text);
    if(limit!=null)return {kind:"expense_cap",value:limit,currency,basis:"reimbursed up to the "+moneyLabel(currency,limit)+" limit"};
  }
  // "S$30 per day" / "$689/month"
  // A rate printed with no currency at all ("150 per day") is still the rate
  // the schedule states; it is kept with currency null -- never given one.
  const periodic=text.match(new RegExp("^"+MONEY+String.raw`\s*(?:per|/|a)\s*(?:calendar\s+(?=year))?(day|night|week|month|year)\b`,"i"))
    ??text.match(new RegExp(String.raw`^(${NUMBER})\s*(?:per|/|a)\s*(day|night|week|month|year)\b`,"i"));
  if(periodic){
    const rate=amount(periodic[1],text);
    const unit=periodic[2].toLowerCase()==="night"?"day":periodic[2].toLowerCase() as ParsedBenefitValue["period"];
    if(rate!=null)return unit==="day"
      ?{kind:"daily",value:rate,currency,period:"day",basis:moneyLabel(currency,rate)+" for each day"}
      :{kind:"fixed",value:rate,currency,period:unit,basis:moneyLabel(currency,rate)+" each "+unit};
  }
  // A bare figure in the limit column.
  // "S$50,000 payable on 2040-06-01" / "payable at maturity": the figure is
  // the benefit; when it is paid stays in the quoted row.
  const flat=text.match(new RegExp("^"+MONEY+String.raw`(?:\s*(?:per|each)\s+([a-z ]{3,20})|,?\s*(?:payable|paid)\s+(?:on|at|upon)\s+(?:the\s+)?(?:maturity(?:\s+date)?|death|expiry|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}\s+[a-z]{3,9}\s+\d{4}))?$`,"i"));
  if(flat){
    // "per <unit>" keeps a figure fixed only when the unit is a closed-list event ("per claim", "each accident"). Any
    // other unit -- a period in another language ("per hari", "per jour"), "per hour", "per km" -- is a rate this
    // grammar does not know, and a rate stored as a lump sum is a wrong amount, so the row stays as printed.
    if(flat[2]!=null&&(!PER_EVENT_UNIT.test(flat[2].trim().replace(/\s+/g," "))||/^(?:(?:calendar\s+)?year|annum)s?$/i.test(flat[2].trim().replace(/\s+/g," "))))return null;
    const value=amount(flat[1],text);
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
