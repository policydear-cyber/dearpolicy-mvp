/**
 * Convert insurer / AI currency labels into ISO 4217 codes accepted by Intl.
 * Insurance PDFs often print symbols such as S$, US$, RM or ₱ instead of codes.
 * normalizeCurrencyCode() takes the fallback its caller chooses; formatMoney()
 * never assumes one (Round 16): an amount with no stated currency is shown as
 * a plain number that says its currency is unknown, and an unrecognised
 * label is printed as written -- never as S$.
 */
/** The currency a value actually states, or null. Never assumes SGD: an
 * empty value or a bare "$" names no currency. Use this wherever a missing
 * currency must stay missing (stored amounts, totals, seeds). */
export function statedCurrencyCode(value: string | null | undefined): string | null {
  return normalizeCurrencyCode(value, "") || null;
}

/** The currency an amount is in: the code its own text states, or -- for a bare "$" only -- the currency its document
 * establishes elsewhere (a verified cover currency, a policy-currency line), when that currency is itself written with
 * "$" (SGD, USD, AUD, HKD...). Anything else is null: a "$" in a euro policy, or with no established currency, names
 * none. Never a default. */
export function currencyOfAmount(printed: string | null | undefined, established?: string | null): string | null {
  const own = statedCurrencyCode(printed);
  if (own) return own;
  if (String(printed ?? "").trim() !== "$") return null;
  const doc = statedCurrencyCode(established);
  return doc && writtenWithDollar(doc) ? doc : null;
}
function writtenWithDollar(code: string): boolean {
  try { return new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).format(0).includes("$"); }
  catch { return false; }
}

export function normalizeCurrencyCode(value: string | null | undefined, fallback = "SGD") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const compact = raw.toUpperCase().replace(/\s+/g, "");

  const aliases: Record<string, string> = {
    "S$": "SGD",
    "SG$": "SGD",
    "$S": "SGD",
    "SINGAPOREDOLLAR": "SGD",
    "SINGAPOREDOLLARS": "SGD",
    "$": fallback,
    "US$": "USD",
    "USＤ": "USD",
    "USD$": "USD",
    "A$": "AUD",
    "AU$": "AUD",
    "C$": "CAD",
    "CA$": "CAD",
    "HK$": "HKD",
    "NZ$": "NZD",
    "HKD$": "HKD",
    "RM": "MYR",
    "MYRRM": "MYR",
    "₱": "PHP",
    "PESO": "PHP",
    "PESOS": "PHP",
    "¥": "JPY",
    "￥": "JPY",
    "RMB": "CNY",
    "CN¥": "CNY",
    "€": "EUR",
    "£": "GBP",
    "₹": "INR",
    "₩": "KRW",
    "฿": "THB",
    "RP": "IDR",
    // Signs of one currency only, from a closed list (cross-page check, 31 Oct: "R$" was read as no currency). "Rs", "kr",
    // "Fr." and a bare "$" are left out: several countries print them.
    "NTD": "TWD",
    "YEN": "JPY",
    "NIS": "ILS",
    "SGD$": "SGD",
    "RP.": "IDR",
    "EURO": "EUR",
    "EUROS": "EUR",
    "R$": "BRL",
    "MX$": "MXN",
    "NT$": "TWD",
    "₫": "VND",
    "₺": "TRY",
    "₪": "ILS",
    "₦": "NGN",
    "₴": "UAH",
    "₽": "RUB",
    "৳": "BDT",
    "ZŁ": "PLN",
    "KČ": "CZK",
    "S/": "PEN",
    "S/.": "PEN",
  };

  if (aliases[compact]) return aliases[compact];
  // A label that is written but not recognised stays unknown (""): it is never the caller's fallback, so never SGD
  // ("TPD", "TL" or "Rs" is no currency we can name). Only an empty value takes the fallback its caller chose.
  if (/^[A-Z]{3}$/.test(compact) && isIsoCurrency(compact)) return compact;
  return "";
}

