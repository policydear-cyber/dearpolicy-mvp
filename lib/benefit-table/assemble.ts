/** The benefit table, step 2: each person's table from the checked readings. Pure.
 *
 * A person's covers come only from a personal document that prints their name (lib/benefit-table/check.ts). A benefit
 * section reaches a person only through a link from that section to a cover they hold: proposed by the model
 * (LINKING_PROMPT), shown to the household with its reason, and changed by them. Never a name match or "first cover"
 * join in code. The server then works out each amount from the rows themselves:
 *   a printed amount, limit or daily rate      as printed;
 *   a percentage of a fixed amount              the percentage of the figure printed on the same page;
 *   a percentage of the sum insured             the percentage of THIS person's sum insured for the linked cover;
 *   anything else                               no amount, with the reason.
 *   a fund, cash or maturity value              as printed, with the date it is printed for;
 *   a figure the document calls non-guaranteed, or one from an illustration, is shown only as a projection, never as an
 *   amount the person holds or will be paid.
 * Rows from different documents are never added together; each row stands alone. A cover read from an illustration
 * (a quotation) is not proof that the person holds it. */
import { findFamilyMatchWithKind } from "@/lib/policies/linking";
import { CAP_WORDS, type CheckedBenefit, type CheckedCover, type CheckedReading, type Source } from "./check";
import type { CoverType, SectionLink, SectionRef } from "./reading";

export type FamilyMember = { id: string; display_name: string; preferred_name?: string | null };
export type Figure =
  | { kind: "printed"; amount: number; currency: string | null; unit: "lump_sum" | "up_to" | "per_day" | "per_period"; period?: string | null }
  | { kind: "value"; amount: number; currency: string | null; asOf: string | null }
  | { kind: "projected"; amount: number; currency: string | null; basis: "non_guaranteed" | "illustrated"; asOf: string | null }
  /** capped: the percentage came to more than the most the row pays, so the amount is that printed cap. */
  | { kind: "worked_out"; amount: number; currency: string | null; how: string; capped?: boolean }
  | { kind: "none"; why: string };
export type TableRow = {
  personId: string; person: string; coverKey: string; product: string; cover: string; plan: string | null;
  benefit: string; section: string | null; column: string | null; pays: CheckedBenefit["pays"]; figure: Figure;
  fromDay: number | null; maxDays: number | null; conditions: string[]; source: Source; baseSource: Source | null; linkWhy: string;
  /** Who or what the column's figure is for when its heading says so ("child", "per family"): dropped when matching the
   * column to a plan, so it must be shown with the figure and said in any answer (Critic R89-1). */
  qualifier: string | null;
  /** For a percentage row: the percentage, the base it was worked out on, and whether that base is the household's
   * correction rather than a printed figure. */
  percent: number | null; base: number | null; baseCorrected: boolean;
  /** What a percentage row's percentage is of: the person's sum insured, or a fixed amount printed with it. */
  percentOf: CheckedBenefit["percentOf"] | null;
  /** Where a percentage row's printed cap is, when it has one. */
  capSource: Source | null;
};
/** What the household said about one person's cover: that its sum insured is right, or the figure it should be. */
export type Confirmation = { personId: string; coverKey: string; status: "confirmed" | "corrected"; sumInsured: number | null; updatedAt?: string | null };
export type PersonCover = CheckedCover & { personId: string; coverKey: string;
  /** Set when the household confirmed or corrected this cover; `printed` is the sum insured the document prints. */
  confirmation: (Confirmation & { printed: number | null }) | null };
