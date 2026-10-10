/**
 * A1 (r6): the terms a printed value carries -- its monetary rate, the unit the rate is paid per, the payable-duration
 * rule, and every cap printed with it (a maximum number of units, a monetary maximum), each cap with its OWN reset
 * period -- each read with its source span (the text and character range it was read from).
 *
 * "Hospital cash (each complete 24 hours, max 90 per year)" is a rate per complete 24-hour period plus a cap of 90
 * qualifying periods per year: "per year" belongs to the cap clause, not to the rate. A cap clause is a cap word
 * (max / maximum / up to / limited to / not exceeding / capped at), a figure, an optional unit and an optional reset
 * period, in either order ("max 90 per year", "90 days per year maximum", "up to 90 per policy year", "maximum
 * S$3,000 per year"). Cap clauses are read first and masked; the rate's unit is read from what is left. A period
 * printed with no figure of its own ("Annual allowance", "per policy year") still belongs to the value.
 *
 * Also the table value parser (parseCell, periodIn, toCents), moved here from the rag2 tables module.
 * Integration (r6): lives in lib/claims so the save-time gate can use it (the rag2 modules re-export it).
 */
import { dayRuleFromWording, type PolicyDayRule } from "@/lib/claims/day-count";

export type Period = "day" | "night" | "visit" | "week" | "month" | "year" | "policy_year" | "event" | "accident" | "lifetime" | "claim" | "operation" | null;
export type ParsedValue =
  | { kind: "money"; cents: number; amount: number; currency: string; unit: string | null; period: Period; raw: string; terms?: ValueTerms }
  | { kind: "percent"; ppm: number; percent: number; unit: "%"; period: Period; raw: string; terms?: ValueTerms }
  | { kind: "count"; count: number; unit: string; period: Period; raw: string; terms?: ValueTerms }
  | { kind: "text"; text: string; raw: string };

/** Where a term was read: `source` names the text (cell, label, header, passage...), `text` is its verbatim slice,
 * `start`/`end` its range -- within the page when the source's page offset is known (`page` set), else within the source. */
export type TermSpan = { source: string; page: number | null; start: number; end: number; text: string };
export type RateUnit = "complete_24h" | "day_or_part" | "day" | "night" | "visit" | "week" | "month" | "year" | "policy_year" | "event" | "accident" | "claim" | "operation" | "lifetime";
/** The period a cap resets over. null: the wording does not say. */
export type CapReset = "year" | "policy_year" | "calendar_year" | "admission" | "disability" | "event" | "accident" | "claim" | "lifetime" | null;
export type CountCap = { kind: "count"; max: number; unit: string | null; reset: CapReset; span: TermSpan };
export type MoneyCap = { kind: "money"; cents: number; currency: string; reset: CapReset; span: TermSpan };
export type ValueTerms = {
  rate: { cents: number; currency: string; span: TermSpan } | null;
  rateUnit: { unit: RateUnit; span: TermSpan } | null;
  durationRule: { rule: PolicyDayRule; span: TermSpan } | null;
  caps: (CountCap | MoneyCap)[];
};
export type TermSource = { source: string; text: string; page?: number | null; offset?: number | null };

