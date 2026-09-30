/**
 * Convert insurer / AI currency labels into ISO 4217 codes accepted by Intl.
 * Insurance PDFs often print symbols such as S$, US$, RM or ₱ instead of codes.
 * Unknown values fall back to SGD in this Singapore-first local build so a bad
 * extraction can never crash the UI.
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

export function formatMoney(value: number | string | null | undefined, currency?: string | null) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const amount = Number.isFinite(numeric) ? numeric : 0;
  const code = normalizeCurrencyCode(currency, "SGD");
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
    // explicit prefix so insurance amounts are never confused with USD.
    if (code === "SGD" && formatted.startsWith("$")) return `S${formatted}`;
    return formatted;
  } catch {
    // Last-resort display safety: malformed data must never take down the app.
    return `${code} ${amount.toLocaleString("en-SG", { maximumFractionDigits: Math.abs(amount) >= 1000 && Math.round(Math.abs(amount) * 100) % 100 === 0 ? 0 : 2 })}`;
  }
}
