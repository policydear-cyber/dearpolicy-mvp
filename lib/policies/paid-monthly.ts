/** Whether a benefit's own printed figure is a monthly amount (TE #351: "monthly" anywhere in a row is not enough --
 * "within a month", "12 monthly instalments", "payable monthly over 10 years" or a total for a "Monthly Income" are not
 * a monthly figure). Closed allow-list, fails closed:
 *  1. the row prints one figure, and it is followed by its monthly unit: "S$2,000 per month", "S$2,000 a month", "$1,500/month",
 *     "S$600 every month", "S$2,000 monthly", "one twelfth of the Sum Insured each month";
 *  2. or the whole row is a "Monthly ..." label and its one figure, optionally "for N months/years", and nothing else.
 * Any other period, a premium or a lump sum anywhere in the row gives no period. No database, no model. */
const CURRENCY=String.raw`(?:(?:US|S|SG|A|AU|HK|NZ|C|CA)?\$|SGD|USD|EUR|GBP|AUD|HKD|MYR|NZD|CAD|JPY|CNY|CHF|IDR|INR|PHP|THB|RM|€|£|¥|₹|₱|฿)`;
const MONEY=String.raw`${CURRENCY}\s?\d[\d,]*(?:\.\d+)?`;
const SHARE=String.raw`(?:\d+(?:\.\d+)?\s?%|\b(?:one|two|three)[\s-]+[a-z-]+)\s+of\s+(?:the\s+)?(?:sum\s+(?:insured|assured)|insured\s+amount|coverage\s+amount|benefit\s+amount)`;
const UNIT=String.raw`\s*(?:,\s*)?(?:(?:per|a|each|every)\s+(?:calendar\s+)?month\b|monthly\b|\/\s?(?:month|mth|mo)\b)`;
/** A monthly unit that is not a rate: "monthly instalments", "monthly over 10 years". */
const NOT_A_RATE=/^\s*(?:instal(?:l)?ments?|payments?\s+over|over\b|for\s+(?:a\s+(?:term|period)|\d+\s+years?))/i;
const ANOTHER_PERIOD=/\b(?:per|a|each|every)\s+(?:calendar\s+|policy\s+)?(?:day|night|week|fortnight|quarter|year|annum|visit|claim|trip|lifetime)\b|\b(?:daily|nightly|weekly|fortnightly|quarterly|yearly|annual(?:ly)?|per\s+annum|lump\s+sum|one[- ]off|single\s+payment)\b|\bpremiums?\b|\/\s?(?:day|week|year|yr)\b/i;
export function paidMonthly(name:string|null|undefined,quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ").trim();
  if(!q||ANOTHER_PERIOD.test(q)||ANOTHER_PERIOD.test(name??""))return false;
  // One figure only: with two ("S$2,000 per month, up to S$48,000 in total") the monthly unit may belong to the other
  // figure than the one stored (TE #351), so no period is said.
  const figures=(q.match(new RegExp(String.raw`${MONEY}|${SHARE}`,"gi"))??[]).length;
  if(figures!==1)return false;
  for(const m of q.matchAll(new RegExp(String.raw`(?:${MONEY}|${SHARE})(${UNIT})`,"gi")))
    if(!NOT_A_RATE.test(q.slice((m.index??0)+m[0].length)))return true;
  // (2) The whole row is the "Monthly ..." label and its one figure, optionally "for N months/years", and nothing else
  // (TE #351: any other word -- "aggregate", "overall", "lifetime", "cap on all payments", a "Sum Assured" before the
  // figure -- can make the figure a total, so it gives no period).
  const label=String.raw`monthly(?:\s+(?!(?:sum|assured|insured|plan|limit|total|maximum|aggregate|cap|amount)\b)[a-z&'’-]+){1,5}`;
  const row=/^\s*monthly\b/i.test(q)?q:/^\s*monthly\b/i.test(name??"")?(name+" "+q):"";
  return new RegExp(String.raw`^${label}\s*[:\-–]?\s*(?:${MONEY}|${SHARE})(?:\s+for\s+\d+\s+(?:months?|years?))?\s*\.?$`,"i").test(row.replace(/\s+/g," ").trim());
}