const CUR = String.raw`(?:SGD|USD|MYR|HKD|AUD|EUR|GBP|S\$|SG\$|US\$|HK\$|A\$|RM|€|£)`;
const MONEY_RE = new RegExp(String.raw`(${CUR})\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|million)\b)?`, "i");
const FIG = String.raw`(?:${CUR}\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million)\b)?|\d[\d,]*)`;
const UNIT = String.raw`(?:(?:complete(?:d)?\s+)?(?:24[- ]hour\s+)?(?:days?|nights?|periods?|visits?|sessions?|weeks?|months?|times|treatments?|admissions?))`;
const RESET = String.raw`(?:(?:policy|insurance|calendar|benefit)\s+year|year|annum|admission|confinement|hospitali[sz]ation|stay|disability|illness|injury|accident|event|occurrence|lifetime|life\s?time|claim)`;
const PER = String.raw`(?:per|a|each|every|in\s+(?:any|a|one|each)(?:\s+one)?)`;
const CAPW = String.raw`(?:max(?:imum)?\.?(?:\s+of)?|up\s+to(?:\s+a\s+(?:maximum|max\.?)\s+of)?|limited\s+to|not\s+(?:exceeding|more\s+than)|subject\s+to\s+a\s+(?:maximum|limit)\s+of|capped\s+at)`;
/** The cap clauses, most specific first; each names its figure, unit and reset groups. */
const CAP_CLAUSES: { re: RegExp; fig: number; unit: number; reset: number; resetWord?: number }[] = [
  // "90 days per year maximum", "S$3,000 per policy year max"
  { re: new RegExp(String.raw`(?<![\w$])(${FIG})(?:\s+(${UNIT}))?\s+${PER}\s+(${RESET})\s+(?:maximum|max\b\.?|limit\b)`, "gi"), fig: 1, unit: 2, reset: 3 },
  // "90 days maximum per year", "90 days max"
  { re: new RegExp(String.raw`(?<![\w$])(${FIG})(?:\s+(${UNIT}))?\s+(?:maximum|max\b\.?)(?:\s+${PER}\s+(${RESET}))?`, "gi"), fig: 1, unit: 2, reset: 3 },
  // "annual maximum of S$3,000", "lifetime limit S$50,000"
  { re: new RegExp(String.raw`\b(annual|yearly|lifetime)\s+(?:maximum|max\b\.?|limit|cap)\s+(?:of\s+)?(${FIG})(?:\s+(${UNIT}))?`, "gi"), fig: 2, unit: 3, reset: 0, resetWord: 1 },
  // "max 90 per year", "maximum S$3,000 per year", "up to 90 per policy year", "max 60", "up to 20 days per admission"
  { re: new RegExp(String.raw`\b${CAPW}\s+(${FIG})(?:\s+(${UNIT}))?(?:\s+(?:${PER}|for\s+(?:each|any|every))\s+(${RESET}))?`, "gi"), fig: 1, unit: 2, reset: 3 },
];

export function normCurrencySymbol(sym: string): string {
  const s = sym.toUpperCase().replace(/\s/g, "");
  return ({ "S$": "SGD", "SG$": "SGD", "US$": "USD", "HK$": "HKD", "A$": "AUD", RM: "MYR", "€": "EUR", "£": "GBP" } as Record<string, string>)[s] ?? s;
}
/** Integer cents from a printed amount ("1,234.5" -> 123450); exact (string arithmetic, no float). */
export function toCents(digits: string): number {
  const [w, f = ""] = digits.replace(/,/g, "").split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2)) + (f.length > 2 && Number(f[2]) >= 5 ? 1 : 0);
}
function moneyOf(s: string): { cents: number; currency: string } | null {
  const m = s.match(MONEY_RE); if (!m) return null;
  const mult = m[3] ? (/^k$/i.test(m[3]) ? 1000 : 1_000_000) : 1;
  return { cents: toCents(m[2]) * mult, currency: normCurrencySymbol(m[1]) };
}
export function resetOf(word: string | undefined | null): CapReset {
  if (!word) return null;
  const w = word.toLowerCase().replace(/\s+/g, " ");
  if (/^(?:policy|insurance|benefit) year$/.test(w)) return "policy_year";
  if (w === "calendar year") return "calendar_year";
  if (w === "year" || w === "annum" || w === "annual" || w === "yearly") return "year";
  if (/^(?:admission|confinement|hospitali[sz]ation|stay)$/.test(w)) return "admission";
  if (/^(?:disability|illness|injury)$/.test(w)) return "disability";
  if (w === "accident") return "accident";
  if (w === "event" || w === "occurrence") return "event";
  if (w === "claim") return "claim";
  if (/^life ?time$/.test(w)) return "lifetime";
  return null;
}
/** Whether a cap's earlier use can count against this claim: it resets over a period longer than one stay (or the
 * wording names a reset that spans stays). An unstated reset, or one per admission, is applied to this stay alone. */
