/** Whether a benefit's own printed name or row says it is paid every month: "Monthly Disability Income", "S$2,000 per
 * month", "one twelfth of the sum insured each month", "$1,500/month". Fails closed: only the row's own words count, and
 * any other period ("per day", "yearly", "lump sum"), a premium, or a stated term only ("6 months") gives no period, so a
 * period is never invented. No database, no model. */
const MONTHLY=/\b(?:per|a|each|every)\s+(?:calendar\s+)?month\b|\bmonthly\b|\/\s?(?:month|mth|mo)\b/i;
const ANOTHER_PERIOD=/\b(?:per|a|each|every)\s+(?:calendar\s+|policy\s+)?(?:day|night|week|fortnight|quarter|year|annum|visit|claim|trip|lifetime)\b|\b(?:daily|nightly|weekly|fortnightly|quarterly|yearly|annual(?:ly)?|per\s+annum|lump\s+sum|one[- ]off|single\s+payment)\b|\bpremiums?\b|\/\s?(?:day|week|year|yr)\b/i;
export function paidMonthly(...texts:(string|null|undefined)[]){
  const t=texts.filter(Boolean).join(" ").replace(/\s+/g," ");
  return MONTHLY.test(t)&&!ANOTHER_PERIOD.test(t);
}
