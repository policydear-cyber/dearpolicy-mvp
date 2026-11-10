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
import { familyNameCandidates, findFamilyMatchWithKind } from "@/lib/policies/linking";
import { nameKey } from "@/lib/policies/name-dismissals";
import { printedDay, singaporeDay } from "./dates";
import { SCHEME_NAME, travelName } from "@/lib/coverage/table-figures";
import { planTypeOf, type PlanType } from "@/lib/coverage/plan-type";
import { shareOf as readShare } from "@/lib/format/share-of";
import { CAP_WORDS, type CheckedBenefit, type CheckedCover, type CheckedReading, type Source } from "./check";
import type { CoverType, SectionLink, SectionRef } from "./reading";

export type FamilyMember = { id: string; display_name: string; preferred_name?: string | null;
  /** The documents this person is linked to by their own record (policy_members: chosen at upload, ticked in the "who does
   * this cover" picker, or matched when read), and the printed names on a document the household matched to them
   * (policy_detected_people). Used only to tell apart people whose names are the same. */
  documents?: string[]; printedAs?: { documentId: string; name: string }[];
  /** The household's own word on who a printed name is, which wins over any match by name (householdRecord):
   * `chosenAs`, the printed names on a document the household matched to this person by hand; `excludedFrom`, the
   * documents the household took this person off; `notThem`, printed names on a document the household said are no one
   * in the family ("Not in my family"), the same list on every person. */
  chosenAs?: { documentId: string; name: string }[]; excludedFrom?: string[]; notThem?: { documentId: string; name: string }[];
  /** Every printed name stored for a document (policy_detected_people), so a cover's printing of a name is judged
   * against the closest stored one, not only the ones the household answered. */
  namedOn?: { documentId: string; name: string }[] };
/** A cover printed for a name two or more family members share, which neither the document's own links nor a match the
 * household made tells apart: shown with everyone it may be, never dropped and never given to one of them by guess. */
/** `sameName`: every candidate has the printed name itself; false when each only fits part of it ("Wei Jie" and "Wei"). */
export type AmbiguousCover = { cover: CheckedCover; documentId: string; candidates: { id: string; name: string }[]; sameName: boolean };
export type Figure =
  | { kind: "printed"; amount: number; currency: string | null; unit: "lump_sum" | "up_to" | "per_day" | "per_period"; period?: string | null }
  | { kind: "value"; amount: number; currency: string | null; asOf: string | null }
  | { kind: "projected"; amount: number; currency: string | null; basis: "non_guaranteed" | "illustrated"; asOf: string | null }
  /** capped: the percentage came to more than the most the row pays, so the amount is that printed cap. */
  | { kind: "worked_out"; amount: number; currency: string | null; how: string; capped?: boolean }
  /** share: a percentage row whose amount is not worked out (its maximum was not captured, or the amount it is a share
   * of is not stated with it) still says the share it pays, in the row's own words ("10% of Prevailing Insured Amount").
   * Never an amount: capWords is the maximum exactly as printed, or null; capMissing says a maximum applies but its
   * figure was not captured. */
  | { kind: "none"; why: string; share?: { percent: number; of: string; capWords: string | null; capPage: number | null; capMissing: boolean } };
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
  /** The row is a limit on what several benefits or policies pay together, never a benefit of its own (check.ts). */
  combinedLimit?: boolean;
  /** The held policy the row was built for, when the person holds several of its cover type (PersonCover.holding). */
  holding?: string;
  /** The last day of the row's cover, as printed, when that cover was for one short term that is over (a single trip):
   * the row is no longer current cover, but it still answers for an event inside that term. */
  coverEnded?: string | null;
};
/** What the household said about one person's cover: that its sum insured is right, or the figure it should be. */
export type Confirmation = { personId: string; coverKey: string; status: "confirmed" | "corrected"; sumInsured: number | null; updatedAt?: string | null };
export type PersonCover = CheckedCover & { personId: string; coverKey: string;
  /** Set when the person holds two or more policies of this cover type with different printed policy numbers: this one's
   * own key, so a tile counts each policy (coversOf). Unset otherwise. */
  holding?: string;
  /** Set when another copy of this same cover (same person, cover type and sum) that was not kept prints a policy number
   * this copy does not: every number its copies print, so a reader that must not join two policies sees them all. */
  copyNumbers?: string[];
  /** Set when this cover was printed on more than one document: every copy's document and its reading's kind, the kept
   * one included, so a reader asking what documents hold it sees them all, in whatever order they were read. */
  copyDocuments?: { documentId: string; kind: CheckedReading["kind"] | null }[];
  /** Set when the household confirmed or corrected this cover; `printed` is the sum insured the document prints. */
  confirmation: (Confirmation & { printed: number | null }) | null;
  /** Set when the cover was for one short term that has ended (coverEnded below): its last day, as printed. */
  ended?: string | null;
  /** The period of cover its document prints for the whole document (CheckedReading.periodFrom, periodTo), when printed. */
  documentPeriodFrom?: string | null; documentPeriodTo?: string | null;
  /** What its document is (CheckedReading.kind): a premium is taken for Home only from a personal schedule or certificate. */
  documentKind?: CheckedReading["kind"];
  /** Savings or investment, when the cover's name or its document's own words say so (lib/coverage/plan-type.ts). */
  planType?: PlanType | null };
