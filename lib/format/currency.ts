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
  };

  if (aliases[compact]) return aliases[compact];
  if (/^[A-Z]{3}$/.test(compact)) {
    try {
      // Intl is the final authority for whether the runtime accepts the code.
      new Intl.NumberFormat("en", { style: "currency", currency: compact }).format(0);
      return compact;
    } catch {
      return fallback;
    }
  }
  return fallback;
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
 * and "PLATFORM 3" are not money (Critic R226). Groups: 1 is the figure before a sign, 2 the figure after one. */
const ISO_CODES = "SGD|USD|EUR|GBP|JPY|CNY|RMB|HKD|AUD|NZD|CAD|CHF|MYR|IDR|THB|INR|PHP|KRW|TWD|NTD|VND|AED|SAR|QAR|BND|MOP|SEK|NOK|DKK|ZAR|BRL|MXN|RUB|TRY|ILS|LKR|PKR|BDT|MMK|KHR|LAK";
const ANY_SIGN = String.raw`(?:(?<![A-Za-z])(?:[A-Z]{1,3})?\$|\p{Sc}|(?<![A-Za-z])(?:RM|Rs\.?|Rp\.?)(?![A-Za-z])|(?<![A-Za-z])(?:${ISO_CODES})(?![A-Za-z]))`;
// A bare "R" (rand) is read before a figure with a thousands group, after "or", "and", "up to" or "max", and anywhere in a
// text that already prints such an R amount ("up to R100,000 or R900"); "Rider R1" and "Class R 2" are labels (Critic
// R229, TE P145-4).
export const ANY_MONEY_FIGURE = String.raw`${ANY_SIGN}\s?(\d[\d,]*(?:\.\d+)?)|(?<![\d.,])(\d[\d,]*(?:\.\d+)?)\s?(?:\p{Sc}|(?:${ISO_CODES})(?![A-Za-z]))|(?<![A-Za-z])R\s?(\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?)(?![\d])|(?<=\b(?:or|and|to|max(?:imum)?)\s+)R\s?(\d[\d,]*(?:\.\d+)?)`;
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
const plainNumber = (amount: number) => amount.toLocaleString("en-SG", { maximumFractionDigits: Math.abs(amount) >= 1000 && Math.round(Math.abs(amount) * 100) % 100 === 0 ? 0 : 2 });

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
    const formatted = new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency: code,
      minimumFractionDigits: whole ? 0 : Math.abs(amount) >= 1000 ? 2 : undefined,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
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