export type BenefitTable = {
  people: { id: string; name: string; covers: PersonCover[]; rows: TableRow[] }[];
  /** Covers printed for someone who is not (or not unambiguously) a family member. */
  unmatchedCovers: CheckedCover[];
  /** Covers printed in an illustration (a quotation): not proof the person holds them. */
  illustrationCovers: CheckedCover[];
  /** Sections no cover was linked to, with why: shown to the household, never silently dropped. */
  unlinkedSections: { section: SectionRef; why: string; source: Source | null }[];
  /** Confirmations for a cover the documents no longer show for that person (a re-read changed it): shown to check again. */
  staleConfirmations: Confirmation[];
  /** Links refused by the server's own checks. */
  refusedLinks: { link: SectionLink; why: string }[];
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const coverKeyOf = (c: { product: string; cover: string; plan: string | null; riderOf?: string | null }) =>
  [norm(c.product), norm(c.cover), norm(c.plan), ...(c.riderOf ? [norm(c.riderOf)] : [])].join("|");
export const sectionKeyOf = (documentId: string, b: { section: string | null; column: string | null }) => [documentId, norm(b.section), norm(b.column)].join("|");
const cents = (n: number) => Math.round(n * 100) / 100;
const money = (amount: number, currency: string | null) =>
  `${currency === "SGD" ? "S$" : currency ? currency + " " : "$"}${amount.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** The household's cover types and their holders, and the covers printed for nobody in the family. */
export function coversOf(readings: CheckedReading[], family: FamilyMember[]) {
  const covers: PersonCover[] = [], unmatched: CheckedCover[] = [], illustration: CheckedCover[] = [];
  for (const r of readings) for (const c of r.covers) {
    if (r.kind === "illustration") { illustration.push(c); continue; }
    const match = findFamilyMatchWithKind(c.person, family);
    if (!match) { unmatched.push(c); continue; }
    const coverKey = coverKeyOf(c);
    // The same cover printed twice for one person (a pack that repeats its schedule) is one cover.
    if (covers.some((x) => x.personId === match.member.id && x.coverKey === coverKey && x.sumInsured === c.sumInsured)) continue;
    covers.push({ ...c, personId: match.member.id, coverKey, confirmation: null });
  }
  const types = new Map<string, CoverType>();
  for (const c of covers) {
    const t = types.get(c.coverKey) ?? { key: c.coverKey, product: c.product, cover: c.cover, plan: c.plan, riderOf: c.riderOf ?? null, holders: [] };
    const name = family.find((m) => m.id === c.personId)!.display_name;
    if (!t.holders.includes(name)) t.holders.push(name);
    types.set(c.coverKey, t);
  }
  return { covers, unmatched, illustration, types: [...types.values()] };
}

/** One entry per (document, heading, column) that prints a benefit row. */
export function sectionsOf(readings: CheckedReading[]): SectionRef[] {
  const map = new Map<string, SectionRef>();
  for (const r of readings) for (const b of r.benefits) {
    const key = sectionKeyOf(r.documentId, b);
    const s = map.get(key) ?? { key, document: r.document, kind: r.kind, product: r.product, section: b.section, column: b.column, examples: [] };
    if (s.examples.length < 3) s.examples.push(b.benefit);
    map.set(key, s);
  }
  return [...map.values()];
}

/** Words that mark a figure as a projection whatever the model said: "non-guaranteed", an illustration, "projected", an
 * assumed rate of return, "at 4.25% p.a.". Checked in the row's own quote, benefit name, section and column. */
const PROJECTION = /\bnon[\s-]?guaranteed\b|\billustrat(?:ed|ion|ive)\b|\bprojected\b|\b(?:investment\s+)?rate\s+of\s+return\b|\bassumed\s+(?:investment\s+)?(?:rate|return)|\bat\s+\d+(?:\.\d+)?\s*%\s*(?:p\.?\s?a\b|per\s+annum|a\s+year)/i;
export const readsAsProjection = (b: Pick<CheckedBenefit, "benefit" | "section" | "column"> & { source: { excerpt: string } }) =>
  PROJECTION.test([b.source.excerpt, b.benefit, b.section ?? "", b.column ?? ""].join("\n"));
function figureFor(b: CheckedBenefit, cover: PersonCover, fromIllustration: boolean): Figure {
  const f = baseFigure(b, cover);
  const basis = b.basis === "non_guaranteed" || b.basis === "illustrated" ? b.basis : fromIllustration ? "illustrated" : readsAsProjection(b) ? "non_guaranteed" : null;
  if (basis && f.kind !== "none") return { kind: "projected", amount: f.amount, currency: f.currency, basis, asOf: b.asOf };
  return f;
}
function baseFigure(b: CheckedBenefit, cover: PersonCover): Figure {
  if (b.pays === "amount" || b.pays === "up_to" || b.pays === "per_day" || b.pays === "per_period")
    return { kind: "printed", amount: b.value!, currency: b.currency, unit: b.pays === "amount" ? "lump_sum" : b.pays, period: b.period };
  if (b.pays === "value") return { kind: "value", amount: b.value!, currency: b.currency, asOf: b.asOf };
  if (b.pays !== "percent") return { kind: "none", why: b.pays === "not_covered" ? "printed as not covered" : b.pays === "as_charged" ? "paid as charged, no limit printed on this row" : "no figure printed" };
  // A row whose words say it is capped, with no cap read and checked (or a reading from before caps were read), is never
  // worked out: the uncapped figure could be more than it pays.
  if (b.cap == null && (b.capUnread || CAP_WORDS.test(b.source.excerpt)))
    return { kind: "none", why: `${b.value}% of ${b.percentOf === "sum_insured" ? "the sum insured" : "a printed amount"}, up to a limit printed with it on p${b.source.page}: see the document` };
  const capped = (amount: number, currency: string | null, how: string): Figure =>
    b.cap != null && amount > b.cap
      ? { kind: "worked_out", amount: b.cap, currency, how: `${how} is more than the most it pays, so up to ${money(b.cap, currency)} (printed with it on p${b.capSource?.page ?? b.source.page})`, capped: true }
      : { kind: "worked_out", amount, currency, how: b.cap != null ? `${how}, within its limit of ${money(b.cap, currency)}` : how };
  if (b.percentOf === "fixed_amount" && b.baseAmount != null)
    return capped(cents(b.value! * b.baseAmount / 100), b.currency, `${b.value}% of ${money(b.baseAmount, b.currency)}, printed on the same page`);
  if (b.percentOf === "sum_insured") {
    if (cover.sumInsured == null) return { kind: "none", why: `${b.value}% of the sum insured, but no sum insured is printed for ${cover.cover}` };
    return capped(cents(b.value! * cover.sumInsured / 100), cover.currency,
      `${b.value}% of ${money(cover.sumInsured, cover.currency)} (${cover.cover}, ${cover.confirmation?.status === "corrected" ? "the figure you gave" : `${cover.source.document} p${cover.source.page}${cover.asOf ? `, as of ${cover.asOf}` : ""}`})`);
  }
  return { kind: "none", why: `${b.value}% of a base the page does not state` };
}

/** Plan columns, one rule. A heading keeps every word except a closed list of currency and unit tokens (S$, SGD, $, "per
 * visit", "per policy year", adult, child) and the filler words "plan"/"option", wherever they stand, brackets or not.
 * What is left is a plan column only if it equals, contains, or is part of a name in that document's plan list: the
 * plans printed on the household's covers, the plan the document itself names, and, when the document prints two or
 * more different columns, those columns (they are its plans side by side). A plan column links only to a cover whose plan
 * is the same words; so does a heading that says "Plan" or "Option". Anything else is neutral, except that for a cover
 * that prints a plan every column other than its own plan is refused (a lone column cannot be told apart from a neutral
 * heading, and another plan's figure is the worst mistake this page can make). When in doubt the link is refused, so no figure is shown rather than
 * another plan's. */
const UNIT_TOKENS = new Set(["s", "sgd", "usd", "us", "rm", "hk", "hkd", "myr", "adult", "adults", "child", "children", "plan", "plans", "option", "options"]);
const PER = /\bper\s+(?:policy\s+|calendar\s+)?(?:visit|day|week|month|year|annum|trip|journey|incident|event|claim|accident|disability|person|insured|family)\b/gi;
export const headingWords = (s: string | null) => norm((s ?? "").replace(/\$/g, " ").replace(PER, " ")).split(" ").filter((t) => t && !UNIT_TOKENS.has(t)).join(" ");
const QUALIFIER = /\b(?:adults?|child(?:ren)?|per\s+(?:person|insured|family))\b/gi;
/** The qualifier words of a column heading, in its own spelling ("Child", "per family"), or null. */
export const qualifierOf = (column: string | null) => {
  const found = [...new Set((column ?? "").match(QUALIFIER)?.map((q) => q.toLowerCase().replace(/\s+/g, " ")) ?? [])];
  return found.length ? found.join(", ") : null;
};
const within = (a: string, b: string) => ` ${b} `.includes(` ${a} `);

/** Each document's plan list (see above), as heading words. */
function planLists(readings: CheckedReading[], types: CoverType[]): Map<string, Set<string>> {
  const household = types.map((t) => headingWords(t.plan)).filter(Boolean);
  return new Map(readings.map((r) => {
    const columns = [...new Set(r.benefits.map((b) => headingWords(b.column)).filter(Boolean))];
    return [r.documentId, new Set([...household, headingWords(r.plan), ...(columns.length >= 2 ? columns : [])].filter(Boolean))];
  }));
}
function columnProblem(column: string | null, cover: CoverType, plans: Set<string>): string | null {
  const words = headingWords(column);
  if (!words) return null;
  // For a cover that prints a plan, any other column is refused: a lone "Classic" column cannot be told apart from a
  // neutral heading, and showing another plan's figure is worse than showing none.
  if (cover.plan) return words === headingWords(cover.plan) ? null : `column "${column}" is not the plan "${cover.plan}" on the person's cover`;
  // A heading that says "Plan" or "Option" names a plan, whatever follows.
  const saysPlan = /\b(?:plans?|options?)\b/i.test(column ?? "");
  if (!saysPlan && ![...plans].some((p) => within(p, words) || within(words, p))) return null;
  return `column "${column}" names a plan, but the person's cover prints no plan`;
}

