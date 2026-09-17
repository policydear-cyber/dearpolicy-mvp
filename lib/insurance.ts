export const COVERAGE_CATEGORIES = [
  "Hospitalisation",
  "Hospital Cash",
  "Death",
  "Critical Illness",
  "Early Critical Illness",
  "Total Permanent Disability",
  "Personal Accident",
  "Disability Income",
  "Outpatient",
  "Long-term Care",
  "Travel",
  "Home",
  "Motor",
  "Savings",
  "Investment",
] as const;

export function normalizePersonName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function normalizeCoverageCategory(value: string) {
  const v = value.toLowerCase();
  if (/hospital.*cash|daily.*hospital.*cash|cash.*hospital/.test(v)) return "Hospital Cash";
  if (/hospital|medical shield|integrated shield/.test(v)) return "Hospitalisation";
  if (/early.*critical|critical.*early|living care plus/.test(v)) return "Early Critical Illness";
  if (/critical|living care/.test(v)) return "Critical Illness";
  if (/total.*permanent|\btpd\b/.test(v)) return "Total Permanent Disability";
  if (/personal accident|accident/.test(v)) return "Personal Accident";
  if (/disability income/.test(v)) return "Disability Income";
  if (/outpatient/.test(v)) return "Outpatient";
  if (/careshield|long.?term care/.test(v)) return "Long-term Care";
  if (/travel/.test(v)) return "Travel";
  if (/home|contents/.test(v)) return "Home";
  if (/motor|car/.test(v)) return "Motor";
  if (/investment|\bilp\b/.test(v)) return "Investment";
  if (/saving|endowment/.test(v)) return "Savings";
  if (/death|term life|whole life|group term life/.test(v)) return "Death";
  return value.trim() || "Other";
}

export function annualisePremium(amount: number, frequency?: string | null) {
  const f = (frequency ?? "").toLowerCase();
  if (/month/.test(f)) return amount * 12;
  if (/quarter/.test(f)) return amount * 4;
  if (/semi|half.?year|6 month/.test(f)) return amount * 2;
  if (/week/.test(f)) return amount * 52;
  if (/year|annual/.test(f)) return amount;
  return amount;
}

export function monthlyEquivalent(amount: number, frequency?: string | null) {
  return annualisePremium(amount, frequency) / 12;
}