export function capSpansStays(reset: CapReset): boolean {
  return reset != null && reset !== "admission" && reset !== "claim";
}
export function resetWords(reset: CapReset): string {
  return reset === "policy_year" ? "policy year" : reset === "calendar_year" ? "calendar year" : reset === "year" ? "year" : reset === "admission" ? "admission" : reset ?? "period";
}

const UNIT_RULES: [RateUnit, RegExp][] = [
  ["complete_24h", /\b(?:each|every|per|for\s+each)\s+(?:complete(?:d)?\s+|full\s+|continuous\s+)?(?:period\s+of\s+)?(?:24|twenty[- ]four)[- ]hours?(?:\s+period)?\b|\bcomplete(?:d)?\s+(?:period\s+of\s+)?(?:24|twenty[- ]four)[- ]hours?(?:\s+period)?\b/i],
  ["day_or_part", /\b(?:each|every|per)\s+(?:calendar\s+)?day\s+or\s+part\s+(?:of\s+a\s+day|thereof)\b/i],
  ["night", /\b(?:per|each|every)\s+night\b|\bnightly\b|\bper\s+overnight\b/i],
  ["day", /\bper\s+day\b|\ba\s+day\b|\bdaily\b|\/\s?day\b|\b(?:each|every)\s+(?:full\s+|whole\s+|calendar\s+)?day\b|\bper\s+diem\b/i],
  ["visit", /\bper\s+(?:visit|session)\b|\b(?:each|every)\s+(?:visit|session)\b/i],
  ["week", /\bper\s+week\b|\bweekly\b/i],
  ["month", /\bper\s+month\b|\bmonthly\b/i],
  ["policy_year", /\bper\s+(?:policy|insurance)\s+year\b|\bpolicy\s+year\b/i],
  ["year", /\bper\s+(?:annum|year)\b|\bannual(?:ly)?\b|\bp\.a\.(?!\w)|\byearly\b/i],
  ["accident", /\bper\s+(?:accident|injury)\b/i],
  ["event", /\bper\s+(?:event|occurrence|disability|admission)\b/i],
  ["operation", /\bper\s+(?:operation|surgery)\b/i],
  ["claim", /\bper\s+claim\b/i],
  ["lifetime", /\blifetime\b/i],
];

const spanOf = (s: TermSource, start: number, end: number): TermSpan => {
  const off = s.offset ?? null;
  return { source: s.source, page: off != null ? (s.page ?? null) : null, start: (off ?? 0) + start, end: (off ?? 0) + end, text: s.text.slice(start, end) };
};

/** The terms the given texts print for one value: the value's own cell first, then the texts that qualify it (row
 * label, column header, parent row, section). The rate is the first amount outside a cap clause in the first source
 * that prints one; its unit is read from the first source whose text outside its cap clauses names one. */
