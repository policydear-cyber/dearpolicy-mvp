/**
 * The period a schedule line prints for its figure ("Monthly benefit £2,400", "Santunan harian Rp 500.000", "S$1,000,000
 * per policy year"), in any of the languages a schedule is printed in. A figure paid per day, week or month is an income,
 * not a sum: it is always shown with its period, on every page, and never added into a total (cross-page check, 31 Oct:
 * Home showed Disability Income "2,400" as if it were a lump sum).
 *
 * Pure and browser-safe: no imports.
 */
export type LinePeriod = "day" | "week" | "month" | "year";

/** Categories whose figure is paid per period by their nature: a figure on such a line with no printed period has no
 * stated basis, so it is not shown at all (no amount is better than one that reads as a lump sum). */
export const PERIODIC_CATEGORIES = new Set(["Disability Income", "Hospital Cash"]);

// Closed lists of printed period words, whole words only. English, Malay/Indonesian, Spanish, Portuguese, German, French,
// Italian, Vietnamese and Chinese/Japanese. "p.m." and "p.a." only with their dots.
const B = String.raw`(?<![\p{L}\p{N}])`, E = String.raw`(?![\p{L}\p{N}])`;
const WORDS: [LinePeriod, string[]][] = [
  ["day", ["per day", "a day", "each day", "every day", "per night", "a night", "daily", "per diem", "p\\.d\\.", "/ ?day", "/ ?night",
    "harian", "per hari", "sehari", "setiap hari", "/ ?hari", "por día", "por dia", "diari[oa]s?", "diári[oa]s?", "pro tag", "täglich(?:e[nrs]?)?", "tägl\\.",
    "par jour", "journali(?:er|ère)s?", "al giorno", "giornaliero", "giornaliera", "mỗi ngày", "hằng ngày", "hàng ngày", "/ ?ngày"]],
  ["week", ["per week", "a week", "each week", "every week", "weekly", "/ ?week", "mingguan", "per minggu", "seminggu", "/ ?minggu", "semanal(?:es)?", "semanais", "por semana",
    "pro woche", "wöchentlich(?:e[nrs]?)?", "par semaine", "hebdomadaire", "alla settimana", "settimanale", "mỗi tuần", "hằng tuần", "hàng tuần"]],
  ["month", ["per month", "a month", "each month", "every month", "monthly", "/ ?month", "/ ?mth", "per mth", "p\\.m\\.", "bulanan", "per bulan", "sebulan",
    "setiap bulan", "/ ?bulan", "mensual(?:es)?", "por mes", "mensa(?:l|is)", "por mês", "pro monat", "monatlich(?:e[nrs]?)?", "monatl\\.", "par mois", "mensuel(?:le)?s?",
    "al mese", "mensile", "mỗi tháng", "hằng tháng", "hàng tháng", "/ ?tháng"]],
  ["year", ["per year", "a year", "each year", "every year", "per annum", "p\\.a\\.", "annual", "annually", "yearly", "/ ?year", "/ ?yr",
    "per (?:policy|calendar|insurance|benefit) year", "in any (?:policy )?year", "tahunan", "per tahun", "setahun", "setiap tahun", "/ ?tahun",
    "anua(?:l|les|is)", "por año", "por ano", "pro jahr", "jährlich(?:e[nrs]?)?", "par an", "annuel(?:le)?s?", "all'anno", "annuale", "mỗi năm", "hằng năm", "hàng năm"]],
];
// Chinese and Japanese words are not set off by spaces, so they are matched anywhere ("住院日額").
const CJK: Record<LinePeriod, string[]> = { day: ["每日", "每天", "日額", "日额"], week: ["每周", "每週"], month: ["每月", "月額", "月额"], year: ["每年", "年額", "年额"] };
const PATTERNS = WORDS.map(([p, ws]) => [p, new RegExp(B + "(?:" + ws.map((w) => w.replace(/ /g, "\\s+")).join("|") + ")" + E + "|" + CJK[p].join("|"), "iu")] as const);
// A premium or contribution printed on the line: its period is the payment's, never the cover's.
const PAYMENT = new RegExp(B + "(?:premiums?|contributions?|caruman|sumbangan|premi|prämie|beitrag|prime|cotisation|premio|prêmio|prémio|primas?|phí bảo hiểm|保费|保費)" + E, "iu");

const periodsIn = (t: string) => PATTERNS.filter(([, re]) => re.test(t)).map(([p]) => p);
/** Whether a clause prints this amount, in any grouping ("3,000", "3.000", "3 000", "3000.00"). */
const printsAmount = (clause: string, amount: number) =>
  [...clause.matchAll(/\d(?:[\d.,'’ \u00a0]*\d)?/g)].some((m) => {
    const digits = m[0].replace(/[^\d]/g, "");
    return digits === String(Math.round(amount)) || digits === String(Math.round(amount * 100)) || digits === String(Math.round(amount * 1000));
  });
/** The one period the line prints, or null when it prints none, a payment's, or more than one. With the line's amount, a
 * line printing two periods ("Daily S$100, max S$3,000 per year") gives the period of the clause that prints the amount. */
export function printedLinePeriod(text: string | null | undefined, amount?: number | null): LinePeriod | null {
  const t = String(text ?? "");
  if (!t || PAYMENT.test(t)) return null;
  const found = periodsIn(t);
  if (found.length === 1) return found[0];
  if (found.length < 2 || amount == null) return null;
  const clauses = t.split(/(?<!\d),|,(?!\d)|[;\n]|\s[-–—]\s/).filter((c) => printsAmount(c, amount));
  const own = clauses.length === 1 ? periodsIn(clauses[0]) : [];
  return own.length === 1 ? own[0] : null;
}

/** What a schedule line's figure shows: its amount and printed period. A periodic category's figure with no printed
 * period is withheld (amount null). */
export function lineFigure(category: string, amount: number | null, evidenceText: string | null | undefined): { amount: number | null; period: LinePeriod | null } {
  if (amount == null) return { amount: null, period: null };
  const period = printedLinePeriod(evidenceText, amount);
  if (!period && PERIODIC_CATEGORIES.has(category)) return { amount: null, period: null };
  return { amount, period };
}

/** "a month", "a day": the words shown after a figure paid per period. */
export function linePeriodWords(period: LinePeriod | null | undefined): string {
  return period ? `a ${period}` : "";
}
