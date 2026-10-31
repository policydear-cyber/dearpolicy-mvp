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
const PAYMENT = new RegExp(B + "(?:premiums?|contributions?|caruman|sumbangan|premi|prämie|beitrag|prime|cotisation|premio|prêmio|prémio|primas?|phí bảo hiểm)" + E + "|保费|保費|保険料", "iu");
// Period words that say when or how long, never how often the figure is paid: "24 hours a day", "Yearly Renewable Term",
// "within a month of approval", "waiting period of a year". They are taken out before the figure's period is read.
const NOT_A_PAY_PERIOD = new RegExp([
  String.raw`24\s*(?:hours?|hrs?|jam|giờ|horas|heures|stunden)\b[^,;:\n\d]{0,12}`, "每日\\s*24\\s*小[时時]", "24\\s*小[时時]",
  B + String.raw`(?:yearly|annual(?:ly)?|monthly|annually)\s+renew\w*`, B + String.raw`renew\w*\s+(?:each|every)\s+(?:year|month)`,
  B + String.raw`(?:within|in|dalam(?:\s+tempoh)?|dentro\s+de|innerhalb)\s+(?:(?:a|one|1|the)\s+)?(?:\w+\s+)?(?:day|month|year|sebulan|setahun|sehari)s?` + E,
  B + String.raw`waiting\s+period[^,;:\n\d]{0,20}`,
].join("|"), "giu");

const periodsIn = (t: string) => PATTERNS.filter(([, re]) => re.test(t)).map(([p]) => p);
// The same words, read only where they start: right after a figure ("S$150/day", "S$2,000 per month"), after any currency
// printed behind it ("2,000 SGD a month", "500.000 ₫ mỗi ngày"; capitals or a currency sign only, never a word).
const AFTER = WORDS.map(([p, ws]) => [p, new RegExp("^\\s*(?:" + ws.map(spaced).join("|") + ")" + E + "|^\\s*(?:" + CJK[p].join("|") + ")", "iu")] as const);
const FIGURE = /\d(?:[\d.,'’ \u00a0]*\d)?/g;
/** Whether a printed figure is this amount, in any grouping ("3,000", "3.000", "3 000", "3000.00"). */
const isAmount = (figure: string, amount: number) => {
  // The figure read with "," or "." as the decimal mark, or as a whole number: "100.00", "3.000" and "3,000" are what they
  // print, and "10,000" is never 100 (TE #266 F2).
  const plain = figure.replace(/[\s\u00a0'’]/g, "");
  const readings = [Number(plain.replace(/,/g, "")), Number(plain.replace(/\./g, "").replace(",", ".")), Number(plain.replace(/[.,]/g, ""))];
  return readings.some((v) => Number.isFinite(v) && Math.abs(v - amount) < 0.005);
};
/** The period attached to the line's figure, or null. A period counts only where it is attached to the figure: right
 * after it ("S$150/day", "S$2,000 per month"), or in the figure's own label right before it, with no other figure or
 * clause break between ("Monthly benefit S$2,000", "Santunan harian Rp 500.000"). A period printed anywhere else on the
 * line ("S$100 (max 30 days per year)", a waiting period, a premium) is not the figure's (coordinator, 31 Oct: strict
 * first). With the line's amount, the figure is the one printing that amount; without, the line's only figure. */
export function printedLinePeriod(text: string | null | undefined, amount?: number | null): LinePeriod | null {
  const raw = String(text ?? "");
  if (!raw || PAYMENT.test(raw)) return null;
  // Same length, so positions still line up: "24 hours a day" and the like are blanked, never read.
  const t = raw.replace(NOT_A_PAY_PERIOD, (w) => w.replace(/[\s\S]/g, " "));
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
/** Covers whose figure is one sum paid once (Home adds these up): never shown with a period. One printed with a period
 * attached to it ("Death benefit S$2,000 per month", a family income benefit) is not a sum, so it shows no figure and is
 * never added up, on every page. */
export const LUMP_SUM_LINE_CATEGORIES = new Set(["Death", "Total Permanent Disability", "Critical Illness", "Early Critical Illness", "Personal Accident"]);
export function lineFigure(category: string, amount: number | null, evidenceText: string | null | undefined): { amount: number | null; period: LinePeriod | null } {
  if (amount == null) return { amount: null, period: null };
  const period = printedLinePeriod(evidenceText, amount);
  if (LUMP_SUM_LINE_CATEGORIES.has(category)) return { amount: period ? null : amount, period: null };
  if (!period && PERIODIC_CATEGORIES.has(category)) return { amount: null, period: null };
  return { amount, period };
}

/** "a month", "a day": the words shown after a figure paid per period. */
export function linePeriodWords(period: LinePeriod | null | undefined): string {
  return period ? `a ${period}` : "";
}
