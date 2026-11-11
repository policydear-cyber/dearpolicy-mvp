/** What a model-read row with no rule behind it is (MINDEF re-read, 4 Nov). The page reader returns sentences as benefits:
 * a feature line ("Receive daily hospital cash benefit"), a price ("insured up to S$1,000,000 at S$1.37 per day") or a
 * clause ("must survive for 30 days before a claim can be admitted"). Stored with no rule, each one was shown as a benefit
 * asking the person what it pays. A benefit the page names as its own heading ("• Premium Waiver") is a cover the person
 * holds, and is kept, said to print no amount. No database, no model. */

const CURRENCY=String.raw`(?:(?:US|S|SG|A|AU|HK|NZ|C|CA)?\$|(?<![A-Za-z])(?:SGD|USD|EUR|GBP|AUD|HKD|MYR|NZD|CAD|JPY|CNY|CHF|IDR|INR|PHP|THB|RM|Rp|Rs\.?)(?![A-Za-z])|€|£|¥|₹|₱|฿)`;
const MONEY=String.raw`${CURRENCY}\s?\d[\d,]*(?:\.\d+)?`;
const NUMBER_WORD=String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|a\s+(?:hundred|thousand|million))`;
const AMOUNT_IN_WORDS=new RegExp(String.raw`\b${NUMBER_WORD}(?:[\s-]+${NUMBER_WORD})*[\s-]+(?:hundred|thousand|million|billion)?\s*(?:dollars?|ringgit|pounds?|euros?|rupees?|pesos?|baht|yuan|yen)\b|\b${NUMBER_WORD}(?:[\s-]+${NUMBER_WORD})*[\s-]+(?:thousand|million|billion)\b`,"i");
const MULTIPLE=/\b(?:double|twice|triple|treble|quadruple)\b|\b(?:two|three|four|five|six|ten|\d+)\s*(?:times|x)\s+(?:the|its|your|their|that|this)\b|\b(?:a\s+)?multiple\s+of\b|\bhalf\s+(?:of\s+)?the\b/i;
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
  // An amount in words ("up to five thousand dollars") or a multiple of another figure ("double the daily cash amount",
  // "twice the sum assured", "3 times the room rate") is printed too: not read as a figure, never said to print none (TE #348).
  if(AMOUNT_IN_WORDS.test(q)||MULTIPLE.test(q))return true;
  return /(?:^|\s)\d[\d,]*(?:\.\d{1,2})?$/.test(q)&&!/\b(?:days?|months?|years?|age|weeks?|hours?|ages?|aged|under|over|above|below|section|sections|clause|page|item|part|paragraph|rule|note|schedule|table|chapter|article)\s+\d[\d,]*$/i.test(q);
}
const key=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/^[\s•▪●◦‣⁃\-–]+|^\(?[a-z0-9ivx]{1,4}[.)]\s+/giu,"").replace(/[^\p{L}\p{N}]+/gu," ").trim();
/** The passage opens with the benefit's own name ("Funeral costs up to S$5,000", "Get Well Benefit S$500"): it is the
 * benefit's own row, never a price, clause or feature line, whatever words follow (Critic #348 H1b). */
export function startsWithName(name:string,quote:string){
  const n=key(name),q=key(quote);
  // A "name" that is itself a feature line or a price ("Receive daily hospital cash benefit") is the sentence copied as a
  // name, never a benefit's own name (FWD pre-check, 5 Nov).
  if(statesAFeature(name)||statesAPrice(name))return false;
  return n.length>=4&&(q===n||q.startsWith(n+" "));
}
/** A price, not a benefit, by its shape only (Critic #348): a marketing line that opens "Be insured/covered/protected" and
 * prices a cover figure "at MONEY per day" or "for only / as low as MONEY a day", or
 * a premium word with a figure and no benefit verb ("Annual premium S$420"). A hospital cash benefit prints the same
 * cover-and-rate shape ("up to S$36,500 at S$100 per day"), so a passage that names a hospital stay is never a price, and
 * "we pay the premiums", "paid by us", a waiver or a refund is a benefit. "Cost" is a benefit word, never a price word. */
export function statesAPrice(quote:string|null|undefined){
  const q=(quote??"").replace(/^[\s•▪●◦‣⁃\-–]+/u,"").replace(/\s+/g," ");
  if(!new RegExp(MONEY,"i").test(q))return false;
  if(/\bhospital(?:i[sz]ation|i[sz]ed)?\b|\b(?:stay|confinement|ward)\b/i.test(q))return false;
  const PERIOD=String.raw`\s*(?:per|a|an|/|each)\s*(?:day|week|month|year|annum)\b`;
  // The per-day price is a marketing line only: it opens "Be insured/covered/protected", and either prices a cover figure
  // "at MONEY a day" or says "for only / for just / as low as MONEY a day". A row naming a Benefit, Cash, Allowance or
  // Income is never a price ("Daily Cash: from S$50 a day", Critic #348).
  const marketing=/^be\s+(?:insured|covered|protected)\b/i.test(q)&&!/\b(?:benefit|cash|allowance|income)\b/i.test(q);
  if(marketing&&new RegExp(String.raw`${MONEY}[^.;]*?\bat\s+(?:only\s+|just\s+)?${MONEY}${PERIOD}|\b(?:for\s+only|for\s+just|for\s+as\s+low\s+as|as\s+low\s+as)\s+${MONEY}${PERIOD}`,"i").test(q))return true;
  if(/\b(?:waive|waiver|refund|return|reimburs)\w*/i.test(q))return false;
  if(/\b(?:we|will|shall|company|insurer)\s+(?:will\s+|shall\s+)?pay\b|\bpaid\s+(?:by\s+us|for\s+you|on\s+your\s+behalf)\b|\b(?:are|is|will\s+be)\s+paid\b/i.test(q))return false;
  return /\bpremiums?\b/i.test(q);
}
/** A clause about a claim, never a benefit, and only when it prints no figure: a survival requirement ("must survive for
 * 30 days", "a survival period of 14 days"), a condition before a claim, a "for the avoidance of doubt" note, a passage
 * saying something is not payable. A negated requirement ("need not survive any period") is a benefit's wording, and a
 * note with an amount is a benefit with a condition: both are kept (TE #348). */
export function statesAClause(quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ");
  if(printsAmount(q))return false;
  if(/\b(?:need\s+not|does\s+not\s+need\s+to|do\s+not\s+need\s+to|no\s+need\s+to|without\s+(?:a|any)\s+need\s+to)\s+survive\b/i.test(q))return false;
  return /\bmust\s+(?:first\s+)?survive\b|\bsurviv(?:es|al period)\s+(?:of|for)\s+(?:\d+|[a-z]+\s+\(\d+\))|\bbefore a claim\b|\bclaim (?:can|will|may) (?:only )?be admitted\b|\bfor the avoidance of doubt\b|\b(?:is|are) not payable\b|\bno benefit (?:is|shall be|will be) payable\b/i.test(q);
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
  // A feature line that prints an amount is a benefit, as a clause with an amount is (TE #348 journey gate).
  // A choice of cover sizes ("Choose cover from S$50,000 to S$500,000") is a range to buy, not an amount paid.
  if(new RegExp(String.raw`^[\s•▪●◦‣⁃\-–]*choose\b[^.;]*\bfrom\s+${MONEY}\s+to\s+${MONEY}`,"iu").test(quote))return "drop";
  if(statesAFeature(quote)&&amount==="named"&&(statesAFeature(name)||!/\b(?:benefit|cover|coverage|allowance)s?\s*$/i.test(name.trim())))return "drop";
  return amount;
}
/** The passage points to an amount printed somewhere else ("the amount shown in the schedule on page 5"). */
export function pointsElsewhere(quote:string|null|undefined){
  return /\b(?:schedule|page\s+\d+|table|shown in|stated in|specified in|set out in)\b/i.test(quote??"");
}
