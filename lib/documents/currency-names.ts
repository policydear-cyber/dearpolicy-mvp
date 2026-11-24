/** The currencies a text names, read widely, for the household currency (lib/documents/household-currency). No imports. */

/** Every currency a text names, read WIDELY for the household currency only: a currency prefix beside "$" ("US $",
 * "U.S.$", "HK $", "NT$"), codes in any case ("Usd", "Currency: Myr"), a standalone "RM", "Rp", "Rs", "Malaysian", and many
 * more codes and words. A false match here only keeps an amount held as it was, so it errs wide (Critic #526 H2, Test
 * engineer #526 F1). The page-image check keeps its own narrow reading (image-currency currenciesIn): there a false match
 * would hide a correct amount (Critic #526, e593f88 H1). */
/** Countries and kinds of dollar a text may write out beside a dollar sign or after "Currency:". */
const COUNTRY_WORD = /^(?:singapore|us|usa|united states|american|hong kong|hk|taiwan(?:ese)?|macau|macao|new zealand|nz|kiwi|aussie|australia(?:n)?|canad(?:a|ian)|ca|can|cdn|brunei|fiji(?:an)?|indonesia(?:n)?|philippine|philippines|mexic(?:o|an)|chile(?:an)?|colombia(?:n)?|argentin(?:e|a|ian)|jamaica(?:n)?|bahamas|barbad(?:os|ian)|belize|bermuda(?:n)?|cayman|guyana|liberia(?:n)?|namibia(?:n)?|ecuador|malaysia(?:n)?|china|chinese|japan(?:ese)?|korea(?:n)?|india(?:n)?|thai(?:land)?|vietnam(?:ese)?|british|uk|european|euro|eu|au|aus|sg|sgp|pounds?|sterling|gb|gbp|britain|swiss|switzerland|uae|dubai|oz|indo|hongkong)$/;
const countryCode = (w: string) => /^(?:singapore|sg|sgp|singaporean)$/.test(w) ? "SGD" : /^(?:us|usa|united states|american)$/.test(w) ? "USD" : /^(?:hk|hong kong)$/.test(w) ? "HKD" : /^(?:au|australia|australian)$/.test(w) ? "AUD" : COUNTRY_WORD.test(w) ? "?" : null;
export function currenciesNamed(text: string): string[] {
  const out: string[] = [];
  const t = String(text ?? "");
  let rest = t;
  // A dollar sign with letters against it names a currency. Glued or dotted letters before the sign ("NT$", "U.S.$", "ICU$") are
  // a currency, a known one by its code and any other as "another currency". Spaced letters before it ("US $", "HKG $",
  // "U. S. $") only when they are a known currency's letters (CODE_OF): "ICU $200", "OPD $50", "Per day $100" and "Plan A $100"
  // are the benefit's own label and stay a bare dollar, which takes the household's currency (Critic #579). After the sign or the
  // figure ("$US", "$ in US", "$ (US)", "$100,000 US", "$100 HK", "HK 100 $"), the same known letters. Anything unread here is
  // only ever held, never filled with the household's currency (Test engineer and Critic #577, #579).
  const NOT_CURRENCY = new Set(["in", "of", "to", "is", "at", "up", "on", "by", "as", "no", "or", "be", "if", "it", "an", "and", "the", "for", "per", "are", "add", "get",
    "sum", "sums", "fee", "fees", "tax", "max", "min", "pay", "paid", "cost", "only", "plus", "less", "each", "net", "age", "cash", "loss", "free", "plan", "part", "over",
    "than", "from", "upto", "not", "any", "all", "now", "our", "your", "was", "has", "may", "via", "etc", "amt", "upon", "also", "then", "that", "this", "with", "rate", "cap", "bal", "day", "days"]);
  const CODE_OF: Record<string, string> = { S: "SGD", SG: "SGD", SGP: "SGD", SIN: "SGD", SING: "SGD", SPORE: "SGD", US: "USD", USA: "USD", HK: "HKD", HKG: "HKD", A: "AUD", AU: "AUD", AUS: "AUD", AUST: "AUD",
    SGD: "SGD", USD: "USD", HKD: "HKD", AUD: "AUD", NZD: "?", CAD: "?", MYR: "MYR", NZ: "?", NZL: "?", C: "?", CA: "?", CAN: "?", CDN: "?", NT: "?", TW: "?", TWN: "?", MY: "?", MX: "?", MEX: "?", BN: "?", FJ: "?", R: "?", RM: "MYR" };
  const norm = (prefix: string) => prefix.replace(/[^A-Za-z]/g, "").toUpperCase();
  const known = (prefix: string): string | null => CODE_OF[norm(prefix)] ?? null;
  const LETTERS = String.raw`(?:[A-Za-z](?:[.' ]{1,2}[A-Za-z]){1,3}(?![A-Za-z])|[Ss]'pore|[A-Za-z]{1,4})`;
  // Before the sign: brackets and any dash, colon, slash, semicolon or comma between the letters and the sign are allowed.
  const SEPS = String.raw`[-–—:;,/|•·*^~]`;
  const before = new RegExp(String.raw`(?<![A-Za-z])([\[({]?)(${LETTERS})\.?([\])}]?)\.?(\s{0,3}${SEPS}?\s{0,2})\$`, "g");
  // A letter that is the benefit's own label, not a currency: after a word ("Plan A $100", "Class C - $50"), in list markers
  // ("(A) $100", "A) $100"), after a digit ("Option 1A $100"). Glued to the sign ("A$", "C$") it is a currency.
  const labelBefore = (text: string, off: number, open: string, close: string, n: string, gap: string) =>
    n.length === 1 && gap !== "" && (open !== "" || close !== "" || /[A-Za-z]{2,} *[\[({]?$/.test(text.slice(Math.max(0, off - 14), off)) || /\d$/.test(text.slice(Math.max(0, off - 1), off)));
  for (const m of rest.matchAll(before)) {
    const open = m[1]!, word = m[2]!, close = m[3]!, gap = m[4]!, n = norm(word);
    if (!n || NOT_CURRENCY.has(n.toLowerCase())) continue;
    const spaced = gap.length > 0 && gap.trim() === "";
    if (spaced && !known(word)) continue;
    if (labelBefore(rest, m.index!, open, close, n, gap)) continue;
    out.push(known(word) ?? "?");
  }
  rest = rest.replace(before, (m, open: string, w: string, close: string, gap: string, off: number) => {
    const n = norm(w), spaced = gap.length > 0 && gap.trim() === "";
    if (!n || NOT_CURRENCY.has(n.toLowerCase()) || (spaced && !known(w)) || labelBefore(rest, off, open, close, n, gap)) return m;
    return " ";
  });
  // After the sign: glued letters ("$US500", "$HK", "$A", "$NZ 100") are a currency.
  const afterGlued = /\$([A-Za-z]{1,3})(?![A-Za-z])/g;
  for (const m of rest.matchAll(afterGlued)) { const n = norm(m[1]!); if (!NOT_CURRENCY.has(n.toLowerCase())) out.push(known(n) ?? "?"); }
  rest = rest.replace(afterGlued, (m, w: string) => (NOT_CURRENCY.has(norm(w).toLowerCase()) ? m : " "));
  // After the sign, or after the figure the sign precedes ("$ US", "$ in US", "$ (in US)", "$ [US]", "$ - US", "$, US", "Amounts in $;
  // US", "$100,000 U.S.A", "$100 (U.S.)", "$100,000 Hong Kong", "$ 100,000 / HK", "$ - Singapore"): the first one or two words, or
  // single letters with dots ("U. S. A."), when they are a known currency's code or a country written out. A lone letter followed
  // by a word ("$100 a day", "$100 A week") is not a currency.
  const AFTER_SEP = String.raw`[\s\-–—:;,/|•·*^~\[\](){}]`;
  const readWords = (raw: string): string | null => {
    const tokens = raw.trim().split(/[\s-]+/).map((x) => x.replace(/\./g, "")).filter(Boolean);
    const joined: string[] = [];
    let run = ""; for (const tk of tokens) { if (tk.length === 1) run += tk; else break; } if (run.length >= 2) joined.push(run);
    joined.push(...[tokens.slice(0, 2).join(" "), tokens[0] ?? ""].filter(Boolean));
    for (const c of joined) {
      const w = c.toLowerCase();
      const code = CODE_OF[w.toUpperCase()] ?? countryCode(w);
      if (!code) continue;
      if (c.length === 1 && tokens.length > 1 && tokens[1]!.length > 1) return null;   // "$100 a day": a label word follows
      return code;
    }
    return null;
  };
  const afterSign = new RegExp(String.raw`\$${AFTER_SEP}*(?:in${AFTER_SEP}+)?(?:\d[\d,.]*${AFTER_SEP}*)?([A-Za-z][A-Za-z.' -]{0,24})`, "g");
  for (const m of t.matchAll(afterSign)) { const c = readWords(m[1]!); if (c) out.push(c); }
  // "Currency", "Curr", "Ccy", "Cur" then a bracket, dash, colon, newline or nothing, and "Dollars" then letters with any separator
  // ("Currency (US)", "Currency\nUS", "Ccy: HK", "Dollars US", "Dollars, US", "Dollars — HK"): the named currency.
  for (const m of t.matchAll(new RegExp(String.raw`\b(?:currency|curr|ccy|cur)\b\.?${AFTER_SEP}*(?:in${AFTER_SEP}+)?([A-Za-z][A-Za-z.' -]{0,24})`, "gi"))) { const c = readWords(m[1]!); if (c) out.push(c); }
  for (const m of t.matchAll(new RegExp(String.raw`\b(?:currency|curr|ccy)\b[^\n.]{0,25}?(?:[:=\-–—→>]|\bis\b|\bin\b)${AFTER_SEP}*([A-Za-z][A-Za-z.' -]{0,24})`, "gi"))) { const c = readWords(m[1]!); if (c) out.push(c); }
  for (const m of t.matchAll(/(?<![A-Za-z])([A-Za-z][A-Za-z.]*(?:[ -][A-Za-z]+)?)\s+currency\b/gi)) { const c = readWords(m[1]!); if (c) out.push(c); }
  for (const m of t.matchAll(new RegExp(String.raw`\bdollars?\b${AFTER_SEP}*(?:in${AFTER_SEP}+)?([A-Za-z][A-Za-z.' -]{0,24})`, "gi"))) { const c = readWords(m[1]!); if (c) out.push(c); }
  // Letters, then a figure, then the sign ("HK 100 $").
  for (const m of t.matchAll(/(?<![A-Za-z])([A-Za-z]{1,4})\s\d[\d,.]*\s?\$/g)) { const c = known(m[1]!); if (c) out.push(c); }
  // Letters before "($)" ("Sum Assured US ($)", "Hong Kong ($)").
  for (const m of t.matchAll(new RegExp(String.raw`(?<![A-Za-z])(${LETTERS})\.?\s?\(\s*\$\s*\)`, "g"))) { const c = known(m[1]!); if (c) out.push(c); else if (!NOT_CURRENCY.has(norm(m[1]!).toLowerCase()) && norm(m[1]!).length <= 2) out.push("?"); }
  // "Dollars (US)", "$ (Singapore)", "Hong Kong ($)": a country or code in brackets beside the dollar word or sign.
  const named = (raw: string) => { const w = raw.toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim(); return countryCode(w) ?? (w === "a" ? "AUD" : null); };
  for (const m of t.matchAll(/(?:\bdollars?|\$)\s*\(\s*([A-Za-z.' ]{1,16}?)\s*\)/gi)) out.push(named(m[1]!) ?? "$");
  for (const m of t.matchAll(/\bdollars?\s*(?:[-:\/]|\bin\b)\s*\(?\s*([A-Za-z]+(?: [A-Za-z]+)?)/gi)) { const c = named(m[1]!) ?? named(m[1]!.split(" ")[0]!); if (c) out.push(c); }
  // A country written out before "($)": "Hong Kong ($)", "All amounts in Singapore ($)".
  for (const m of t.matchAll(/\b(singapore|hong\s?kong|australia|new\s?zealand|canada|united\s?states|taiwan|malaysia)\s*\(\s*\$\s*\)/gi)) out.push(countryCode(m[1]!.toLowerCase().replace(/\s+/g, " ")) ?? countryCode(m[1]!.toLowerCase().replace(/\s?/g, " ").trim()) ?? "?");
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
  // Glued ("Singapore$"), dotted ("U.S.A. $", "Sing. $", "Aust. $") or spaced all count. "Amounts in Dollars (US)" names it after.
  if (/(?<![A-Za-z])(?:singapore(?:an)?|sing)\.?\s*\$/i.test(t)) out.push("SGD");
  if (/(?<![A-Za-z])(?:united\s*states|u\.?s\.?a?|american?)\.?\s*\$/i.test(t)) out.push("USD");
  for (const m of t.matchAll(/\bdollars?\s*\(\s*(US|USA|USD|S|SG|SGD|HK|HKD|AU|AUD|A|NZ|NZD|NT|C|CAD)\s*\)/gi)) {
    const c = m[1].toUpperCase();
    out.push(c === "S" || c === "SG" || c === "SGD" ? "SGD" : c === "US" || c === "USA" || c === "USD" ? "USD" : c === "HK" || c === "HKD" ? "HKD" : c === "AU" || c === "A" || c === "AUD" ? "AUD" : "?");
  }
  if (/(?<![A-Za-z])(?:hong\s?kong|hk)\.?\s*\$/i.test(t)) out.push("HKD");
  if (/(?<![A-Za-z])(?:aust?|aus)\.?\s*\$/i.test(t)) out.push("AUD");
  if (/(?<![A-Za-z])(?:hong\s?kong|hk|taiwan(?:ese)?|macau|macao|new\s*zealand|nz|kiwi|aussie|australia(?:n)?|canad(?:a|ian)|brunei|fiji(?:an)?|indonesia(?:n)?|philippine|philippines|mexic(?:o|an)|chile(?:an)?|colombia(?:n)?|argentin(?:e|a|ian)|jamaica(?:n)?|bahamas|bahamian|barbad(?:os|ian)|belize(?:an)?|bermuda(?:n)?|bermudian|cayman|guyana|liberia(?:n)?|namibia(?:n)?|solomon|surinam(?:e|ese)?|trinidad|tobago|zimbabwe(?:an)?|caribbean|ecuador|salvador|malaysia(?:n)?|china|chinese|japan(?:ese)?|korea(?:n)?|india(?:n)?|thai(?:land)?|vietnam(?:ese)?|british|european|uruguay(?:an)?|cuba(?:n)?|dominican|nicaragua(?:n)?|venezuela(?:n)?|puerto\s+rico|filipino|straits)\.?\s*\$/i.test(t)) out.push("?");
  if (/(?<![A-Za-z])dollars?\b/i.test(t) && !out.length) out.push("$");
  for (const w of ["yen", "yuan", "renminbi", "rupees?", "rupiah", "baht", "won", "francs?", "dong", "kr(?:ona|one|oner)", "dirhams?", "riyals?", "rials?", "rand", "kyat", "riel", "taka", "patacas?", "dinars?", "lira", "roubles?", "rubles?", "reais", "zloty", "shekels?", "kip", "rufiyaa", "liras?"]) if (new RegExp(`\\b${w}\\b`, "i").test(t)) out.push("?");
  // A currency named in words with no sign or code beside the figure ("Currency: Singapore", "Currency - US", "In Singapore
  // currency"): the named one, or another currency (Test engineer #577 F2).
  for (const m of t.matchAll(/\bcurrency\s*[:\-\t ]\s*([A-Za-z.]+(?: [A-Za-z]+)?)/gi)) {
    const w = m[1]!.toLowerCase().replace(/\./g, "").trim();
    const c = countryCode(w) ?? countryCode(w.split(" ")[0]!);
    if (c) out.push(c);
  }
  for (const m of t.matchAll(/\bin\s+([A-Za-z]+(?: [A-Za-z]+)?)\s+currency\b/gi)) { const c = countryCode(m[1]!.toLowerCase()); if (c) out.push(c); }
  // More marks beside a figure: "Rm"/"R.M." are ringgit; the others are another currency ("P100,000" peso, "R100,000" rand, "Stg", "Fr.", "SFr", "Dhs", "CNH", "円", "元").
  if (/(?<![A-Za-z])R\.M\.(?![A-Za-z])/i.test(t) || /(?<![A-Za-z])Rm(?![A-Za-z])/i.test(t)) out.push("MYR");
  if (/(?<![A-Za-z])(?:Stg|Fr\.|SFr|Dhs|DH|SR|CNH|RS|Re)\.?\s?\d/.test(t) || /(?<![A-Za-z])[PR]\s?\d{1,3}[,.]\d{3}/.test(t) || /[円元]/.test(t)) out.push("?");
  return [...new Set(out)];
}


