/** The currencies a text names, read widely, for the household currency (lib/documents/household-currency). No imports. */

/** Every currency a text names, read WIDELY for the household currency only: a currency prefix beside "$" ("US $",
 * "U.S.$", "HK $", "NT$"), codes in any case ("Usd", "Currency: Myr"), a standalone "RM", "Rp", "Rs", "Malaysian", and many
 * more codes and words. A false match here only keeps an amount held as it was, so it errs wide (Critic #526 H2, Test
 * engineer #526 F1). The page-image check keeps its own narrow reading (image-currency currenciesIn): there a false match
 * would hide a correct amount (Critic #526, e593f88 H1). */
export function currenciesNamed(text: string): string[] {
  const out: string[] = [];
  const t = String(text ?? "");
  // A dollar sign and the letters printed against it: glued ("S$", "U.S.$", "NT$") or, for a known prefix, one space apart
  // ("US $", "HK $"). A prefix outside the list is another dollar; no prefix is a bare "$" (Test engineer #526 F1).
  const dollarOf = (prefix: string) => {
    const p = prefix.replace(/\./g, "").toUpperCase();
    return p === "S" || p === "SG" ? "SGD" : p === "US" ? "USD" : p === "HK" ? "HKD" : p === "A" || p === "AU" ? "AUD" : "?";
  };
  let rest = t;
  for (const re of [/(?<![A-Za-z.])((?:[A-Za-z]\.?){1,3})\$/g, /(?<![A-Za-z.])(S|SG|US|U\.S\.|HK|AU|NZ|NT|C|R)\s\$/g]) {
    for (const m of rest.matchAll(re)) out.push(dollarOf(m[1]));
    rest = rest.replace(re, " ");
  }
  for (const _ of rest.matchAll(/\$/g)) out.push("$");
  // Any other sign ("€", "£", "₱" are on the list; "¥", "₹", "฿" ... are not).
  for (const m of t.matchAll(/\p{Sc}/gu)) {
    if (m[0] === "$") continue;
    out.push(m[0] === "€" ? "EUR" : m[0] === "£" ? "GBP" : m[0] === "₱" ? "PHP" : "?");
  }
  // Codes in any case ("Usd", "Php", "Currency: Myr"; Test engineer #526 F1).
  for (const m of t.matchAll(/(?<![A-Za-z])(SGD|USD|HKD|AUD|MYR|EUR|GBP|PHP|NZD|CAD|CNY|RMB|JPY|IDR|THB|INR|KRW|TWD|NTD|CHF|VND|BND)(?![A-Za-z])/gi)) {
    const code = m[1].toUpperCase();
    out.push(["SGD", "USD", "HKD", "AUD", "MYR", "EUR", "GBP", "PHP"].includes(code) ? code : "?");
  }
  // Rupees ("Rs 500,000.00", "Rs."), and a currency named by its country's adjective.
  if (/(?<![A-Za-z])Rs\.?(?![A-Za-z])/.test(t)) out.push("?");
  if (/\bmalaysian\b/i.test(t)) out.push("MYR");
  // "RM" alone ("Sum Assured (RM)", "Currency: RM") is ringgit too; a false match only keeps an amount held (Critic #526 H2).
  if (/(?<![A-Za-z])RM(?![A-Za-z])/.test(t)) out.push("MYR");
  // Rupiah ("Rp 100.000.000") and other currencies outside the list, by code.
  if (/(?<![A-Za-z])Rp\.?\s?\d/.test(t)) out.push("?");
  for (const m of t.matchAll(/(?<![A-Za-z])(MOP|AED|SAR|QAR|KWD|BHD|OMR|ZAR|SEK|NOK|DKK|LKR|PKR|BDT|MMK|KHR|LAK|NPR|MVR|TRY|RUB|BRL|MXN|PLN|CZK|HUF|ILS|EGP|NGN|KES)(?![A-Za-z])/g)) out.push("?");
  if (/\bsingapore\s+dollars?\b/i.test(t)) out.push("SGD");
  if (/\b(?:u\.?s\.?|united\s+states|american)\s+dollars?\b/i.test(t)) out.push("USD");
  if (/\bhong\s+kong\s+dollars?\b/i.test(t)) out.push("HKD");
  if (/\baustralian\s+dollars?\b/i.test(t)) out.push("AUD");
  if (/\bringgit\b/i.test(t)) out.push("MYR");
  if (/\beuros?\b/i.test(t)) out.push("EUR");
  if (/\bpounds?\s+sterling\b/i.test(t)) out.push("GBP");
  if (/\bpesos?\b/i.test(t)) out.push("PHP");
  if (/\bsing(?:apore(?:an)?)?\s+dollars?\b/i.test(t) && !/\bsingapore\s+dollars?\b/i.test(t)) out.push("SGD");
  // A dollar word naming no listed country ("New Zealand dollars", "Canadian Dollar") is another currency; a bare
  // "dollars" is a dollar of some kind.
  // Any word before "dollar(s)" that is not plain filler names a kind of dollar ("HK Dollar", "Taiwanese dollars", "Kiwi
  // dollars", "Singaporean Dollar"): another currency, never the bare dollar the household's currency may stand for.
  const FILLER = /^(?:in|the|of|and|all|any|amount|amounts|sum|premium|premiums|are|is|paid|payable|a|an|your|our|total|as|per|by|to|for|or|shown|stated|expressed|written|quoted|benefit|benefits|value|values|assured|insured|cover|plan|policy|currency|only|these|those|this|that|figure|figures|charges|cash|face|limit|limits|sums|usd|us|singapore|singaporean|sing|u\.?s\.?|states|american|kong|australian)$/i;
  for (const m of t.matchAll(/\b([A-Za-z.]+)\s+dollars?\b/gi)) if (!FILLER.test(m[1])) out.push("?");
  // A country or kind of dollar written out before a bare "$" ("Hong Kong $500", "Singapore $", "United States $", "Kiwi $"):
  // the named one, or another currency. A bounded list on purpose: any word before "$" would hold "Premium $500" or
  // "Accidental Death $100,000", and the household's currency is meant to fill those (DC 22 Nov).
  if (/(?<![A-Za-z])(?:singapore(?:an)?|sing)\s+\$/i.test(t)) out.push("SGD");
  if (/(?<![A-Za-z])(?:united\s+states|u\.?s\.?a?|american?)\s+\$/i.test(t)) out.push("USD");
  if (/(?<![A-Za-z])(?:hong\s?kong|hk|taiwan(?:ese)?|macau|macao|new\s+zealand|nz|kiwi|aussie|australia(?:n)?|canad(?:a|ian)|brunei|fiji(?:an)?|indonesia(?:n)?|philippine|philippines|mexic(?:o|an)|chile(?:an)?|colombia(?:n)?|argentin(?:e|a|ian)|jamaica(?:n)?|bahamas|bahamian|barbad(?:os|ian)|belize(?:an)?|bermuda(?:n)?|bermudian|cayman|guyana|liberia(?:n)?|namibia(?:n)?|solomon|surinam(?:e|ese)?|trinidad|tobago|zimbabwe(?:an)?|caribbean|ecuador|salvador|malaysia(?:n)?|china|chinese|japan(?:ese)?|korea(?:n)?|india(?:n)?|thai(?:land)?|vietnam(?:ese)?|british|european)\s+\$/i.test(t)) out.push("?");
  if (/(?<![A-Za-z])dollars?\b/i.test(t) && !out.length) out.push("$");
  for (const w of ["yen", "yuan", "renminbi", "rupees?", "rupiah", "baht", "won", "francs?", "dong", "kr(?:ona|one|oner)", "dirhams?", "riyals?", "rials?", "rand", "kyat", "riel", "taka", "patacas?", "dinars?", "lira", "roubles?", "rubles?", "reais", "zloty", "shekels?", "kip", "rufiyaa", "liras?"]) if (new RegExp(`\\b${w}\\b`, "i").test(t)) out.push("?");
  return out;
}


