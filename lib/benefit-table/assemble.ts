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
import type { CheckedBenefit, CheckedCover, CheckedReading, Source } from "./check";
import type { CoverType, SectionLink, SectionRef } from "./reading";

export type FamilyMember = { id: string; display_name: string; preferred_name?: string | null };
export type Figure =
  | { kind: "printed"; amount: number; currency: string | null; unit: "lump_sum" | "up_to" | "per_day" | "per_period"; period?: string | null }
  | { kind: "value"; amount: number; currency: string | null; asOf: string | null }
  | { kind: "projected"; amount: number; currency: string | null; basis: "non_guaranteed" | "illustrated"; asOf: string | null }
  | { kind: "worked_out"; amount: number; currency: string | null; how: string }
  | { kind: "none"; why: string };
export type TableRow = {
  personId: string; person: string; coverKey: string; product: string; cover: string; plan: string | null;
  benefit: string; section: string | null; column: string | null; pays: CheckedBenefit["pays"]; figure: Figure;
  fromDay: number | null; maxDays: number | null; conditions: string[]; source: Source; baseSource: Source | null; linkWhy: string;
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
  unlinkedSections: { section: SectionRef; why: string }[];
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
  if (b.percentOf === "fixed_amount" && b.baseAmount != null)
    return { kind: "worked_out", amount: cents(b.value! * b.baseAmount / 100), currency: b.currency, how: `${b.value}% of ${money(b.baseAmount, b.currency)}, printed on the same page` };
  if (b.percentOf === "sum_insured") {
    if (cover.sumInsured == null) return { kind: "none", why: `${b.value}% of the sum insured, but no sum insured is printed for ${cover.cover}` };
    return { kind: "worked_out", amount: cents(b.value! * cover.sumInsured / 100), currency: cover.currency,
      how: `${b.value}% of ${money(cover.sumInsured, cover.currency)} (${cover.cover}, ${cover.confirmation?.status === "corrected" ? "the figure you gave" : `${cover.source.document} p${cover.source.page}${cover.asOf ? `, as of ${cover.asOf}` : ""}`})` };
  }
  return { kind: "none", why: `${b.value}% of a base the page does not state` };
}

/** Words that name a plan column without being part of the plan's name ("Plan A", "Option 2"). */
const PLAN_WORDS = new Set(["plan", "plans", "option", "options", "tier", "class", "category", "type"]);
/** Names a column can carry that are plan or tier names wherever they appear. */
const TIER_NAMES = new Set(["basic", "standard", "classic", "enhanced", "premier", "premium", "elite", "deluxe", "superior", "executive", "business",
  "bronze", "silver", "gold", "platinum", "diamond", "lite", "plus", "max", "essential", "comprehensive", "core", "prestige", "signature"]);
const planTokens = (s: string | null) => norm(s).split(" ").filter((t) => t && !PLAN_WORDS.has(t));
const samePlan = (a: string | null, b: string | null) => { const x = planTokens(a), y = planTokens(b); return x.length > 0 && x.join(" ") === y.join(" "); };
/** A column that names a plan: a plan some cover in the household holds, a column called "Plan …"/"Option …", a single
 * letter or roman numeral, or a tier name. Any other column ("Adult", "Child", "Per Visit") says nothing about the plan. */
function namesPlan(column: string, plans: (string | null)[]): boolean {
  const words = norm(column).split(" ").filter(Boolean);
  if (plans.some((p) => samePlan(column, p))) return true;
  if (words.some((w) => PLAN_WORDS.has(w))) return true;
  const rest = planTokens(column);
  return rest.length === 1 && (/^[a-z]$/.test(rest[0]) || /^(i|ii|iii|iv|v|vi)$/.test(rest[0]) || TIER_NAMES.has(rest[0])) || rest.length > 0 && rest.every((w) => TIER_NAMES.has(w));
}
/** A plan column belongs to a cover only when it is that cover's plan, word for word ("Plan A" is not "Plan B"); a plan
 * column is refused for a cover with no plan; a column that names no plan is neutral. */
function columnProblem(column: string | null, cover: CoverType, plans: (string | null)[]): string | null {
  if (!column || !namesPlan(column, plans)) return null;
  if (cover.plan && samePlan(column, cover.plan)) return null;
  return cover.plan ? `column "${column}" is not the plan "${cover.plan}" on the person's cover` : `column "${column}" names a plan, but the person's cover prints no plan`;
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
  const refusedLinks: BenefitTable["refusedLinks"] = [];
  const linkOf = new Map<string, SectionLink>();
  for (const l of links) {
    const type = l.cover ? types.find((t) => t.key === l.cover) : null;
    const section = sections.find((s) => s.key === l.section);
    if (!section) { refusedLinks.push({ link: l, why: "no such section" }); continue; }
    if (linkOf.has(l.section)) { refusedLinks.push({ link: l, why: "section linked twice" }); continue; }
    if (l.cover && !type) { refusedLinks.push({ link: l, why: "no such cover" }); continue; }
    const problem = type ? columnProblem(section.column, type, types.map((t) => t.plan)) : null;
    if (problem) { refusedLinks.push({ link: l, why: problem }); continue; }
    linkOf.set(l.section, l);
  }
  const people = family.map((m) => ({ id: m.id, name: m.display_name, covers: covers.filter((c) => c.personId === m.id), rows: [] as TableRow[] }));
  const unlinkedSections: BenefitTable["unlinkedSections"] = [];
  for (const s of sections) {
    const l = linkOf.get(s.key);
    if (!l?.cover) unlinkedSections.push({ section: s, why: l ? l.why : "not linked to any cover" });
  }
  for (const r of readings) for (const b of r.benefits) {
    const l = linkOf.get(sectionKeyOf(r.documentId, b));
    if (!l?.cover) continue;
    for (const p of people) for (const c of p.covers.filter((x) => x.coverKey === l.cover)) {
      p.rows.push({ personId: p.id, person: p.name, coverKey: c.coverKey, product: c.product, cover: c.cover, plan: c.plan, benefit: b.benefit,
        section: b.section, column: b.column, pays: b.pays, figure: figureFor(b, c, r.kind === "illustration"), fromDay: b.fromDay, maxDays: b.maxDays,
        conditions: b.conditions, source: b.source, baseSource: b.percentOf === "sum_insured" ? c.source : b.baseSource, linkWhy: l.why });
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
