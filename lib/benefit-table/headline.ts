/** Coverage's summary of one cover: which few rows lead its card, the short text of each amount, and the full list grouped
 * by section. Pure, and used in the browser, so it takes only the fields the page receives. Nothing here changes an
 * amount: it chooses which rows to show first and how to word them, never a figure. */
import { periodWords, type Figure, type TableRow } from "./assemble";

export type SummaryRow = Pick<TableRow, "benefit" | "section" | "pays" | "figure" | "qualifier" | "fromDay" | "maxDays" | "conditions"> &
  Partial<Pick<TableRow, "percent" | "base">>;

export const MAX_KEY = 8;
/** A cover most of whose rows pay "as charged" (a hospital plan) shows fewer: they all look alike. */
export const MAX_KEY_AS_CHARGED = 5;

const LIFE = /\b(?:death|dies|tpd|total\s+(?:and|&)\s+permanent|permanent\s+total|terminal(?:ly)?\s+ill|critical\s+illness|dread\s+disease|(?:late|early|intermediate)[\s-]stage)\b/i;
const HOSPITAL = /\b(?:ward|room\s+(?:and|&)\s+board|hospital\s+(?:stay|charges|expenses|benefit)|in-?\s?patient|intensive\s+care|icu|surg(?:ery|ical|eon))\b/i;
const OWN_SHARE = /\b(?:deductible|co-?\s?insurance|co-?\s?payment|excess)\b/i;

/** What a row pays in a few words: "As charged", "Up to S$5,000", "S$150 a day", "S$125,000". Never a figure the row does
 * not carry; a row with no amount says why in `note`. */
export function shortFigure(r: SummaryRow): { text: string; note: string | null } {
  const f = r.figure;
  const m = (x: { amount: number; currency: string | null }) => money(x.amount, x.currency) + (x.currency ? "" : " (currency not stated)");
  if (f.kind === "none") {
    if (r.pays === "as_charged") return { text: "As charged", note: null };
    if (r.pays === "not_covered") return { text: "Not covered", note: null };
    return { text: "See the page", note: f.why };
  }
  if (f.kind === "value") return { text: `${m(f)} value`, note: f.asOf ? `as of ${f.asOf}` : "date not stated" };
  if (f.kind === "projected") return { text: `${m(f)} projected`, note: `${f.basis === "non_guaranteed" ? "not guaranteed" : "an illustration"}: not an amount held or payable` };
  // The short form of how it was worked out ("50% of S$250,000"); the full wording, with where the base is printed, is in
  // the chat and on the page.
  if (f.kind === "worked_out") return { text: f.capped ? `Up to ${m(f)}` : m(f),
    note: r.percent != null && r.base != null ? `${r.percent}% of ${money(r.base, f.currency)}${f.capped ? ", capped at the most it pays" : ""}` : f.how };
  const t = f.unit === "up_to" ? `Up to ${m(f)}` : f.unit === "per_day" ? `${m(f)} a day` : f.unit === "per_period" ? `${m(f)} ${periodWords(f.period)}` : m(f);
  return { text: t, note: null };
}

/** The small line under a benefit: who the figure is for, its days, and every condition ("Only 1 claim", "max 6 claims"),
 * on key rows and in the full list alike (Critic R116-1, TE #99). */
export function rowDetail(r: SummaryRow): string {
  return [r.qualifier ? `for ${r.qualifier}` : null, r.fromDay != null ? `from day ${r.fromDay}` : null, r.maxDays != null ? `up to ${r.maxDays} days` : null, ...r.conditions]
    .filter(Boolean).join(" · ");
}

/** A benefit's name without the row letter or number its table prints before it ("J, ", "D. ", "(a) "): that is the
 * document's layout, not the benefit's name. A letter followed by a comma is a row letter only when a word follows it,
 * not another single letter ("D, E and F Benefit" is a list, TE #101). Use benefitNames for a set of rows. */
export const benefitName = (benefit: string) =>
  benefit.replace(/^\s*(?:(?:[A-Z]|\d{1,2})\s*[.):]|[A-Z],(?!\s*[A-Z](?:\s|,|$))|\(?(?:[a-z]|[ivx]{1,4})\))\s+(?=[A-Z])/, "").trim() || benefit;

/** Each row's benefit name for display, without row letters, except where stripping them would make two different
 * benefits of one cover read the same: two different row letters before one name ("A. Death" and "B. Death") stay as
 * printed (TE #101). The same benefit printed with and without its letter in two documents ("J, Accidental Hospital
 * Recuperation Benefit" in one, "Accidental Hospital Recuperation Benefit" in the other) is one benefit, shown without it. */
export function benefitNames<T extends { benefit: string; coverKey?: string }>(rows: T[]): (row: T) => string {
  const key = (r: T) => `${r.coverKey ?? ""}\u0000${benefitName(r.benefit).toLowerCase()}`;
  const letter = (b: string) => b.trim().slice(0, b.trim().length - benefitName(b).length).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const letters = new Map<string, Set<string>>();
  for (const r of rows) if (letter(r.benefit)) letters.set(key(r), (letters.get(key(r)) ?? new Set()).add(letter(r.benefit)));
  return (r) => ((letters.get(key(r))?.size ?? 0) > 1 ? r.benefit : benefitName(r.benefit));
}

const amountOf = (f: Figure) => (f.kind === "printed" || f.kind === "worked_out" ? f.amount : 0);

/** The rows that lead a cover's card, as indexes into `rows`, in the order shown: death, disability and critical illness;
 * then ward and surgery; then what the person pays themselves (deductible, co-insurance); then the largest fixed amounts.
 * A projection, a "not covered" row, a row with no amount that is not "as charged", and a second row with the same
 * benefit name are never chosen. */
export function keyBenefits(rows: SummaryRow[]): number[] {
  const usable = rows.map((r, i) => ({ r, i })).filter(({ r }) =>
    r.figure.kind !== "projected" && r.pays !== "not_covered" && (r.figure.kind !== "none" || r.pays === "as_charged"));
  const tier = (r: SummaryRow) => (LIFE.test(r.benefit) ? 0 : HOSPITAL.test(r.benefit) ? 1 : OWN_SHARE.test(r.benefit) ? 2 : 3);
  const ordered = usable.sort((a, b) => tier(a.r) - tier(b.r) || (tier(a.r) === 3 ? amountOf(b.r.figure) - amountOf(a.r.figure) : 0) || a.i - b.i);
  const asCharged = rows.filter((r) => r.pays === "as_charged").length * 2 > rows.length;
  const max = asCharged ? MAX_KEY_AS_CHARGED : MAX_KEY;
  const seen = new Set<string>(), out: number[] = [];
  for (const { r, i } of ordered) {
    const name = r.benefit.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(name)) continue;
    // A row with no fixed amount only leads when it is one of the named kinds above.
    if (tier(r) === 3 && amountOf(r.figure) === 0) continue;
    seen.add(name); out.push(i);
    if (out.length === max) break;
  }
  return out;
}

/** Every row of a cover, grouped by its section in the order the sections first appear; rows with no section last. */
export function bySection<T extends { section: string | null }>(rows: T[]): { section: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.section?.trim() || "";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const named = [...groups].filter(([k]) => k).map(([section, rs]) => ({ section, rows: rs }));
  const rest = groups.get("");
  return rest ? [...named, { section: named.length ? "Other" : "Benefits", rows: rest }] : named;
}

/** As lib/benefit-table/assemble.ts writes an amount (not imported from there: this module runs in the browser). */
export function money(n: number, currency: string | null): string {
  return `${currency === "SGD" ? "S$" : currency ? currency + " " : "$"}${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