export type BenefitTable = {
  people: { id: string; name: string; covers: PersonCover[]; rows: TableRow[] }[];
  /** Covers printed for someone who is not a family member. */
  unmatchedCovers: CheckedCover[];
  /** Covers printed for a name several family members share, that nothing on record tells apart (AmbiguousCover). */
  ambiguousCovers: AmbiguousCover[];
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
/** A printed policy number compared by its letters and digits alone, without leading zeros. */
const policyNumberKey = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]+/g, "").replace(/^0+(?=.)/, "");
/** Two printed policy numbers that may be one policy's: the same letters and digits ("MT-104455", "mt104455",
 * "00104455" and "104455"), or one printed as the other with a short suffix after a separator ("104455-01"). A number that
 * only starts with the other ("MT1001", "MT10011") is another policy (TE P152 F3). Unrelated-looking numbers stay apart, and
 * the tiles never add them up. */
export const samePolicyNumber = (a: string, b: string) => {
  if (policyNumberKey(a) === policyNumberKey(b)) return true;
  const suffixed = (long: string, short: string) => { const m = long.trim().match(/^(.*?)[\s\-/.]+([A-Za-z0-9]{1,3})$/); return !!m && policyNumberKey(m[1]) === policyNumberKey(short); };
  return suffixed(a, b) || suffixed(b, a);
};
export const sectionKeyOf = (documentId: string, b: { section: string | null; column: string | null }) => [documentId, norm(b.section), norm(b.column)].join("|");
const cents = (n: number) => Math.round(n * 100) / 100;
const money = (amount: number, currency: string | null) =>
  `${currency === "SGD" ? "S$" : currency ? currency + " " : "$"}${amount.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** Whom a printed name is when several family members share it: the one the household matched this printed name to on
 * this document, else, between people with the very same name, the one of them this document is linked to by their own
 * record. Nobody on record, or several,
 * gives the candidates (never a guess). A name nobody in the family has gives null. */
function sharedNameMatch(name: string, documentId: string, family: FamilyMember[]): { member: FamilyMember } | { candidates: { id: string; name: string }[]; sameName: boolean } | null {
  const { members: candidates, exact } = familyNameCandidates(name, family);
  if (candidates.length < 2) return null;
  const key = nameKey(name);
  const printed = candidates.filter((m) => (m.printedAs ?? []).some((p) => p.documentId === documentId && nameKey(p.name) === key));
  if (printed.length === 1) return { member: printed[0] };
  // A document link decides only between true namesakes. People whose different names each fit part of the printed name
  // ("Wei Jie" and his son "Wei" for "Tan Wei Jie") are never told apart by it: the document may be linked to the son for
  // his own cover while this line is the father's (Critic H1 on #254).
  const linked = exact ? candidates.filter((m) => (m.documents ?? []).includes(documentId)) : [];
  if (linked.length === 1) return { member: linked[0] };
  return { candidates: candidates.map((m) => ({ id: m.id, name: m.display_name })), sameName: exact };
}

/** Who a printed name on a document is by the household's own word, before any match by name: the one person it matched
 * the name to by hand there; "nobody" when it said the name is no one in the family, or took the person the name would
 * match off that document; null when it said nothing, and the name decides as before. A name matched by hand to two
 * people (an older build) decides nothing. */
export function householdRecord(name: string, documentId: string, family: FamilyMember[]): { member: FamilyMember } | "nobody" | null {
  // Every printed name stored for this document, with the household's word on it (chosen for someone, not family, or
  // neither). The cover's own printing of a name can differ from the stored one: "Surname, Given", "Mrs Given Surname",
  // "陈伟明（受保人）". So it is compared as the matcher reads names, by words, and the closest stored name decides.
  type Said = { name: string; who: string | "nobody" | null };
  const said: Said[] = [];
  const seen = new Set<string>();
  const add = (n: string, who: Said["who"]) => { const k = `${nameKey(n)}|${who}`; if (!seen.has(k)) { seen.add(k); said.push({ name: n, who }); } };
  for (const m of family) {
    for (const p of m.chosenAs ?? []) if (p.documentId === documentId) add(p.name, m.id);
    for (const p of m.notThem ?? []) if (p.documentId === documentId) add(p.name, "nobody");
  }
  // The document's other printed names, which the household has said nothing about (a name it answered is listed once).
  const answered = new Set(said.map((x) => nameKey(x.name)));
  for (const m of family) for (const p of m.namedOn ?? []) if (p.documentId === documentId && !answered.has(nameKey(p.name))) add(p.name, null);
  const printed = nameWords(name);
  const closeness = (stored: string): number => {
    if (nameKey(stored) === nameKey(name)) return 3;
    const own = nameWords(stored);
    if (!own.length || !printed.length) return 0;
    if ([...own].sort().join(" ") === [...printed].sort().join(" ")) return 2;
    // Every word of the stored name is printed, and every other printed word is a title or a role word ("Sra.",
    // "(Life Assured)", "（受保人）"), never another name word: a fuller name with another name word is not the shorter stored one.
    const extra = printed.filter((w) => !own.includes(w));
    return own.every((w) => printed.includes(w)) && extra.every((w) => NOT_NAME_WORDS.has(w)) ? 1 : 0;
  };
  const scored = said.map((s) => ({ ...s, score: closeness(s.name) })).filter((s) => s.score > 0);
  const best = Math.max(0, ...scored.map((s) => s.score));
  const closest = scored.filter((s) => s.score === best);
  const answers = new Set(closest.map((s) => s.who));
  if (answers.size > 1) {
    // Stored names this close disagree on who it is: no one rather than possibly the wrong person.
    if ([...answers].some((a) => a !== null)) return "nobody";
  } else if (answers.size === 1) {
    const who = [...answers][0];
    if (who === "nobody") return "nobody";
    if (who) { const member = family.find((m) => m.id === who); if (member) return { member }; }
  }
  const named = findFamilyMatchWithKind(name, family);
  if (named && (named.member.excludedFrom ?? []).includes(documentId)) return "nobody";
  return null;
}

/** Words printed around a name that are never part of it: titles and honorifics, and the role a document gives the
 * person, in the languages DearPolicy reads (closed list; anything else beside a name counts as a name word). */
const NOT_NAME_WORDS = new Set([
  // Not here, because they are also names or initials: "Tan" (a surname, and "Tan Sri"), "Don", "M", "Haji".
  "mr", "mrs", "ms", "mdm", "madam", "miss", "mx", "dr", "prof", "sr", "sra", "srta", "doña", "mme", "mlle",
  "encik", "puan", "cik", "tuan",
  "先生", "女士", "小姐", "太太",
  "insured", "assured", "life", "policyholder", "policy", "holder", "owner", "member", "principal", "dependant", "dependent",
  "受保人", "被保险人", "被保人", "投保人", "保单持有人", "assuré", "assurée", "asegurado", "asegurada", "tertanggung", "pemegang", "polisi", "diinsuranskan",
]);

/** The words of a name in any script, ignoring case and punctuation (full-width brackets and commas included). */
function nameWords(name: string): string[] {
  return name.normalize("NFKC").toLocaleLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

/** The household's cover types and their holders, and the covers printed for nobody in the family. */
export function coversOf(readings: CheckedReading[], family: FamilyMember[], today: number = singaporeDay(new Date())) {
  const covers: PersonCover[] = [], unmatched: CheckedCover[] = [], illustration: CheckedCover[] = [], ambiguous: AmbiguousCover[] = [];
  const found: PersonCover[] = [];
  for (const r of readings) for (const c of r.covers) {
    if (r.kind === "illustration") { illustration.push(c); continue; }
    // The household's own word first (a name it moved to someone else, or said is not its family's): a cover is never
    // shown for a person the household said it is not (audit 3 Nov: a member kept a cousin's certificate matched by a shared given name).
    const record = householdRecord(c.person, r.documentId, family);
    if (record === "nobody") { unmatched.push(c); continue; }
    const named = record ?? findFamilyMatchWithKind(c.person, family);
    const shared = named ? null : sharedNameMatch(c.person, r.documentId, family);
    if (shared && "candidates" in shared) {
      // Someone the household took off this document is not offered as who it might be.
      const candidates = shared.candidates.filter((k) => !(family.find((f) => f.id === k.id)?.excludedFrom ?? []).includes(r.documentId));
      if (candidates.length) ambiguous.push({ cover: c, documentId: r.documentId, candidates, sameName: shared.sameName }); else unmatched.push(c);
      continue;
    }
    const match = named ?? shared;
    if (!match) { unmatched.push(c); continue; }
    found.push({ ...c, personId: match.member.id, coverKey: coverKeyOf(c), confirmation: null, ended: coverEnded(c, r, today), documentPeriodFrom: r.periodFrom ?? null, documentPeriodTo: r.periodTo ?? null, documentKind: r.kind, planType: planTypeOf(c, r.planType ?? null, { product: r.product, baseCovers: r.covers.filter((x) => !x.riderOf).length }) });
  }
  // One person's printed policy numbers for one cover type, grouped where they may be one policy's number written two ways
  // ("MT-104455", "MT104455", "00104455", "104455-01"; TE P152 F1).
  const numberOf = new Map<PersonCover, string>();
  for (const c of found) {
    if (!c.policyNumber || !policyNumberKey(c.policyNumber)) continue;
    const same = [...numberOf].find(([x, n]) => x.personId === c.personId && x.coverKey === c.coverKey && samePolicyNumber(x.policyNumber!, c.policyNumber!));
    numberOf.set(c, same ? same[1] : policyNumberKey(c.policyNumber));
  }
  // The same cover printed twice for one person (a pack that repeats its schedule, a summary and its certificate) is one
  // cover, the first read. Where its copies print two or more different policy numbers, the first of each number is kept
  // and a copy with no number is dropped, in whatever order they were read (TE P152 F2): two policies of one product
  // (TE P148-3, Critic Q4), or one policy re-numbered, which the tiles list but never add up (Critic R258).
  const groups = new Map<string, PersonCover[]>();
  for (const c of found) { const k = `${c.personId}\u0000${c.coverKey}\u0000${c.sumInsured}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  for (const c of found) {
    const group = groups.get(`${c.personId}\u0000${c.coverKey}\u0000${c.sumInsured}`)!;
    const numbers = new Set(group.map((x) => numberOf.get(x)).filter(Boolean));
    if (numbers.size <= 1 ? group[0] === c : numberOf.has(c) && group.find((x) => numberOf.get(x) === numberOf.get(c)) === c) {
      // A copy that was not kept may print a number the kept copy does not (a wording page with none, read before the
      // contract): the kept cover carries every printed number of its copies (Critic R303 H1).
      const printed = [...new Set(group.map((x) => x.policyNumber).filter((n): n is string => !!n && !!policyNumberKey(n)))];
      if (printed.some((n) => !c.policyNumber || policyNumberKey(n) !== policyNumberKey(c.policyNumber))) c.copyNumbers = printed;
      if (group.length > 1) c.copyDocuments = group.map((x) => ({ documentId: x.source.documentId, kind: x.documentKind ?? null }));
      covers.push(c);
    }
  }
  // One person's covers of one cover type that print different policy numbers are separate holdings: each is its own part
  // on a Home tile. The cover type (and its stored links and confirmations) stays shared, so a scheme's wording still links
  // once for everyone who holds it. A cover with no printed number, or the only number, has no holding.
  for (const c of covers) {
    const numbers = new Set(covers.filter((x) => x.personId === c.personId && x.coverKey === c.coverKey && numberOf.has(x)).map((x) => numberOf.get(x)));
    if (numbers.size > 1 && numberOf.has(c)) c.holding = `${c.coverKey}#${numberOf.get(c)}`;
  }
  const types = new Map<string, CoverType>();
  for (const c of covers) {
    const t = types.get(c.coverKey) ?? { key: c.coverKey, product: c.product, cover: c.cover, plan: c.plan, riderOf: c.riderOf ?? null, holders: [] };
    const name = family.find((m) => m.id === c.personId)!.display_name;
    if (!t.holders.includes(name)) t.holders.push(name);
    types.set(c.coverKey, t);
  }
  return { covers, unmatched, illustration, ambiguous, types: [...types.values()] };
}

