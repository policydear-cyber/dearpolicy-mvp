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
// " " in a listed word is any run of spaces, " ?" any or none ("/ ?day" reads "/day" and "/ day").
const spaced = (w: string) => w.replace(/ \?/g, "\\s*").replace(/ /g, "\\s+");
const PATTERNS = WORDS.map(([p, ws]) => [p, new RegExp(B + "(?:" + ws.map(spaced).join("|") + ")" + E + "|" + CJK[p].join("|"), "iu")] as const);
// A premium or contribution printed on the line: its period is the payment's, never the cover's.
const PAYMENT = new RegExp(B + "(?:premiums?|contributions?|caruman|sumbangan|premi|prämie|beitrag|prime|cotisation|premio|prêmio|prémio|primas?|phí bảo hiểm|保费|保費)" + E, "iu");

const periodsIn = (t: string) => PATTERNS.filter(([, re]) => re.test(t)).map(([p]) => p);
// The same words, read only where they start: right after a figure ("S$150/day", "S$2,000 per month"), after any currency
// printed behind it ("2,000 SGD a month", "500.000 ₫ mỗi ngày"; capitals or a currency sign only, never a word).
const AFTER = WORDS.map(([p, ws]) => [p, new RegExp("^\\s*(?:" + ws.map(spaced).join("|") + ")" + E + "|^\\s*(?:" + CJK[p].join("|") + ")", "iu")] as const);
const FIGURE = /\d(?:[\d.,'’ \u00a0]*\d)?/g;
/** Whether a printed figure is this amount, in any grouping ("3,000", "3.000", "3 000", "3000.00"). */
const isAmount = (figure: string, amount: number) => {
  const digits = figure.replace(/[^\d]/g, "");
  return digits === String(Math.round(amount)) || digits === String(Math.round(amount * 100)) || digits === String(Math.round(amount * 1000));
};
/** The period attached to the line's figure, or null. A period counts only where it is attached to the figure: right
 * after it ("S$150/day", "S$2,000 per month"), or in the figure's own label right before it, with no other figure or
 * clause break between ("Monthly benefit S$2,000", "Santunan harian Rp 500.000"). A period printed anywhere else on the
 * line ("S$100 (max 30 days per year)", a waiting period, a premium) is not the figure's (coordinator, 31 Oct: strict
 * first). With the line's amount, the figure is the one printing that amount; without, the line's only figure. */
export function printedLinePeriod(text: string | null | undefined, amount?: number | null): LinePeriod | null {
  const t = String(text ?? "");
  if (!t || PAYMENT.test(t)) return null;
  const figures = [...t.matchAll(FIGURE)];
  const own = amount == null ? figures : figures.filter((m) => isAmount(m[0], amount));
  if (own.length !== 1) return null;
  const at = own[0].index!, end = at + own[0][0].length;
  const prev = figures.filter((m) => m.index! < at).pop();
  const base = prev ? prev.index! + prev[0].length : 0;
  let from = base;
  for (const b of t.slice(base, at).matchAll(/[,;:\n(]|\s[-–—]\s/g)) from = base + b.index! + b[0].length;
  const label = t.slice(from, at);
  const after = t.slice(end).split(/[,;:\n(]|\s[-–—]\s|\d/)[0].replace(/^\s*(?:\p{Sc}|[A-Z]{2,3}\$?)(?=[\s/]|$)/u, "");
  const found = new Set<LinePeriod>([...periodsIn(label), ...AFTER.filter(([, re]) => re.test(after)).map(([p]) => p)]);
  return found.size === 1 ? [...found][0] : null;
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
