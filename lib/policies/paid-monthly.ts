/** Whether a benefit's own printed figure is a monthly amount (TE #351: "monthly" anywhere in a row is not enough --
 * "within a month", "12 monthly instalments", "payable monthly over 10 years" or a total for a "Monthly Income" are not
 * a monthly figure). Closed allow-list, fails closed:
 *  1. the figure itself is followed by its monthly unit: "S$2,000 per month", "S$2,000 a month", "$1,500/month",
 *     "S$600 every month", "S$2,000 monthly", "one twelfth of the Sum Insured each month";
 *  2. or the benefit's name or printed row label starts with "Monthly" and its row prints one figure with no total,
 *     maximum, "up to", instalment, term ("over 10 years") or "within" ("for 24 months" is how long it is paid).
 * Any other period, a premium or a lump sum anywhere in the row gives no period. No database, no model. */
const CURRENCY=String.raw`(?:(?:US|S|SG|A|AU|HK|NZ|C|CA)?\$|SGD|USD|EUR|GBP|AUD|HKD|MYR|NZD|CAD|JPY|CNY|CHF|IDR|INR|PHP|THB|RM|€|£|¥|₹|₱|฿)`;
const MONEY=String.raw`${CURRENCY}\s?\d[\d,]*(?:\.\d+)?`;
const SHARE=String.raw`(?:\d+(?:\.\d+)?\s?%|\b(?:one|two|three)[\s-]+[a-z-]+)\s+of\s+(?:the\s+)?(?:sum\s+(?:insured|assured)|insured\s+amount|coverage\s+amount|benefit\s+amount)`;
const UNIT=String.raw`\s*(?:,\s*)?(?:(?:per|a|each|every)\s+(?:calendar\s+)?month\b|monthly\b|\/\s?(?:month|mth|mo)\b)`;
/** A monthly unit that is not a rate: "monthly instalments", "monthly over 10 years". */
const NOT_A_RATE=/^\s*(?:instal(?:l)?ments?|payments?\s+over|over\b|for\s+(?:a\s+(?:term|period)|\d+\s+years?))/i;
const ANOTHER_PERIOD=/\b(?:per|a|each|every)\s+(?:calendar\s+|policy\s+)?(?:day|night|week|fortnight|quarter|year|annum|visit|claim|trip|lifetime)\b|\b(?:daily|nightly|weekly|fortnightly|quarterly|yearly|annual(?:ly)?|per\s+annum|lump\s+sum|one[- ]off|single\s+payment)\b|\bpremiums?\b|\/\s?(?:day|week|year|yr)\b/i;
const NAME_ONLY_BLOCKERS=/\b(?:total|in\s+all|maximum|max|up\s+to|limit(?:ed)?|instal(?:l)?ments?|over\s+\d+|within|per\s+(?:disability|claim|event|life))\b/i;
export function paidMonthly(name:string|null|undefined,quote:string|null|undefined){
  const q=(quote??"").replace(/\s+/g," ").trim();
  if(!q||ANOTHER_PERIOD.test(q)||ANOTHER_PERIOD.test(name??""))return false;
  for(const m of q.matchAll(new RegExp(String.raw`(?:${MONEY}|${SHARE})(${UNIT})`,"gi")))
    if(!NOT_A_RATE.test(q.slice((m.index??0)+m[0].length)))return true;
  const figures=q.match(new RegExp(String.raw`${MONEY}|${SHARE}`,"gi"))??[];
  return (/^\s*monthly\b/i.test(name??"")||/^\s*monthly\b/i.test(q))&&figures.length===1&&!NAME_ONLY_BLOCKERS.test(q);
}