/** A travel cover's term is short when its printed period runs at most this many days: a trip, never an annual plan. */
export const SHORT_TERM_DAYS = 183;
/** Every policy on file is treated as in force (DC, 31 Oct: "ignore all expiry dates ... assume all policies are still in
 * force"). A printed end date, period or expiry is a fact of the document, never a status: no cover is ever ended by one,
 * so this is always null. Kept so every reader of `ended` / `coverEnded` sees one answer. */
export function coverEnded(_c: Pick<CheckedCover, "startDate" | "endDate" | "cover" | "plan" | "product"> & { riderOf?: string | null }, _r: Pick<CheckedReading, "periodFrom" | "periodTo">, _today: number): string | null {
  return null;
}

/** Whether a row under a heading that names the limits of compensation is one of those limits: a printed lump sum or
 * "up to" figure above its cover's stated sum insured (or in another currency), or any such figure when no sum insured
 * is held ("Critical Illness up to S$2,000,000", TE P150-2). Such a figure is never what a claim or a tile pays. A figure
 * within the sum insured ("Death Benefit S$100,000"), one worked out from it ("25% of the sum assured"), a daily or
 * periodic payment ("S$100 a day") or a row with no figure stays cover (TE P150-3). */
/** A lump sum or "up to" figure under that heading below the cover's sum insured stays cover, but its own line is kept
 * as a condition, so no tile shows it as the person's sum. */
