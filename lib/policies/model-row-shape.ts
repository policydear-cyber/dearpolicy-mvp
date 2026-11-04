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
/** A price, not a benefit: a premium, cost or price word together with a figure ("Pay a monthly premium of S$12.50",
 * "costs only S$0.40 a day"). Waiving or refunding a premium is a benefit, never a price. A cover figure and a daily rate
 * together ("Hospital Income up to S$36,500 at S$100 per day") is a benefit, so the shape alone never decides. */
export function statesAPrice(quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ");
  if(!new RegExp(MONEY,"i").test(q))return false;
  if(/\b(?:waive|waiver|refund|return)\w*/i.test(q))return false;
  return /\b(?:premiums?|costs?|costing|priced?|prices)\b/i.test(q);
}
/** A clause about a claim, never a benefit: a survival period, a condition before a claim is admitted, a "for the
 * avoidance of doubt" note, or a passage saying something is not payable. Closed list. */
export function statesAClause(quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ");
  return /\b(?:survives?|survived|survival period|before a claim|claim (?:can|will|may) (?:only )?be admitted|for the avoidance of doubt|(?:is|are|shall not be|will not be) not payable|no benefit (?:is|shall be|will be) payable)\b/i.test(q);
}
/** A marketing feature line on a summary page, never a benefit row: it starts with what the buyer gets to do. Closed list. */
export function statesAFeature(quote:string|null|undefined){
  const q=(quote??"").replace(/^[\s•▪●◦‣⁃\-–]+/u,"");
  return /^(?:receive|enjoy|get|choose|be (?:insured|covered)|pay the same|no medical check-up|no underwriting)\b/i.test(q);
}
/** keep: stored as today. named: kept, with no amount printed in its passage. drop: only on positive evidence that the
 * row is not a benefit -- a price, a claim clause or a feature line (Critic #348 H1: for a lost cover, keep is the safe
 * side, so anything not proven a non-benefit is kept: a cover named in running text, a status cell such as "Included" or
 * "Unlimited", a bullet with words after the name). */
export function modelRowWithoutRule(_name:string,quote:string,_pageText:string):"keep"|"named"|"drop"{
  if(statesAPrice(quote)||statesAClause(quote)||statesAFeature(quote))return "drop";
  return printsAmount(quote)?"keep":"named";
}
/** The passage points to an amount printed somewhere else ("the amount shown in the schedule on page 5"). */
export function pointsElsewhere(quote:string|null|undefined){
  return /\b(?:schedule|page\s+\d+|table|shown in|stated in|specified in|set out in)\b/i.test(quote??"");
}