export function assembleTable(readings: CheckedReading[], family: FamilyMember[], links: SectionLink[], confirmations: Confirmation[] = []): BenefitTable {
  const { covers, unmatched, illustration, types } = coversOf(readings, family);
  // The household's word on a headline amount: a correction replaces the printed sum insured for every row worked out on
  // it; the printed figure stays on the cover, so the page can show both.
  const staleConfirmations: Confirmation[] = [];
  for (const k of confirmations) {
    // Every copy of the cover for that person (two documents can print it with different figures) takes the household's word.
    const held = covers.filter((x) => x.personId === k.personId && x.coverKey === k.coverKey);
    if (!held.length) { staleConfirmations.push(k); continue; }
    for (const c of held) {
      c.confirmation = { ...k, printed: c.sumInsured };
      if (k.status === "corrected") c.sumInsured = k.sumInsured;
    }
  }
  const sections = sectionsOf(readings);
  const plansOf = planLists(readings, types);
  const docOf = new Map(readings.flatMap((r) => r.benefits.map((b) => [sectionKeyOf(r.documentId, b), r.documentId] as const)));
  const refusedLinks: BenefitTable["refusedLinks"] = [];
  const linkOf = new Map<string, SectionLink>();
  for (const l of links) {
    const type = l.cover ? types.find((t) => t.key === l.cover) : null;
    const section = sections.find((s) => s.key === l.section);
    if (!section) { refusedLinks.push({ link: l, why: "no such section" }); continue; }
    if (linkOf.has(l.section)) { refusedLinks.push({ link: l, why: "section linked twice" }); continue; }
    if (l.cover && !type) { refusedLinks.push({ link: l, why: "no such cover" }); continue; }
    const problem = type ? columnProblem(section.column, type, plansOf.get(docOf.get(section.key) ?? "") ?? new Set()) : null;
    if (problem) { refusedLinks.push({ link: l, why: problem }); continue; }
    linkOf.set(l.section, l);
  }
  const people = family.map((m) => ({ id: m.id, name: m.display_name, covers: covers.filter((c) => c.personId === m.id), rows: [] as TableRow[] }));
  const unlinkedSections: BenefitTable["unlinkedSections"] = [];
  // Where each section starts, so a part that is not on anyone's table can still be opened at its page.
  const firstSource = new Map<string, Source>();
  for (const r of readings) for (const b of r.benefits) if (!firstSource.has(sectionKeyOf(r.documentId, b))) firstSource.set(sectionKeyOf(r.documentId, b), b.source);
  for (const s of sections) {
    const l = linkOf.get(s.key);
    const refused = refusedLinks.find((x) => x.link.section === s.key);
    if (!l?.cover) unlinkedSections.push({ section: s, why: l ? l.why : refused ? `not shown: ${refused.why}` : "not linked to any cover", source: firstSource.get(s.key) ?? null });
  }
  for (const r of readings) for (const b of r.benefits) {
    const l = linkOf.get(sectionKeyOf(r.documentId, b));
    if (!l?.cover) continue;
    for (const p of people) for (const c of p.covers.filter((x) => x.coverKey === l.cover)) {
      p.rows.push({ personId: p.id, person: p.name, coverKey: c.coverKey, product: c.product, cover: c.cover, plan: c.plan, benefit: b.benefit,
        section: b.section, column: b.column, pays: b.pays, figure: figureFor(b, c, r.kind === "illustration"), fromDay: b.fromDay, maxDays: b.maxDays,
        conditions: b.conditions, source: b.source, baseSource: b.percentOf === "sum_insured" ? c.source : b.baseSource, linkWhy: l.why, qualifier: qualifierOf(b.column),
        percent: b.pays === "percent" ? b.value : null, percentOf: b.pays === "percent" ? b.percentOf : null,
        base: b.pays !== "percent" ? null : b.percentOf === "sum_insured" ? c.sumInsured : b.percentOf === "fixed_amount" ? b.baseAmount : null,
        baseCorrected: b.pays === "percent" && b.percentOf === "sum_insured" && c.confirmation?.status === "corrected", capSource: b.capSource ?? null });
    }
  }
  return { people, unmatchedCovers: unmatched, illustrationCovers: illustration, unlinkedSections, staleConfirmations, refusedLinks };
}

export function figureText(f: Figure): string {
  if (f.kind === "none") return `no amount (${f.why})`;
  const m = money(f.amount, f.currency) + (f.currency ? "" : " (currency not stated)");
  if (f.kind === "value") return `${m} value${f.asOf ? ` as of ${f.asOf}` : " (date not stated)"}`;
  if (f.kind === "projected") return `${m} projected, ${f.basis === "non_guaranteed" ? "not guaranteed" : "an illustration"}${f.asOf ? ` (${f.asOf})` : ""}: not an amount held or payable`;
  if (f.kind === "worked_out") return `${m}, worked out: ${f.how}`;
  return f.unit === "up_to" ? `up to ${m}` : f.unit === "per_day" ? `${m} a day` : f.unit === "per_period" ? `${m} a ${(f.period ?? "period").replace("_", " ")}` : m;
}