function belowSumInsured(f: Figure, c: PersonCover): boolean {
  return f.kind === "printed" && (f.unit === "lump_sum" || f.unit === "up_to") && c.sumInsured != null && f.amount < c.sumInsured;
}
function limitUnderHeading(f: Figure, c: PersonCover): boolean {
  if (f.kind !== "printed" || (f.unit !== "lump_sum" && f.unit !== "up_to")) return false;
  if (c.sumInsured == null) return true;
  return f.amount > c.sumInsured || (!!f.currency && !!c.currency && f.currency !== c.currency);
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
  if (b.cap == null && (b.capUnread || CAP_WORDS.test(b.source.excerpt))) {
    const of = shareWords(b);
    return { kind: "none", why: `${b.value}% of ${of ?? "a printed amount"}, up to a maximum printed with it on p${b.source.page} that was not captured: see the document`,
      ...(of ? { share: { percent: b.value!, of, capWords: null, capPage: null, capMissing: true } } : {}) };
  }
  const capped = (amount: number, currency: string | null, how: string): Figure =>
    b.cap != null && amount > b.cap
      ? { kind: "worked_out", amount: b.cap, currency, how: `${how} is more than the most it pays, so up to ${money(b.cap, currency)} (printed with it on p${b.capSource?.page ?? b.source.page})`, capped: true }
      : { kind: "worked_out", amount, currency, how: b.cap != null ? `${how}, within its limit of ${money(b.cap, currency)}` : how };
  if (b.percentOf === "fixed_amount" && b.baseAmount != null)
    return capped(cents(b.value! * b.baseAmount / 100), b.currency, `${b.value}% of ${money(b.baseAmount, b.currency)}, printed on the same page`);
  if (b.percentOf === "sum_insured") {
    if (cover.sumInsured == null) return withShare(b, { kind: "none", why: `${b.value}% of the sum insured, but no sum insured is printed for ${cover.cover}` });
    return capped(cents(b.value! * cover.sumInsured / 100), cover.currency,
      `${b.value}% of ${money(cover.sumInsured, cover.currency)} (${cover.cover}, ${cover.confirmation?.status === "corrected" ? "the figure you gave" : `${cover.source.document} p${cover.source.page}${cover.asOf ? `, as of ${cover.asOf}` : ""}`})`);
  }
  return withShare(b, { kind: "none", why: `${b.value}% of a base the page does not state` });
}

