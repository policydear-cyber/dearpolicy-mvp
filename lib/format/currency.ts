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
