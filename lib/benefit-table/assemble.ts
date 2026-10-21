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
 * Rows from different documents are never added together; each row stands alone. */
import { findFamilyMatchWithKind } from "@/lib/policies/linking";
import type { CheckedBenefit, CheckedCover, CheckedReading, Source } from "./check";
import type { CoverType, SectionLink, SectionRef } from "./reading";

export type FamilyMember = { id: string; display_name: string; preferred_name?: string | null };
export type Figure =
  | { kind: "printed"; amount: number; currency: string | null; unit: "lump_sum" | "up_to" | "per_day" }
  | { kind: "worked_out"; amount: number; currency: string | null; how: string }
  | { kind: "none"; why: string };
export type TableRow = {
  personId: string; person: string; coverKey: string; product: string; cover: string; plan: string | null;
  benefit: string; section: string | null; column: string | null; pays: CheckedBenefit["pays"]; figure: Figure;
  fromDay: number | null; maxDays: number | null; conditions: string[]; source: Source; baseSource: Source | null; linkWhy: string;
};
export type PersonCover = CheckedCover & { personId: string; coverKey: string };
export type BenefitTable = {
  people: { id: string; name: string; covers: PersonCover[]; rows: TableRow[] }[];
  /** Covers printed for someone who is not (or not unambiguously) a family member. */
  unmatchedCovers: CheckedCover[];
  /** Sections no cover was linked to, with why: shown to the household, never silently dropped. */
  unlinkedSections: { section: SectionRef; why: string }[];
  /** Links refused by the server's own checks. */
  refusedLinks: { link: SectionLink; why: string }[];
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const coverKeyOf = (c: { product: string; cover: string; plan: string | null }) => [norm(c.product), norm(c.cover), norm(c.plan)].join("|");
export const sectionKeyOf = (documentId: string, b: { section: string | null; column: string | null }) => [documentId, norm(b.section), norm(b.column)].join("|");
const cents = (n: number) => Math.round(n * 100) / 100;
const money = (amount: number, currency: string | null) =>
  `${currency === "SGD" ? "S$" : currency ? currency + " " : "$"}${amount.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** The household's cover types and their holders, and the covers printed for nobody in the family. */
export function coversOf(readings: CheckedReading[], family: FamilyMember[]) {
  const covers: PersonCover[] = [], unmatched: CheckedCover[] = [];
  for (const r of readings) for (const c of r.covers) {
    const match = findFamilyMatchWithKind(c.person, family);
    if (!match) { unmatched.push(c); continue; }
    const coverKey = coverKeyOf(c);
    // The same cover printed twice for one person (a pack that repeats its schedule) is one cover.
    if (covers.some((x) => x.personId === match.member.id && x.coverKey === coverKey && x.sumInsured === c.sumInsured)) continue;
    covers.push({ ...c, personId: match.member.id, coverKey });
  }
  const types = new Map<string, CoverType>();
  for (const c of covers) {
    const t = types.get(c.coverKey) ?? { key: c.coverKey, product: c.product, cover: c.cover, plan: c.plan, holders: [] };
    const name = family.find((m) => m.id === c.personId)!.display_name;
    if (!t.holders.includes(name)) t.holders.push(name);
    types.set(c.coverKey, t);
  }
  return { covers, unmatched, types: [...types.values()] };
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

function figureFor(b: CheckedBenefit, cover: PersonCover): Figure {
  if (b.pays === "amount" || b.pays === "up_to" || b.pays === "per_day")
    return { kind: "printed", amount: b.value!, currency: b.currency, unit: b.pays === "amount" ? "lump_sum" : b.pays };
  if (b.pays !== "percent") return { kind: "none", why: b.pays === "not_covered" ? "printed as not covered" : b.pays === "as_charged" ? "paid as charged, no limit printed on this row" : "no figure printed" };
  if (b.percentOf === "fixed_amount" && b.baseAmount != null)
    return { kind: "worked_out", amount: cents(b.value! * b.baseAmount / 100), currency: b.currency, how: `${b.value}% of ${money(b.baseAmount, b.currency)}, printed on the same page` };
  if (b.percentOf === "sum_insured") {
    if (cover.sumInsured == null) return { kind: "none", why: `${b.value}% of the sum insured, but no sum insured is printed for ${cover.cover}` };
    return { kind: "worked_out", amount: cents(b.value! * cover.sumInsured / 100), currency: cover.currency,
      how: `${b.value}% of ${money(cover.sumInsured, cover.currency)} (${cover.cover}, ${cover.source.document} p${cover.source.page}${cover.asOf ? `, as of ${cover.asOf}` : ""})` };
  }
  return { kind: "none", why: `${b.value}% of a base the page does not state` };
}

/** A column belongs to a cover only when it is that cover's plan; with no plan on the cover, a plan-named column is refused. */
function columnProblem(column: string | null, cover: CoverType): string | null {
  if (!column) return null;
  const col = norm(column), plan = norm(cover.plan);
  if (plan && (col.includes(plan) || plan.includes(col))) return null;
  if (!plan) return null;
  return `column "${column}" is not the plan "${cover.plan}" on the person's cover`;
}

export function assembleTable(readings: CheckedReading[], family: FamilyMember[], links: SectionLink[]): BenefitTable {
  const { covers, unmatched, types } = coversOf(readings, family);
  const sections = sectionsOf(readings);
  const refusedLinks: BenefitTable["refusedLinks"] = [];
  const linkOf = new Map<string, SectionLink>();
  for (const l of links) {
    const type = l.cover ? types.find((t) => t.key === l.cover) : null;
    const section = sections.find((s) => s.key === l.section);
    if (!section) { refusedLinks.push({ link: l, why: "no such section" }); continue; }
    if (linkOf.has(l.section)) { refusedLinks.push({ link: l, why: "section linked twice" }); continue; }
    if (l.cover && !type) { refusedLinks.push({ link: l, why: "no such cover" }); continue; }
    const problem = type ? columnProblem(section.column, type) : null;
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
        section: b.section, column: b.column, pays: b.pays, figure: figureFor(b, c), fromDay: b.fromDay, maxDays: b.maxDays,
        conditions: b.conditions, source: b.source, baseSource: b.percentOf === "sum_insured" ? c.source : b.baseSource, linkWhy: l.why });
    }
  }
  return { people, unmatchedCovers: unmatched, unlinkedSections, refusedLinks };
}

export function figureText(f: Figure): string {
  if (f.kind === "none") return `no amount (${f.why})`;
  const m = money(f.amount, f.currency) + (f.currency ? "" : " (currency not stated)");
  return f.kind === "printed" ? (f.unit === "up_to" ? `up to ${m}` : f.unit === "per_day" ? `${m} a day` : m) : `${m}, worked out: ${f.how}`;
}