/** Whether a three-letter code is a real currency: the runtime's own closed list of ISO 4217 codes ("TPD" or "MED" is
 * never one, though Intl formats any three letters). Where the runtime has no list, a code it formats is taken. */
let isoList: Set<string> | null | undefined;
export function isIsoCurrency(code: string): boolean {
  if (isoList === undefined) {
    try { isoList = new Set((Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency") ?? []); if (!isoList.size) isoList = null; }
    catch { isoList = null; }
  }
  if (isoList) return isoList.has(code);
  try { new Intl.NumberFormat("en", { style: "currency", currency: code }).format(0); return true; } catch { return false; }
}

/** A money sign or code printed before a figure, in any market: "S$", "US$", "RM", "£", "€", "MYR", "GBP", or a bare "$".
 * A regular-expression source (no flags of its own, safe under /i): a code or "RM" is never part of a word ("FORM 2" is
 * not RM 2). Use it wherever a check asks "is a money figure printed here?", so a page in ringgit or pounds is checked
 * as one in Singapore dollars is (benefit-table parity test, 25 Oct). */
export const MONEY_SIGN = String.raw`(?:(?<![A-Za-z])(?:S|SG|US|HK|A|AU|NZ)\$|(?<![A-Za-z])(?:SGD|USD|MYR|HKD|AUD|NZD|EUR|GBP|RM)(?![A-Za-z])|[€£]|\$)`;

/** Any money figure in any currency, for checks that must SEE money but never read its currency: "is a second limit
 * printed beside this cap?", "does this line start another row with its own figure?". Wider than MONEY_SIGN on purpose: a
 * sign it misses lets a cap printed with a second limit through (TE P145-1: ₹, Rs., Rp, ฿, RMB, NT$, ₩, VND, C$, CAD, ZAR,
 * R, and a code or € after the figure). Seeing too much only withholds an amount. Never part of a word: "FORM 2", "TERM 5"
 * and "PLATFORM 3" are not money (Critic R226). A code after a figure follows the same refusals and cell rule as FIGURE
 * in lib/chat/answer-verification.ts (dates, ages, IDs; Critic #449), and a plan's own number before a code and its figure
 * ("Plan 3 SGD 100,000") is the plan's name, never money: an allow-list of plan words. Groups: 1 is the figure before a sign, 2 the figure after one. */
const ISO_CODES = "SGD|USD|EUR|GBP|JPY|CNY|RMB|HKD|AUD|NZD|CAD|CHF|MYR|IDR|THB|INR|PHP|KRW|TWD|NTD|VND|AED|SAR|QAR|BND|MOP|SEK|NOK|DKK|ZAR|BRL|MXN|RUB|TRY|ILS|LKR|PKR|BDT|MMK|KHR|LAK";
const ANY_SIGN = String.raw`(?:(?<![A-Za-z])(?:[A-Z]{1,3})?\$|\p{Sc}|(?<![A-Za-z])(?:RM|Rs\.?|Rp\.?)(?![A-Za-z])|(?<![A-Za-z])(?:${ISO_CODES})(?![A-Za-z]))`;
// A bare "R" (rand) is read before a figure with a thousands group, after "or", "and", "up to" or "max", and anywhere in a
// text that already prints such an R amount ("up to R100,000 or R900"); "Rider R1" and "Class R 2" are labels (Critic
// R229, TE P145-4).
export const ANY_MONEY_FIGURE = String.raw`${ANY_SIGN}\s?(\d[\d,]*(?:\.\d+)?)|(?<![A-Za-z])(?<![\d.,])(?!(?<=\b(?:19|20)\d\d[-./]\d{1,2}[-./])\d{1,2}(?![\d,.]))(?!(?<=\d[-./]\d{1,2}[-./])\d{4}(?![\d,.]))(?!(?:(?<=\b\d{1,2}[  ](?:[Jj]an(?:uary)?|JAN(?:UARY)?|[Ff]eb(?:ruary)?|FEB(?:RUARY)?|[Mm]ar(?:ch)?|MAR(?:CH)?|[Aa]pr(?:il)?|APR(?:IL)?|[Mm]ay|MAY|[Jj]une?|JUNE?|[Jj]uly?|JULY?|[Aa]ug(?:ust)?|AUG(?:UST)?|[Ss]ep(?:t(?:ember)?)?|SEP(?:T(?:EMBER)?)?|[Oo]ct(?:ober)?|OCT(?:OBER)?|[Nn]ov(?:ember)?|NOV(?:EMBER)?|[Dd]ec(?:ember)?|DEC(?:EMBER)?)\.?[  ]))(?:19|20)\d\d(?![\d,.]))(?!(?<=\b(?:[Aa]ged?|AGED?)[  ]?:?[  ]?)(?:1[01]\d|\d{1,2})(?![\d,.])(?=\s?(?:\p{Sc}|(?:${ISO_CODES}))[ \u00a0\t:;(\-–]*\d))(?!(?<=\b(?:ID|[Nn][Oo]\.|[Nn]umber|NRIC|I/?C)[  ]?:?[  ]?)\d+(?![\d,.])(?=\s?(?:\p{Sc}|(?:${ISO_CODES}))[ \u00a0\t:;(\-–]*\d))(?!(?<=\b(?:[Pp]lan|PLAN|[Tt]ier|TIER|[Oo]ption|OPTION|[Cc]lass|CLASS|[Ll]evel|LEVEL|[Gg]rade|GRADE|[Cc]ategory|CATEGORY|[Tt]ype|TYPE|[Pp]ackage|PACKAGE|[Bb]and|BAND|[Ss]ection|SECTION|[Ss]chedule|SCHEDULE|[Vv]ariant|VARIANT|[Ss]cheme|SCHEME|[Pp]art|PART|[Cc]lause|CLAUSE|[Tt]able|TABLE|[Cc]olumn|COLUMN)(?:s|S)?[ \u00a0\t]*[:#\-–]?[ \u00a0\t]*)\d(?![\d,.])(?=\s?(?:\p{Sc}|(?:${ISO_CODES}))[ \u00a0\t]*\d[\d,]*(?:\.\d+)?(?!\d|[.,]\d|\s?(?:\p{Sc}|(?:${ISO_CODES}))(?![A-Za-z])|\s*(?:%|per\s*cent|percent)|[ \u00a0\t]*(?:days?|nights?|visits?|claims?|times|trips?|years?|months?|weeks?|hours?|lives|life|persons?|people|child(?:ren)?|adults?|members?|sessions?|treatments?|admissions?|accidents?|polic(?:y|ies)|units?|items?)\b)))(\d[\d,]*(?:\.\d+)?)\s?(?:\p{Sc}|(?:${ISO_CODES})(?![A-Za-z]))(?!(?<=(?:^|[\t\r\n])\d{1,3}\t(?:\p{Sc}|(?:${ISO_CODES})))[  ](?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?(?!\d|[,.]\d)[  ]*(?:$|[\r\n]|\t(?![  ]*(?:(?:\p{Sc}|(?:${ISO_CODES}))|(?:days?|nights?|visits?|claims?|times|trips?|years?|months?|weeks?|hours?|lives|life|persons?|people|child(?:ren)?|adults?|members?|per|each|x|sessions?|treatments?|admissions?|accidents?|polic(?:y|ies)|units?|items?)\b))|[,;:)](?![  ]*(?:days?|nights?|visits?|claims?|times|trips?|years?|months?|weeks?|hours?|lives|life|persons?|people|child(?:ren)?|adults?|members?|per|each|x|sessions?|treatments?|admissions?|accidents?|polic(?:y|ies)|units?|items?)\b)|\.(?!\d)))|(?<![A-Za-z])R\s?(\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?)(?![\d])|(?<=\b(?:or|and|to|max(?:imum)?)\s+)R\s?(\d[\d,]*(?:\.\d+)?)`;
/** Every money figure of a text in any currency, with where it starts and how long it is (see ANY_MONEY_FIGURE). */
export function anyMoneyFigures(text: string): { value: number; index: number; length: number }[] {
  const found = [...(text ?? "").matchAll(new RegExp(ANY_MONEY_FIGURE, "gu"))];
  const out = found.map((m) => ({ value: Number((m[1] ?? m[2] ?? m[3] ?? m[4]).replace(/[, ]/g, "")), index: m.index!, length: m[0].length }));
  if (found.some((m) => m[3] != null || m[4] != null))
    for (const m of (text ?? "").matchAll(/(?<![A-Za-z])R\s?(\d[\d,]*(?:\.\d+)?)/gu))
      if (!out.some((f) => m.index! < f.index + f.length && f.index < m.index! + m[0].length)) out.push({ value: Number(m[1].replace(/,/g, "")), index: m.index!, length: m[0].length });
  return out.filter((f) => Number.isFinite(f.value)).sort((a, b) => a.index - b.index);
}

export const CURRENCY_NOT_STATED = "(currency unknown)";
// An amount with cents shows both digits ("41.10", never "41.1"); a whole amount shows none.
// Formatters are built once per set of options and reused: building one is most of the cost of formatting a figure, and a
// page of several hundred benefits formats thousands of them. Same options, same text, as toLocaleString gives.
const formatters = new Map<string, Intl.NumberFormat>();
function formatter(currency: string | null, min: number | undefined, max: number): Intl.NumberFormat {
  const key = `${currency ?? ""}|${min ?? ""}|${max}`;
  let made = formatters.get(key);
  if (!made) {
    made = currency
      ? new Intl.NumberFormat("en-SG", { style: "currency", currency, minimumFractionDigits: min, maximumFractionDigits: max })
      : new Intl.NumberFormat("en-SG", { minimumFractionDigits: min, maximumFractionDigits: max });
    formatters.set(key, made);
  }
  return made;
}
const plainNumber = (amount: number) => { const digits = Math.round(Math.abs(amount) * 100) % 100 === 0 ? 0 : 2; return formatter(null, digits, digits).format(amount); };

export function formatMoney(value: number | string | null | undefined, currency?: string | null) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const amount = Number.isFinite(numeric) ? numeric : 0;
  // Round 16: the currency printed, or none -- never a default. A missing or
  // bare "$" currency is unknown and says so; an unrecognised label is kept.
  const code = statedCurrencyCode(currency);
  if (!code) {
    const raw = String(currency ?? "").trim();
    return raw && raw !== "$" ? `${raw} ${plainNumber(amount)}` : `${plainNumber(amount)} ${CURRENCY_NOT_STATED}`;
  }
  try {
    // Whole amounts of 1,000 or more drop the cents; an amount that has cents
    // keeps them (a S$1,936.50 premium is never shown as S$1,937).
    const whole = Math.abs(amount) >= 1000 && Math.round(Math.abs(amount) * 100) % 100 === 0;
    const formatted = formatter(code, whole ? 0 : Math.abs(amount) >= 1000 ? 2 : undefined, whole ? 0 : 2).format(amount);
    // Singapore's locale often renders SGD with a bare "$". DearPolicy uses an
    // explicit prefix so insurance amounts are never confused with USD -- and
    // only SGD is ever given the S$ prefix.
    // (Intl separates a code from the figure with a no-break space; a plain space reads and matches the same everywhere.)
    const shown = formatted.replace(/\u00a0/g, " ");
    if (code === "SGD" && shown.startsWith("$")) return `S${shown}`;
    if (code !== "SGD" && /^\$/.test(shown)) return `${code} ${plainNumber(amount)}`;
    return shown;
  } catch {
    // Last-resort display safety: malformed data must never take down the app.
    return `${code} ${plainNumber(amount)}`;
  }
}
