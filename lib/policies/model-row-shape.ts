/** What a model-read row with no rule behind it is (MINDEF re-read, 4 Nov). The page reader returns sentences as benefits:
 * a feature line ("Receive daily hospital cash benefit"), a price ("insured up to S$1,000,000 at S$1.37 per day") or a
 * clause ("must survive for 30 days before a claim can be admitted"). Stored with no rule, each one was shown as a benefit
 * asking the person what it pays. A benefit the page names as its own heading ("• Premium Waiver") is a cover the person
 * holds, and is kept, said to print no amount. No database, no model. */

const CURRENCY=String.raw`(?:(?:US|S|SG|A|AU|HK|NZ|C|CA)?\$|SGD|USD|EUR|GBP|AUD|HKD|MYR|NZD|CAD|JPY|CNY|CHF|IDR|INR|PHP|THB|RM|(?<![A-Za-z])(?:Rp|Rs)\.?|€|£|¥|₹|₱|฿)`;
const MONEY=String.raw`${CURRENCY}\s?\d[\d,]*(?:\.\d+)?`;
const FRACTION_WORDS=/\b(?:one|two|three)[\s-]+(?:half|thirds?|quarters?|fifth|sixth|eighth|tenth|twelfth|twenty[- ]fourth|thirtieth)\b|\b\d+\s?\/\s?\d+\b/i;
/** The passage prints an amount a benefit could pay: a figure with a currency, a percentage, a share in words, "as
 * charged", or a table cell ending in a bare figure ("Non-Panel General Practitioner 30"). A count ("30 days", "(6)
 * months", "age 65") is not an amount. */
export function printsAmount(quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ").trim();
  if(!q)return false;
  if(new RegExp(MONEY,"i").test(q))return true;
  if(/\d\s?%|\bper\s?cent\b/i.test(q))return true;
  if(FRACTION_WORDS.test(q))return true;
  if(/\bas\s+charged\b/i.test(q))return true;
  return /(?:^|\s)\d[\d,]*(?:\.\d{1,2})?$/.test(q)&&!/\b(?:days?|months?|years?|age|weeks?|hours?)\s+\d[\d,]*$/i.test(q);
}
/** A price, not a benefit: a cover figure charged "at … per day/month/year", or a premium with a figure. */
export function statesAPrice(quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ");
  // "insured up to S$1,000,000 at S$1.37 per day": a cover figure, then what it costs. One figure alone ("hospital cash at
  // S$100 per day") is a benefit's rate.
  if(new RegExp(String.raw`${MONEY}\b.*\bat\s+(?:only\s+|just\s+)?${MONEY}\s*(?:per|a|/|each)\s*(?:day|week|month|year|annum)\b`,"i").test(q))return true;
  return /\bpremiums?\b/i.test(q)&&new RegExp(MONEY,"i").test(q)&&!/\b(?:waive|waiver|refund|return)\w*/i.test(q);
}
/** The benefit's name printed as a heading of its own on the page: a line that is the name and nothing else, after a
 * bullet, a number or a trailing colon. */
export function namedAsHeading(name:string,pageText:string){
  const key=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/[*^#†‡]+/g,"").replace(/\s+/g," ").trim();
  const wanted=key(name);
  if(wanted.length<4)return false;
  return pageText.split("\n").some(line=>key(line.replace(/\t/g," ").replace(/^\s*(?:[•▪●◦‣⁃\-–]|\(?[a-z0-9ivx]{1,4}[.)])\s*/i,"").replace(/:\s*$/,""))===wanted);
}
/** keep: stored as today (its passage prints an amount the reader could not turn into a rule). named: a cover the page
 * names as a heading, stored and said to print no amount. drop: a sentence about the plan, never a benefit row. */
export function modelRowWithoutRule(name:string,quote:string,pageText:string):"keep"|"named"|"drop"{
  if(statesAPrice(quote))return "drop";
  if(printsAmount(quote))return "keep";
  return namedAsHeading(name,pageText)?"named":"drop";
}
