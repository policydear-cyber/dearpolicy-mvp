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
const key=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/^[\s•▪●◦‣⁃\-–]+|^\(?[a-z0-9ivx]{1,4}[.)]\s+/giu,"").replace(/[^\p{L}\p{N}]+/gu," ").trim();
/** The passage opens with the benefit's own name ("Funeral costs up to S$5,000", "Get Well Benefit S$500"): it is the
 * benefit's own row, never a price, clause or feature line, whatever words follow (Critic #348 H1b). */
export function startsWithName(name:string,quote:string){
  const n=key(name),q=key(quote);
  return n.length>=4&&(q===n||q.startsWith(n+" "));
}
/** A price, not a benefit, by its shape only (Critic #348): a cover figure and what it costs ("insured up to S$1,000,000
 * at S$1.37 per day"), or a premium word with a figure and no benefit verb ("Annual premium S$420"). "We pay the premiums
 * of S$800 a year", a waiver or a refund is a benefit. "Cost" is a benefit word in travel and accident cover, never a price
 * word on its own. */
export function statesAPrice(quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ");
  if(!new RegExp(MONEY,"i").test(q))return false;
  if(new RegExp(String.raw`\b(?:insured|covered|coverage|cover)\b[^.;]*?${MONEY}[^.;]*?\bat\s+(?:only\s+|just\s+)?${MONEY}\s*(?:per|a|an|/|each)\s*(?:day|week|month|year|annum)\b`,"i").test(q))return true;
  if(/\b(?:waive|waiver|refund|return|reimburs)\w*/i.test(q))return false;
  if(/\b(?:we|will|shall|company|insurer)\s+(?:will\s+|shall\s+)?pay\b/i.test(q))return false;
  return /\bpremiums?\b/i.test(q);
}
/** A clause about a claim, never a benefit, and only when it prints no figure: a survival period, a condition before a
 * claim, a "for the avoidance of doubt" note, a passage saying something is not payable. A note with an amount is a
 * benefit with a condition and is kept. */
export function statesAClause(quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ");
  if(printsAmount(q))return false;
  return /\b(?:survives?|survived|survival period|before a claim|claim (?:can|will|may) (?:only )?be admitted|for the avoidance of doubt|(?:is|are) not payable|no benefit (?:is|shall be|will be) payable)\b/i.test(q);
}
/** A marketing feature line on a summary page: it opens with a verb phrase for what the buyer gets to do. Closed list of
 * phrases, never a bare "Get" (Get Well Benefit). */
export function statesAFeature(quote:string|null|undefined){
  const q=(quote??"").replace(/^[\s•▪●◦‣⁃\-–]+/u,"");
  return /^(?:receive|enjoy|choose|get\s+(?:covered|insured|protected|up\s+to|a\s+payout|paid)|be\s+(?:insured|covered|protected)|pay\s+the\s+same|no\s+medical\s+check-?up|no\s+underwriting)\b/i.test(q);
}
/** keep: stored as today. named: kept, with no amount printed in its passage. drop: only on proof the row is not a
 * benefit -- a price shape, a claim clause with no figure, or a feature line -- and the last two never when the passage
 * opens with the benefit's own name, or a feature line for a benefit named "... Benefit/Cover/Allowance" (Critic #348 H1: for a lost
 * cover, keep is the safe side). */
export function modelRowWithoutRule(name:string,quote:string,_pageText:string):"keep"|"named"|"drop"{
  const amount=printsAmount(quote)?"keep":"named";
  // A price by shape drops even under its own name ("Annual premium S$420").
  if(statesAPrice(quote))return "drop";
  if(startsWithName(name,quote))return amount;
  if(statesAClause(quote))return "drop";
  if(statesAFeature(quote)&&!/\b(?:benefit|cover|coverage|allowance)s?\s*$/i.test(name.trim()))return "drop";
  return amount;
}
/** The passage points to an amount printed somewhere else ("the amount shown in the schedule on page 5"). */
export function pointsElsewhere(quote:string|null|undefined){
  return /\b(?:schedule|page\s+\d+|table|shown in|stated in|specified in|set out in)\b/i.test(quote??"");
}
