/** Whether a benefit's own printed figure is a monthly amount (TE #351: "monthly" anywhere in a row is not enough --
 * "within a month", "12 monthly instalments", "payable monthly over 10 years" or a total for a "Monthly Income" are not
 * a monthly figure). Closed allow-list, fails closed: the row prints one figure, it is followed by its own monthly unit
 * ("S$2,000 per month", "S$2,000 a month", "$1,500/month", "S$600 every month", "one twelfth of the Sum Insured each
 * month"), and what follows the unit is one of a closed set: the end of the row, "for N months/years", "for up to N
 * months", "from ...", "up to N months" or "of hospitalisation". Anything else ("a month after the claim is admitted",
 * "monthly instalments") gives no period. A "Monthly ..." label alone is never enough (Critic #351): the figure beside
 * it may be a total. Any other period, a premium or a lump sum anywhere in the row gives no period. No database, no model. */
const CURRENCY=String.raw`(?:(?:US|S|SG|A|AU|HK|NZ|C|CA)?\$|SGD|USD|EUR|GBP|AUD|HKD|MYR|NZD|CAD|JPY|CNY|CHF|IDR|INR|PHP|THB|RM|€|£|¥|₹|₱|฿)`;
const MONEY=String.raw`${CURRENCY}\s?\d[\d,]*(?:\.\d+)?`;
const SHARE=String.raw`(?:\d+(?:\.\d+)?\s?%|\b(?:one|two|three)[\s-]+[a-z-]+)\s+of\s+(?:the\s+)?(?:sum\s+(?:insured|assured)|insured\s+amount|coverage\s+amount|benefit\s+amount)`;
const UNIT=String.raw`\s*(?:,\s*)?(?:(?:per|a|each|every)\s+(?:calendar\s+)?month\b|monthly\b|\/\s?(?:month|mth|mo)\b)`;
/** What may follow a monthly unit for it to be the figure's rate (Critic #351: "a month after diagnosis" is a timing). */
const RATE_FOLLOWS=/^\s*(?:[.;]?\s*$|,?\s*for\s+(?:up\s+to\s+)?\d+\s+(?:months?|years?)\s*\.?$|,?\s*from\b|,?\s*(?:for\s+)?up\s+to\s+\d+\s+months?\s*\.?$|,?\s*of\s+hospitali[sz]ation\s*\.?$)/i;
const ANOTHER_PERIOD=/\b(?:per|a|each|every)\s+(?:calendar\s+|policy\s+)?(?:day|night|week|fortnight|quarter|year|annum|visit|claim|trip|lifetime)\b|\b(?:daily|nightly|weekly|fortnightly|quarterly|yearly|annual(?:ly)?|per\s+annum|lump\s+sum|one[- ]off|single\s+payment)\b|\bpremiums?\b|\/\s?(?:day|week|year|yr)\b/i;
export function paidMonthly(name:string|null|undefined,quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ").trim();
  if(!q||ANOTHER_PERIOD.test(q)||ANOTHER_PERIOD.test(name??""))return false;
  // One figure only: with two ("S$2,000 per month, up to S$48,000 in total") the monthly unit may belong to the other
  // figure than the one stored (TE #351), so no period is said.
  const figures=(q.match(new RegExp(String.raw`${MONEY}|${SHARE}`,"gi"))??[]).length;
  if(figures!==1)return false;
  for(const m of q.matchAll(new RegExp(String.raw`(?:${MONEY}|${SHARE})(${UNIT})`,"gi")))
    if(RATE_FOLLOWS.test(q.slice((m.index??0)+m[0].length)))return true;
  return false;
}