export function readValueTerms(sources: TermSource[]): ValueTerms {
  const out: ValueTerms = { rate: null, rateUnit: null, durationRule: null, caps: [] };
  for (const s of sources) {
    const text = s.text ?? "";
    if (!text.trim()) continue;
    let masked = text;
    for (const c of CAP_CLAUSES) {
      c.re.lastIndex = 0;
      for (const m of masked.matchAll(c.re)) {
        const fig = m[c.fig]; if (!fig) continue;
        const start = m.index!, end = start + m[0].length;
        const money = moneyOf(fig);
        const reset = c.resetWord ? resetOf(m[c.resetWord]) : resetOf(m[c.reset]);
        const unit = m[c.unit] ? m[c.unit].toLowerCase().replace(/\s+/g, " ") : null;
        if (money) out.caps.push({ kind: "money", cents: money.cents, currency: money.currency, reset, span: spanOf(s, start, end) });
        else {
          const n = Number(fig.replace(/,/g, ""));
          // A bare figure with no unit that is not a whole count of units is not a cap ("up to 2.5").
          if (!Number.isInteger(n) || n <= 0) continue;
          // Not a percentage or a figure of another kind ("up to 80%", "max 90 years of age").
          const after = masked.slice(end, end + 12);
          if (/^\s*(?:%|percent|years?\s+(?:old|of\s+age))/i.test(after) || (!unit && /^\s*(?:years?|yrs?)\b/i.test(after))) continue;
          out.caps.push({ kind: "count", max: n, unit, reset, span: spanOf(s, start, end) });
        }
        masked = masked.slice(0, start) + " ".repeat(end - start) + masked.slice(end);
      }
    }
    if (!out.rate) {
      const m = masked.match(MONEY_RE);
      if (m) { const money = moneyOf(m[0])!; out.rate = { ...money, span: spanOf(s, m.index!, m.index! + m[0].length) }; }
    }
    if (!out.rateUnit) {
      for (const [unit, re] of UNIT_RULES) {
        const m = re.exec(masked);
        if (m) { out.rateUnit = { unit, span: spanOf(s, m.index, m.index + m[0].length) }; break; }
      }
    }
    if (!out.durationRule) {
      const r = dayRuleFromWording(masked);
      if (r) { const i = masked.indexOf(r.words); out.durationRule = { rule: r.rule, span: spanOf(s, i, i + r.words.length) }; }
    }
  }
  return out;
}

/** The legacy one-word period of a rate unit (complete 24-hour periods and "day or part of a day" are per-day rates). */
export function periodOfUnit(u: RateUnit | null | undefined): Period {
  if (!u) return null;
  if (u === "complete_24h" || u === "day_or_part") return "day";
  return u;
}
/** Units a daily-rate calculator may multiply: a day, a night, a complete 24-hour period, a day or part of a day. */
export const PER_DAY_UNITS: RateUnit[] = ["complete_24h", "day_or_part", "day", "night"];

/** The period a text names for a value, with any cap clause's own period left out ("each complete 24 hours, max 90
 * per year" -> day). */
export function periodIn(text: string): Period {
  return periodOfUnit(readValueTerms([{ source: "text", text }]).rateUnit?.unit);
}

/** The value one cell prints (with the column's currency for a bare figure under "Benefit (S$)"); `context` is what
 * qualifies the cell (row label, column header, parent row, section). The value's period is its rate unit's; a period
 * that belongs to a cap clause ("max 90 per year") is the cap's, never the value's. */
export function parseCell(text: string, columnCurrency: string | null = null, context = ""): ParsedValue {
  const raw = text.trim();
  const terms = readValueTerms([{ source: "cell", text: raw }, { source: "context", text: context }]);
  const period = periodOfUnit(terms.rateUnit?.unit);
  const m = raw.match(MONEY_RE);
  if (m) {
    // The cell's rate (its first amount outside a cap clause), else its first amount.
    const money = terms.rate && terms.rate.span.source === "cell" ? terms.rate : moneyOf(m[0])!;
    return { kind: "money", cents: money.cents, amount: money.cents / 100, currency: money.currency, unit: period ? "per " + period.replace("_", " ") : null, period, raw, terms };
  }
  const p = raw.match(/^(\d+(?:\.\d+)?)\s?%/);
  if (p) { const ppm = Math.round(Number(p[1]) * 10000); return { kind: "percent", ppm, percent: ppm / 10000, unit: "%", period, raw, terms }; }
  const c = raw.match(/^(\d+)\s*(days?|nights?|visits?|weeks?|months?|years?|sessions?|times)\b/i);
  if (c) return { kind: "count", count: Number(c[1]), unit: c[2].toLowerCase().replace(/s$/, ""), period, raw, terms };
  const bare = raw.match(/^(\d[\d,]*(?:\.\d+)?)$/);
  if (bare && columnCurrency) { const cents = toCents(bare[1]); return { kind: "money", cents, amount: cents / 100, currency: columnCurrency, unit: period ? "per " + period : null, period, raw, terms }; }
  if (bare) return { kind: "count", count: Number(bare[1].replace(/,/g, "")), unit: "", period, raw, terms };
  return { kind: "text", text: raw, raw };
}