/** The words a percentage row says it is a share of, as printed (lib/format/share-of): "10% of Prevailing Insured
 * Amount, up to maximum of S$25,000" gives "Prevailing Insured Amount". When the row prints none, "the sum insured" if the
 * reading says that is the base, otherwise null (and the row keeps "See the page"). */
function shareWords(b: Pick<CheckedBenefit, "value" | "percentOf" | "benefit" | "section"> & { source: { excerpt: string } }): string | null {
  // Only the row's own name and heading may come before its share; anything else printed first may be a condition.
  const printed = readShare(b.source.excerpt, { name: [b.benefit, b.section].filter(Boolean).join(" ") });
  if (printed && printed.percent === b.value) return printed.of;
  return b.percentOf === "sum_insured" ? "the sum insured" : null;
}
/** A row with no amount keeps its share when the row prints what it is a share of, with any maximum exactly as printed. */
function withShare(b: CheckedBenefit, f: Extract<Figure, { kind: "none" }>): Figure {
  const of = shareWords(b);
  if (!of || b.value == null) return f;
  // The maximum only in the words that print it (checked against the row); never re-worded with a guessed currency.
  const capWords = b.cap == null ? null : b.capQuote?.trim() || null;
  return { ...f, share: { percent: b.value, of, capWords, capPage: capWords ? b.capSource?.page ?? b.source.page : null, capMissing: false } };
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
    // A column headed with the full name of someone the document prints a cover for is that person's, never a plan
    // (a joint schedule's "Jane Doe" and "John Roe" columns; whoseRows tells them apart).
    const names = [...new Set([...r.covers.map((c) => c.person), ...r.namedPeople])].map((n) => headingWords(n)).filter((n) => n.includes(" "));
    const columns = [...new Set(r.benefits.map((b) => headingWords(b.column)).filter((c) => c && !names.some((n) => within(n, c))))];
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

/** The covers a linked section's rows are built for. Where the person holds several policies of the cover type
 * (holdings), a section printed on one policy's own document belongs to that policy only, never to the other; a section
 * on a document that holds none of them (a wording, a product summary) belongs to each. */
function ownCovers(list: PersonCover[], documentId: string): PersonCover[] {
  if (!list.some((c) => c.holding)) return list;
  const own = list.filter((c) => c.source.documentId === documentId);
  return own.length ? own : list;
}

/** Why a section's rows are shown for no one when its document prints the cover for two or more people and the rows do
 * not say whose they are (whoseRows). */
export const NOT_TOLD_WHY = "printed for more than one person on this document, and these rows do not say whose they are: not shown for anyone";
const wholeName = (name: string) => { const n = norm(name); return n.includes(" ") ? n : null; };
/** Whose a linked section's row is, by what its own document prints (joint schedule fix, 10 Nov: a section linked by cover
 * type was shown for every holder of that type, so one life's amounts showed for the other life on a joint schedule).
 * `undefined`: every holder of the cover type, as before (a wording or product summary, a document that prints no one's
 * cover of that type). Otherwise the people the row may be shown for: when the document prints the cover for exactly one
 * holder, only that holder (never another holder whose own cover is printed elsewhere); when it prints it for two or more,
 * only the one whose full printed name the row's column or section heading names (never its own line, which may name a payee);
 * when no one life is named, those whose own sum printed on that document is the row's figure; otherwise no one (an empty set). Never by page or position. A row that prints
 * no figure of its own, or one worked out on each person's own sum insured, is every holder's. */
function whoseRows(documentId: string, b: CheckedBenefit, coverKey: string, covers: PersonCover[], family: FamilyMember[]): Set<string> | undefined {
  // A row whose figure is worked out on each person's own sum insured, or that prints none, is right for every holder (a
  // scheme summary's "Death Benefit" for each member): only a row that prints its own figure can be one life's.
  if (b.value == null || (b.pays === "percent" && b.percentOf === "sum_insured")) return undefined;
  const onDoc = (c: PersonCover) => c.source.documentId === documentId || (c.copyDocuments ?? []).some((d) => d.documentId === documentId);
  let printed = covers.filter((c) => c.coverKey === coverKey && onDoc(c));
  // The cover type is not printed on this document, but its holders' other covers are (a personal schedule whose rider is
  // printed only as a benefit section): those holders only.
  if (!printed.length) {
    const holders = new Set(covers.filter((c) => c.coverKey === coverKey).map((c) => c.personId));
    printed = covers.filter((c) => holders.has(c.personId) && onDoc(c));
  }
  const ids = new Set(printed.map((c) => c.personId));
  if (!ids.size) return undefined;
  if (ids.size === 1) return ids;
  const text = ` ${norm([b.column, b.section].filter(Boolean).join(" "))} `;
  const named = [...ids].filter((id) => {
    const names = [...printed.filter((c) => c.personId === id).map((c) => c.person), family.find((m) => m.id === id)?.display_name ?? ""];
    return names.some((n) => { const w = wholeName(n); return !!w && text.includes(` ${w} `); });
  });
  if (named.length === 1) return new Set(named);
  // No one life named: the people whose own sum printed on this document is the row's figure (DC, 10 Nov). Never anyone
  // else: no one is shown an amount that is not theirs.
  const own = (c: PersonCover) => c.confirmation ? c.confirmation.printed : c.sumInsured;
  return new Set([...ids].filter((id) => printed.some((c) => c.personId === id && own(c) != null && own(c) === b.value
    && (!c.currency || !b.currency || c.currency === b.currency))));
}

/** `now` decides which short-term covers have ended (coverEnded), in Singapore time like the chat's date checks. */
/** Why a row is under the cover whose own printed line it is (ownLineCovers). */
export const OWN_LINE_WHY = "printed on this cover's own line";
/** A benefit row whose printed line is the very line a cover of the same document was read from (the same page and the
 * same words, spacing aside) belongs to that cover, whatever section the reading put it in: a rider's line in a schedule's
 * "Component" or "Policy Schedule" block is the rider's own line, not a benefit of the section's base cover (live test
 * 10 Nov: rider amounts shown under the base cover, or under no cover at all). Only when exactly one cover type of that
 * document prints that line, and only for cover types someone in the family holds. The row is then shown only for the
 * people whose own cover was read from that very line (Critic #405 F1: on a joint schedule, Jane's S$50,000 rider line is
 * never shown for John, whose own line prints S$30,000). A cover's quote counts as its own line only when it is one printed
 * line that holds no other cover's quote (Critic #405 F2: a basic plan quoted as a block that includes its rider's line
 * never takes the rider's row). Fixed for any document: it compares the reading's own quotes, never a product or benefit
 * name. */
export function ownLineCovers(readings: CheckedReading[], held: ReadonlySet<string>): Map<CheckedBenefit, { cover: string; line: string }> {
  const out = new Map<CheckedBenefit, { cover: string; line: string }>();
  for (const r of readings) {
    if (r.kind === "illustration") continue;
    const own = r.covers.filter((c) => c.source.documentId === r.documentId && !!c.source.excerpt.trim());
    const flat = (s: Source) => s.excerpt.toLowerCase().replace(/\s+/g, " ").trim();
    const byLine = new Map<string, Set<string>>();
    for (const c of own) {
      if (c.source.excerpt.trim().includes("\n")) continue;
      if (own.some((o) => o !== c && o.source.page === c.source.page && flat(o.source) !== flat(c.source) && flat(c.source).includes(flat(o.source)))) continue;
      const k = ownLineKey(c.source);
      byLine.set(k, new Set([...(byLine.get(k) ?? []), coverKeyOf(c)]));
    }
    for (const b of r.benefits) {
      if (b.source.documentId !== r.documentId || !b.source.excerpt.trim()) continue;
      const line = ownLineKey(b.source), keys = byLine.get(line);
      if (keys?.size === 1) { const key = [...keys][0]; if (held.has(key)) out.set(b, { cover: key, line }); }
    }
  }
  return out;
}
/** A printed line's place: its page and words, spacing aside. */
export const ownLineKey = (s: Source) => `${s.page}\u0000${s.excerpt.toLowerCase().replace(/\s+/g, " ").trim()}`;
export function assembleTable(readings: CheckedReading[], family: FamilyMember[], links: SectionLink[], confirmations: Confirmation[] = [], now: Date = new Date()): BenefitTable {
  const { covers, unmatched, illustration, ambiguous, types } = coversOf(readings, family, singaporeDay(now));
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
  const ownLine = ownLineCovers(readings, new Set(types.map((t) => t.key)));
  // Placed by its line only when someone's cover shown here was read from that line (a person's cover kept from another
  // copy of the document is not): otherwise the row keeps the section's link, so it is never placed for no one.
  const readFrom = new Set(covers.map((c) => `${c.coverKey}\u0001${c.source.documentId}\u0001${ownLineKey(c.source)}`));
  for (const [b, o] of ownLine) if (!readFrom.has(`${o.cover}\u0001${b.source.documentId}\u0001${o.line}`)) ownLine.delete(b);
  // A link the household chose is theirs: the own line never overrides it.
  const householdChose = (l: SectionLink | undefined) => (l as { chosenBy?: string } | undefined)?.chosenBy === "household";
  const placedOf = (sectionKey: string, b: CheckedBenefit): { cover: string; why: string; line?: string } | null => {
    const l = linkOf.get(sectionKey);
    const own = householdChose(l) ? undefined : ownLine.get(b);
    if (own) return { cover: own.cover, why: OWN_LINE_WHY, line: own.line };
    return l?.cover ? { cover: l.cover, why: l.why } : null;
  };
  // A section is said to be unlinked only for the rows its own line did not place.
  const unplaced = new Set(readings.flatMap((r) => r.benefits.filter((b) => !placedOf(sectionKeyOf(r.documentId, b), b)).map((b) => sectionKeyOf(r.documentId, b))));
  const unlinkedSections: BenefitTable["unlinkedSections"] = [];
  // Where each section starts, so a part that is not on anyone's table can still be opened at its page.
  const firstSource = new Map<string, Source>();
  for (const r of readings) for (const b of r.benefits) if (!firstSource.has(sectionKeyOf(r.documentId, b))) firstSource.set(sectionKeyOf(r.documentId, b), b.source);
  for (const s of sections) {
    const l = linkOf.get(s.key);
    const refused = refusedLinks.find((x) => x.link.section === s.key);
    if (!l?.cover && unplaced.has(s.key)) unlinkedSections.push({ section: s, why: l ? l.why : refused ? `not shown: ${refused.why}` : "not linked to any cover", source: firstSource.get(s.key) ?? null });
  }
  const notTold = new Set<string>();
  for (const r of readings) for (const b of r.benefits) {
    const l = placedOf(sectionKeyOf(r.documentId, b), b);
    if (!l) continue;
    // A row placed by its section's link is shown only for the people its own document says it is for (whoseRows).
    const who = l.line ? undefined : whoseRows(r.documentId, b, l.cover, covers, family);
    if (who && !who.size) { notTold.add(sectionKeyOf(r.documentId, b)); continue; }
    // A row placed by its own line is shown only for the people whose cover was read from that line.
    for (const p of people.filter((x) => !who || who.has(x.id))) for (const c of ownCovers(p.covers.filter((x) => x.coverKey === l.cover && (!l.line || (x.source.documentId === r.documentId && ownLineKey(x.source) === l.line))), r.documentId)) {
      const figure = figureFor(b, c, r.kind === "illustration");
      p.rows.push({ personId: p.id, person: p.name, coverKey: c.coverKey, product: c.product, cover: c.cover, plan: c.plan, benefit: b.benefit,
        section: b.section, column: b.column, pays: b.pays, figure, fromDay: b.fromDay, maxDays: b.maxDays,
        conditions: b.limitsHeading && belowSumInsured(figure, c) && !b.conditions.includes(b.source.excerpt) ? [...b.conditions, b.source.excerpt] : b.conditions, source: b.source, baseSource: b.percentOf === "sum_insured" ? c.source : b.baseSource, linkWhy: l.why, qualifier: qualifierOf(b.column),
        percent: b.pays === "percent" ? b.value : null, percentOf: b.pays === "percent" ? b.percentOf : null,
        base: b.pays !== "percent" ? null : b.percentOf === "sum_insured" ? c.sumInsured : b.percentOf === "fixed_amount" ? b.baseAmount : null,
        baseCorrected: b.pays === "percent" && b.percentOf === "sum_insured" && c.confirmation?.status === "corrected", capSource: b.capSource ?? null,
        combinedLimit: (b.combinedLimit ?? false) || (!!b.limitsHeading && limitUnderHeading(figure, c)), ...(c.holding ? { holding: c.holding } : {}), coverEnded: c.ended ?? null });
    }
  }
  for (const s of sections) if (notTold.has(s.key) && !unlinkedSections.some((u) => u.section.key === s.key)) unlinkedSections.push({ section: s, why: NOT_TOLD_WHY, source: firstSource.get(s.key) ?? null });
  return { people, unmatchedCovers: unmatched, ambiguousCovers: ambiguous, illustrationCovers: illustration, unlinkedSections, staleConfirmations, refusedLinks };
}

// In headline.ts, which runs in the browser and must not import this file's database code (main 999048d: no build).
import { periodWords } from "./headline";
export { periodWords };

export function figureText(f: Figure): string {
  if (f.kind === "none") return f.share
    ? `${f.share.percent}% of ${f.share.of}, no amount worked out (${f.share.capMissing ? "a maximum applies, but it was not captured from the page" : f.share.capWords ? `${f.share.capWords}, printed with it on p${f.share.capPage}` : f.why})`
    : `no amount (${f.why})`;
  const m = money(f.amount, f.currency) + (f.currency ? "" : " (currency not stated)");
  if (f.kind === "value") return `${m} value${f.asOf ? ` as of ${f.asOf}` : " (date not stated)"}`;
  if (f.kind === "projected") return `${m} projected, ${f.basis === "non_guaranteed" ? "not guaranteed" : "an illustration"}${f.asOf ? ` (${f.asOf})` : ""}: not an amount held or payable`;
  if (f.kind === "worked_out") return `${m}, worked out: ${f.how}`;
  return f.unit === "up_to" ? `up to ${m}` : f.unit === "per_day" ? `${m} a day` : f.unit === "per_period" ? `${m} ${periodWords(f.period)}` : m;
}
