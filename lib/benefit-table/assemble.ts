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
import { PREMIUM, SCHEME_NAME, travelName } from "@/lib/coverage/table-figures";
import { planTypeOf, type PlanType } from "@/lib/coverage/plan-type";
import { shareOf as readShare } from "@/lib/format/share-of";
import { anyMoneyFigures } from "@/lib/format/currency";
import { CAP_WORDS, FIGURE_CHANGE, SHARED_LIMIT, marksIn, numbersIn, withoutOwnShareCap, type CheckedBenefit, type CheckedCover, type CheckedReading, type Source } from "./check";
import type { CoverType, SectionLink, SectionRef } from "./reading";
import { headingIsLife } from "./life-heading";
import { benefitWords } from "./cover-rows";

export type FamilyMember = { id: string; display_name: string; preferred_name?: string | null;
  /** The date of birth the household entered on the Family page (YYYY-MM-DD), when it did: tells which age group's row of a
   * wording is the person's (tierProblem). */
  date_of_birth?: string | null;
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
  /** Rows of a linked section shown with no amount for a person because they are printed for a kind of insured person or
   * plan (a family plan, a child, one of several age groups) that the person's own documents do not say they are
   * (tierProblem); each is also on the person's rows, with the reason as its figure's why. */
  notForPerson?: { personId: string; benefit: string; section: string | null; column: string | null; why: string; source: Source }[];
  /** Each row with a figure of its own shown for no one because its document prints the cover for two or more people and
   * the row does not say whose (whoseRows, NOT_TOLD_WHY): the chat says where it is printed instead of that it is missing. */
  notToldRows?: { benefit: string; section: string | null; column: string | null; value: number | null; currency: string | null; source: Source }[];
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
  // A copy that proves no sum (a pack's name line, a page with two sum lines) beside the same person's one copy of the cover
  // type that proves a sum is that cover printed again, not a second cover: it is kept as a copy of it, so its rows are
  // not shown twice, once with no amount (Critic #454 M2). A copy with a printed policy number, or beside two or more
  // proved copies, stays as read.
  // Only a copy whose document prints no benefit rows of its own: a document with rows keeps its own cover, so its rows are
  // never worked out on another document's sum (Critic #454 round 2: a renewal whose new sum was not proved).
  const printsRows = new Set(readings.filter((r) => r.benefits.length).map((r) => r.documentId));
  for (const c of [...covers]) {
    if (c.sumInsured != null || c.notionalSum != null || numberOf.has(c) || printsRows.has(c.source.documentId)) continue;
    const proved = covers.filter((x) => x !== c && x.personId === c.personId && x.coverKey === c.coverKey && (x.sumInsured != null || x.notionalSum != null));
    if (proved.length !== 1) continue;
    const kept = proved[0];
    const docs = (x: PersonCover) => x.copyDocuments ?? [{ documentId: x.source.documentId, kind: x.documentKind ?? null }];
    kept.copyDocuments = [...docs(kept), ...docs(c).filter((d) => !docs(kept).some((k) => k.documentId === d.documentId))];
    covers.splice(covers.indexOf(c), 1);
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
/** A percentage printed as a share of the basic (main) plan's or policy's sum. */
const BASIC_PLAN_SHARE = /%[^\n%]{0,60}\b(?:basic|base|main)\s+(?:plan|policy|contract|benefit)\b|%[^\n%]{0,60}\bof\s+the\s+(?:basic|base|main)\b/i;
function baseFigure(b: CheckedBenefit, cover: PersonCover): Figure {
  if (b.pays === "amount" || b.pays === "up_to" || b.pays === "per_day" || b.pays === "per_period")
    return { kind: "printed", amount: b.value!, currency: b.currency, unit: b.pays === "amount" ? "lump_sum" : b.pays, period: b.period };
  if (b.pays === "value") return { kind: "value", amount: b.value!, currency: b.currency, asOf: b.asOf };
  if (b.pays !== "percent") return { kind: "none", why: b.pays === "not_covered" ? "printed as not covered" : b.pays === "as_charged" ? "paid as charged, no limit printed on this row"
    : b.pays === "words" && /\d\s*%/.test(b.source.excerpt) ? "paid as a share printed in the row's words, with no amount worked out: see the document" : "no figure printed" };
  // A row whose words say it is capped, with no cap read and checked (or a reading from before caps were read), is never
  // worked out: the uncapped figure could be more than it pays.
  if (b.cap == null && (b.capUnread || CAP_WORDS.test(b.ownShareNamed ? withoutOwnShareCap(b.source.excerpt, b.value) : b.source.excerpt))) {
    const of = shareWords(b);
    return { kind: "none", why: `${b.value}% of ${of ?? "a printed amount"}, up to a maximum printed with it on p${b.source.page} that was not captured: see the document`,
      ...(of ? { share: { percent: b.value!, of, capWords: null, capPage: null, capMissing: true } } : {}) };
  }
  // A cap printed in another currency than the amount it limits ("10% of US$100,000, up to S$15,000") cannot be compared
  // with it: no amount, the row keeps its share and its cap as printed (Critic audit of 5c1075d7, A2).
  const otherCurrencyCap = (currency: string | null) => b.cap != null && !!b.capCurrency && b.capCurrency !== currency;
  if (b.percentOf === "sum_insured" && cover.sumInsured != null && otherCurrencyCap(cover.currency)
    || b.percentOf === "fixed_amount" && b.baseAmount != null && otherCurrencyCap(b.currency))
    return withShare(b, { kind: "none", why: `${b.value}% of ${shareWords(b) ?? "a printed amount"}, with a maximum printed in another currency on p${b.capSource?.page ?? b.source.page}: see the document` });
  const capped = (amount: number, currency: string | null, how: string): Figure =>
    b.cap != null && amount > b.cap
      ? { kind: "worked_out", amount: b.cap, currency, how: `${how} is more than the most it pays, so up to ${money(b.cap, currency)} (printed with it on p${b.capSource?.page ?? b.source.page})`, capped: true }
      : { kind: "worked_out", amount, currency, how: b.cap != null ? `${how}, within its limit of ${money(b.cap, currency)}` : how };
  if (b.percentOf === "fixed_amount" && b.baseAmount != null)
    return capped(cents(b.value! * b.baseAmount / 100), b.currency, `${b.value}% of ${money(b.baseAmount, b.currency)}, printed on the same page`);
  if (b.percentOf === "sum_insured") {
    // A rider's row that is a share of the basic plan's sum ("20% of the Basic Plan Sum Assured") is not a share of the
    // rider's own sum (Critic, #415): no amount, the share stays as printed.
    if (cover.riderOf && BASIC_PLAN_SHARE.test(b.source.excerpt)) return withShare(b, { kind: "none", why: `${b.value}% of the basic plan's sum, which is not this rider's own sum insured` });
    if (cover.sumInsured == null) return withShare(b, { kind: "none", why: `${b.value}% of the sum insured, but no sum insured is printed for ${cover.cover}` });
    return capped(cents(b.value! * cover.sumInsured / 100), cover.currency,
      `${b.value}% of ${money(cover.sumInsured, cover.currency)} (${cover.cover}, ${cover.confirmation?.status === "corrected" ? "the figure you gave" : `${cover.source.document} p${cover.source.page}${cover.asOf ? `, as of ${cover.asOf}` : ""}`})`);
  }
  return withShare(b, { kind: "none", why: `${b.value}% of a base the page does not state` });
}

/** The cover whose sum a percentage row is a share of when the row names it ("Total and permanent disability: 100% of the
 * death sum assured"): another cover of the same person, printed on the same document, of the same product and policy
 * number, whose own name is exactly the words before "sum assured" / "sum insured" / "sum covered" (filler words and
 * short forms such as TPD read as in cover-rows), and which prints its sum. Exactly one such cover, or none: a name two
 * covers share, another person's cover, another policy's (a shared number never joins products or people) or a cover
 * that prints no sum gives null, and the row keeps its share with no amount. */
const SUM_WORDS = /\s+(?:sum\s+(?:assured|insured|covered)|insured\s+(?:amount|sum)|coverage\s+amount)$/i;
export function shareBaseCover(b: CheckedBenefit, cover: PersonCover, personCovers: PersonCover[]): PersonCover | null {
  if (b.pays !== "percent" || b.value == null || b.percentOf === "fixed_amount") return null;
  const printed = readShare(b.source.excerpt, { name: [b.benefit, b.section].filter(Boolean).join(" ") });
  if (!printed || printed.percent !== b.value || !SUM_WORDS.test(printed.of)) return null;
  const words = benefitWords(printed.of.replace(SUM_WORDS, "").replace(/^\s*(?:the|your|its)\s+/i, ""));
  if (!words.size) return null;
  const same = (a: Set<string>) => a.size === words.size && [...a].every((w) => words.has(w));
  if (same(benefitWords(cover.cover))) return null;
  const samePolicy = (x: PersonCover) => !x.policyNumber && !cover.policyNumber || !!x.policyNumber && !!cover.policyNumber && samePolicyNumber(x.policyNumber, cover.policyNumber);
  const found = personCovers.filter((x) => x.personId === cover.personId && x.coverKey !== cover.coverKey && x.source.documentId === cover.source.documentId
    && norm(x.product) === norm(cover.product) && samePolicy(x) && same(benefitWords(x.cover)));
  if (new Set(found.map((x) => x.coverKey)).size !== 1 || new Set(found.map((x) => `${x.sumInsured}|${x.currency}`)).size !== 1) return null;
  return found[0].sumInsured != null ? found[0] : null;
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
/** Words that only say what a column's figure is ("Limit per insured person", "Sum assured / amount", "Amount payable"),
 * never which plan it is for. A closed list. */
const FIGURE_HEADING_WORDS = new Set(["limit", "limits", "amount", "amounts", "sum", "sums", "insured", "assured", "covered", "benefit",
  "benefits", "maximum", "payable", "person", "persons", "each", "cover", "coverage", "value", "values", "what", "is", "paid", "of", "the"]);
/** A column heading made only of figure words, on the person's own schedule or certificate (the personal document their
 * cover with that plan is printed on), when it is the only column heading that document prints: the document's one column
 * of figures, for the plan it prints for them (a certificate's "Limit per insured person" for a couple plan). With a second
 * column on the document ("Limit per family" beside it), or in a wording, summary or scheme terms that may list one plan's
 * column of many, it is not told apart from a plan's, and stays refused (Critic R85-1, R88-2). */
export const figureOnlyHeading = (column: string | null, soleColumn: boolean) => {
  const words = headingWords(column).split(" ").filter(Boolean);
  return soleColumn && words.length > 0 && words.every((w) => FIGURE_HEADING_WORDS.has(w));
};
function columnProblem(column: string | null, cover: CoverType, plans: Set<string>, soleColumn = false): string | null {
  const words = headingWords(column);
  if (!words) return null;
  if (figureOnlyHeading(column, soleColumn)) return null;
  // For a cover that prints a plan, any other column is refused: a lone "Classic" column cannot be told apart from a
  // neutral heading, and showing another plan's figure is worse than showing none.
  if (cover.plan) return words === headingWords(cover.plan) ? null : `column "${column}" is not the plan "${cover.plan}" on the person's cover`;
  // A heading that says "Plan" or "Option" names a plan, whatever follows.
  const saysPlan = /\b(?:plans?|options?)\b/i.test(column ?? "");
  if (!saysPlan && ![...plans].some((p) => within(p, words) || within(words, p))) return null;
  return `column "${column}" names a plan, but the person's cover prints no plan`;
}

/** Rows printed for one kind of insured person or plan, by the words of the row's own label (or its column): a family plan
 * ("Overall limit for family plan", "per family"), a child ("Child covered under a family plan", "each child"), or an
 * age group ("Adult below 70 years of age", "70 years old or older", "aged 65 and above"). Such a row is the person's only
 * when their own cover's document prints the same: "family" for a family row, "child" for a child row, the same age
 * group for an age row. When it cannot be told, the row is not the person's figure (never another tier's amount: 10 Nov,
 * a family plan's S$12,500 baggage limit was shown on a single traveller's plan). A label that only names a child as the
 * subject of the benefit ("Child companion", "child care") is not a tier. */
const FAMILY_TIER = /\b(?:family\s+(?:plan|cover|policy|limit|option)s?|per\s+family|for\s+(?:a|the|each)\s+family|family\s+overall)\b/i;
const CHILD_TIER = /\b(?:child(?:ren)?\s+(?:covered|insured|below|under|aged|up\s+to)|(?:each|per|every|insured)\s+child|for\s+(?:a|each|every)\s+child|dependent\s+child(?:ren)?)\b/i;
/** An age group as "<n" / ">=n" / "a-b", the same for every wording of it. A number counts as an age only with "years",
 * "yrs" or "age(d)" beside it, so "over 3 days" or "S$500 and above" is never an age group. */
const YEARS = String.raw`\s*(?:years?|yrs?)(?:\s+old)?(?:\s+of\s+age)?`;
const AGE_PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [new RegExp(String.raw`\b(below|under|less\s+than|younger\s+than)\s+(?:the\s+age\s+of\s+)?(\d{1,3})${YEARS}`, "i"), (m) => `<${m[2]}`],
  [new RegExp(String.raw`\baged?\s+(below|under|less\s+than|younger\s+than)\s+(\d{1,3})\b`, "i"), (m) => `<${m[2]}`],
  [new RegExp(String.raw`\b(over|above|more\s+than|older\s+than)\s+(?:the\s+age\s+of\s+)?(\d{1,3})${YEARS}`, "i"), (m) => `>${m[2]}`],
  [new RegExp(String.raw`\baged?\s+(over|above|more\s+than|older\s+than)\s+(\d{1,3})\b`, "i"), (m) => `>${m[2]}`],
  [new RegExp(String.raw`\b(\d{1,3})${YEARS}\s+(?:or|and)\s+(older|above|over)\b`, "i"), (m) => `>=${m[1]}`],
  [new RegExp(String.raw`\baged?\s+(\d{1,3})\s+(?:or|and)\s+(older|above|over)\b`, "i"), (m) => `>=${m[1]}`],
  [new RegExp(String.raw`\b(\d{1,3})${YEARS}\s+(?:or|and)\s+(below|under|younger)\b`, "i"), (m) => `<=${m[1]}`],
  [new RegExp(String.raw`\b(?:aged?\s+)?(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\s*(?:years|yrs)\b`, "i"), (m) => `${m[1]}-${m[2]}`],
];
function ageBand(text: string): string | null {
  for (const [re, band] of AGE_PATTERNS) { const m = re.exec(text); if (m) return band(m); }
  return null;
}
/** Whether an age is in a band ageBand gives. */
function inBand(age: number, band: string): boolean {
  const m = /^(<=|>=|<|>)(\d+)$/.exec(band);
  if (m) { const n = Number(m[2]); return m[1] === "<" ? age < n : m[1] === ">" ? age > n : m[1] === "<=" ? age <= n : age >= n; }
  const [a, b] = band.split("-").map(Number);
  return age >= a && age <= b;
}
/** Whole years from a YYYY-MM-DD birth date to `today` (a Singapore day number, as singaporeDay), or null. */
export function ageOn(dateOfBirth: string | null | undefined, today: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth ?? "");
  if (!m) return null;
  const now = new Date(today * 86_400_000);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const age = now.getUTCFullYear() - y - (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}
/** The benefit a row is for, without its age group: "Personal accident: Adult below 70 years of age" and "Personal
 * accident: Adult 70 years old or older" are the same benefit printed for two age groups. */
function ageStem(label: string): string {
  const head = label.includes(":") ? label.split(":")[0] : AGE_PATTERNS.reduce((t, [re]) => t.replace(new RegExp(re.source, "gi"), " "), label);
  return norm(head);
}
/** Per document, section and column: each benefit's age groups. An age group is a tier only where the same benefit is
 * printed for two or more of them side by side; one alone ("TPD for insured persons under 65 years of age") is a condition
 * of the benefit, and the row stays the person's. */
function ageAlternatives(readings: CheckedReading[]): (r: CheckedReading, b: CheckedBenefit) => boolean {
  const bands = new Map<string, Set<string>>();
  const key = (r: CheckedReading, b: CheckedBenefit) => [r.documentId, norm(b.section), norm(b.column), ageStem(`${b.benefit}`)].join("|");
  for (const r of readings) for (const b of r.benefits) {
    const band = ageBand(`${b.benefit} ${b.column ?? ""}`);
    if (!band) continue;
    const k = key(r, b);
    bands.set(k, (bands.get(k) ?? new Set()).add(band));
  }
  return (r, b) => (bands.get(key(r, b))?.size ?? 0) >= 2;
}
/** `age`: the person's age from the date of birth the household entered, or null when it entered none. `ageTier`: the row's
 * benefit is printed for two or more age groups side by side (ageAlternatives); otherwise an age in it is a condition. */
export function tierProblem(b: Pick<CheckedBenefit, "benefit" | "column">, ownWords: string, age: number | null = null, ageTier = true): string | null {
  const label = `${b.benefit} ${b.column ?? ""}`;
  if (FAMILY_TIER.test(label) && !/\bfamily\b/i.test(ownWords)) return "printed for a family plan; the person's own documents do not say their plan is a family plan";
  if (CHILD_TIER.test(label) && !/\bchild(?:ren)?\b/i.test(ownWords)) return "printed for a child; the person's own documents do not say they are insured as a child";
  const band = ageTier ? ageBand(label) : null;
  if (band && ageBand(ownWords) !== band) {
    if (age == null) return "printed for one age group of several; add this person's date of birth on the Family page to see whether it is theirs";
    if (!inBand(age, band)) return "printed for an age group the person is not in (by the date of birth on the Family page)";
  }
  return null;
}
/** What the person's own cover prints about who and what it covers: its plan, cover, product and line, and its document's
 * product and plan. */
function ownTierWords(c: PersonCover, readings: CheckedReading[]): string {
  const own = readings.find((r) => r.documentId === c.source.documentId);
  return [c.plan, c.cover, c.product, c.source.excerpt, own?.product, own?.plan, own?.tierLines].filter(Boolean).join(" \n ");
}
/** The covers the person's own document prints as not covered (its "not covered" rows), as label words: a wording's row
 * for one of them shows no amount for that person. */
const NOT_COVER_WORDS = new Set(["cover", "covers", "coverage", "rider", "riders", "benefit", "benefits", "add", "on", "optional", "option"]);
const coverHead = (label: string) => norm(label.replace(/\([^)]*\)/g, " ").split(":")[0]);
const notCoverKey = (label: string) => coverHead(label).split(" ").filter((w) => w && !NOT_COVER_WORDS.has(w)).join(" ");
/** Only a "not covered" row with no column, or in the person's own plan's column, counts; and never one whose label the
 * same schedule also prints with a covered value (an Adult column's S$100,000 beside a Child column's "Not covered"). */
function notCoveredOn(c: PersonCover, readings: CheckedReading[]): string[] {
  const own = readings.find((r) => r.documentId === c.source.documentId);
  if (!own) return [];
  const covered = new Set(own.benefits.filter((b) => b.pays !== "not_covered").map((b) => notCoverKey(b.benefit)));
  return own.benefits.filter((b) => b.pays === "not_covered" && (!headingWords(b.column) || headingWords(b.column) === headingWords(c.plan)))
    .map((b) => notCoverKey(b.benefit)).filter((k) => k && !covered.has(k));
}
const printedNotCovered = (b: CheckedBenefit, keys: string[]) => { const head = coverHead(b.benefit); return keys.some((k) => head === k || head.startsWith(`${k} `)); };

/** The covers a linked section's rows are built for. Where the person holds several policies of the cover type
 * (holdings), a section printed on one policy's own document belongs to that policy only, never to the other; a section
 * on a document that holds none of them (a wording, a product summary) belongs to each. */
function ownCovers(list: PersonCover[], documentId: string): PersonCover[] {
  // A person's own document's rows are worked out on the cover read from that document, never on another copy of the
  // cover type from another document (TE #454 3a: a renewal's two certificates, each worked out on both years' sums).
  if (list.some((c) => c.holding)) {
    const read = list.filter((c) => c.source.documentId === documentId);
    return read.length ? read : list;
  }
  const own = list.filter((c) => c.source.documentId === documentId || (c.copyDocuments ?? []).some((d) => d.documentId === documentId));
  return own.length ? own : list;
}

/** A column heading that says its figures are each insured person's ("Limit per insured person", "Maximum amount payable
 * each insured person", "Benefit limit per person"). */
const PER_PERSON_HEADING = /\b(?:per|each|every)\s+(?:insured\s+)?(?:persons?|insured)\b/i;
/** Words that name a kind of insured life. They only ever withhold a row from the per-person rule, never give one: a
 * backstop under the reader's own mark for a row such as "Child hospital cash" or a "SENIOR CITIZENS" section, should the
 * reader mark it for every named person (TE on #464). */
const KIND_OF_LIFE = /\b(?:child(?:ren)?(?:'s)?|kids?|infants?|bab(?:y|ies)|juvenile|junior|minors?|adults?|seniors?|elderly|aged|students?|spouses?|wife|husband|partner|policy\s*holder|parents?|principal|dependants?|dependents?)\b/i;
/** Words that tell one insured life from another in a row's own name ("Hospital cash Mum", "Medical expenses - Insured 1",
 * "Hospital cash Joint Life", "Accident Dad", "Hospital cash Mrs"). A role word counts only with a role before it or a tag
 * after it ("Joint Life", "Insured 1"), so "Sum insured" is not a life. A document any of whose row names holds one prints its rows per life, so none
 * of its rows is every named person's: withhold-only, like KIND_OF_LIFE, and checked after the "per insured person" phrase
 * is taken out of the name. */
const LIFE_TAG = /\b(?:mum|mom|mummy|mommy|mother|dad|daddy|father|grand(?:ma|pa|mother|father|parent|child)|granny|nana|son|daughter|brother|sister|sibling|toddler|teen(?:ager)?|youth|pensioner|retiree|mr|mrs|ms|miss|male|female|man|woman|men|women)s?\b|\b(?:main|joint|first|second|third|primary|secondary|other|co|additional|named|account|life)\s+(?:insured|assured|lives?|holder|applicant|proposer)\b|\b(?:insured|assured|lives?|holder|applicant|proposer)\s+(?:[a-z]|\d+|[ivx]+)\b/i;
/** A row of a certificate's one column of per-person limits that is for every insured person the certificate names. All
 * must hold, and any doubt gives no one (a figure for one life is never shown for another):
 * - the reader says the row is for each insured person the document names and nothing on it limits the row to some of
 *   them (forWhom "each_named_insured"; left out, it is no one's): a child's, adult's or senior's row, or "half for
 *   children" in a note, is said only in words;
 * - its column heading is made only of figure words and says "per (insured) person", and it is the only heading and
 *   column the person's own certificate or schedule prints (figureOnlyHeading): the whole table is per person;
 * - it prints a money figure, not a share of each person's sum;
 * - its section, column, name, own printed line, and the next line unless that line starts another row, print no number
 *   but its own figures (amount, cap, days): an age ("aged 65 and over", "under 18"), a child's rate beside it or another
 *   amount for someone else makes it no one's;
 * - no other row of the document prints its benefit name, or a different figure under a name sharing a word with it (one
 *   row per life, whatever words tell the lives apart);
 * - a row printed right above or below it is also marked for each named insured person: a neighbour the reader says is
 *   for some of them ("Child rate S$25 per day") may change this row for those people.
 * Each number is matched once: a child's "S$30 per day" beside a 30-day limit is a number the row does not own.
 * The row is then checked against each person's kind of life (tierProblem), and never given to anyone the certificate does
 * not name (whoseRows, documentLives). */
/** The words of a row name, possessives and the "per (insured) person" phrase taken out. */
const labelWords = (s: string) => norm(s.replace(/['’]s\b/gi, "").replace(/\b(?:per|each|every|for\s+(?:each|every))\s+(?:insured\s+)?(?:persons?|insured|lives?|members?)\b/gi, " ")).split(" ").filter(Boolean);
/** The plan or tier markers in a row's own name: a tier word ("Gold", "Basic") or the word on either side of plan, tier,
 * option, package or class ("Plan 1", "Option B", "Class A"), never a travel class ("economy class"). */
const TIER_WORD = /^(?:gold|silver|platinum|bronze|basic|standard|premier|classic|deluxe|elite|superior|executive|essential|essentials)$/;
const TIER_HEAD = /^(?:plan|plans|tier|tiers|option|options|package|packages|class)$/;
const TRAVEL_CLASS = /^(?:economy|business|first|premium|coach|travel)$/;
function tierMarkers(benefit: string): string[] {
  const ws = labelWords(benefit), out: string[] = [];
  ws.forEach((w, k) => {
    if (TIER_WORD.test(w)) out.push(w);
    if (!TIER_HEAD.test(w)) return;
    for (const n of [ws[k - 1], ws[k + 1]]) if (n && !TIER_HEAD.test(n) && !(w === "class" && TRAVEL_CLASS.test(n))) out.push(`${w.replace(/s$/, "")}:${n}`);
  });
  return out;
}
/** Whether a document's row names contrast plans or tiers: two or more different markers across them ("Gold" and "Silver",
 * "Option A" and "Option B"). Then its rows are for whoever holds each plan, never every named person's (Critic 1 on #466).
 * One "Basic" or "Standard" alone is part of a benefit's name. Withhold-only. */
function contrastsTiers(benefits: CheckedBenefit[]): boolean {
  // Two rows, each with markers, that differ: one row's own words ("Cancellation option cover") are no contrast.
  const sets = benefits.map((b) => tierMarkers(b.benefit).sort().join("|")).filter(Boolean);
  return new Set(sets).size >= 2;
}
/** Whether a row's name names an insured life: a role or relation word (LIFE_TAG), a word of a person the
 * document names, or their initials ("AR" for Asha Rao). */
function namesALife(benefit: string, people: string[]): boolean {
  const ws = labelWords(benefit), text = ws.join(" ");
  if (LIFE_TAG.test(text)) return true;
  const own = new Set<string>();
  for (const p of people) {
    const pw = norm(p).split(" ").filter(Boolean);
    pw.forEach((w) => own.add(w));
    if (pw.length > 1) own.add(pw.map((w) => w[0]).join(""));
  }
  return ws.some((w) => own.has(w));
}
/** Words that name a kind of benefit, event or thing insured. An allow-list: two rows whose names share the rest and differ
 * only in these ("Travel delay" / "Baggage delay", "Loss of baggage" / "Loss of passport") are two benefits; a word not here
 * keeps them one benefit, withheld when the figures differ (Critic 1 on #466: "Gold" / "Silver", "Mr" / "Mrs", "male" /
 * "female", "individual" / "couple"). Only ever lets a row be shown that the rest of the rule already allows. */
const BENEFIT_KIND = new Set(("travel trip journey flight flights baggage luggage belongings personal effects passport passports document documents money " +
  "delay delayed cancellation curtailment interruption postponement abandonment missed connection departure diversion overbooking " +
  "accident accidental death disablement disability dismemberment injury liability legal expenses costs cost medical dental optical " +
  "hospital hospitalisation hospitalization inpatient outpatient surgical surgery ambulance emergency evacuation repatriation rescue search " +
  "burial funeral cremation remains mortal compassionate visit follow up treatment care nursing assistance overseas domestic abroad home " +
  "loss lost theft stolen damage damaged property contents vehicle car rental excess golf ski winter sports equipment gadget mobile phone " +
  "hijack hijacking kidnap terrorism riot strike weather natural disaster fraud card credit booking hotel accommodation refund deposit " +
  "illness sickness critical cancer maternity mental health recovery convalescence quarantine pet").split(" "));
/** Whether two row names are one benefit printed once per life, by the whole name: equal before a separator ("Medical
 * expenses - X", "Medical expenses (X)"), one name the whole start or end of the other ("Hospital cash" / "Hospital cash
 * Grandma"), or equal but for words not all naming a kind of benefit (BENEFIT_KIND: a tag, a tier, a kind of life).
 * Two names that share part and differ only in benefit words ("Travel delay" / "Baggage delay", "Personal accident" /
 * "Personal liability") are two benefits, as are names that share no start or end. */
function sameBenefitPerLife(a: string, b: string): boolean {
  const head = (s: string) => norm(s.split(/\s[-–—:\/]\s?|[(\[,;]/)[0]);
  if (head(a) && head(a) === head(b) && (head(a) !== norm(a) || head(b) !== norm(b))) return true;
  const x = labelWords(a), y = labelWords(b);
  if (!x.length || !y.length) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0;
  while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  const dx = x.slice(i, x.length - j), dy = y.slice(i, y.length - j);
  if (!dx.length || !dy.length) return true;
  if (!i && !j) return false;
  // With the rest of the name shared, they are two benefits only when what tells them apart is, on both sides, words that
  // name a kind of benefit ("Travel" / "Baggage" delay). Anything else, a plan tier ("Gold" / "Silver"), a sex, a title, a
  // plan size ("individual" / "couple"), a letter or number, may be one benefit at two figures for different people.
  return !(dx.every((w) => BENEFIT_KIND.has(w)) && dy.every((w) => BENEFIT_KIND.has(w)));
}
/** Words in a plain table's section headings or a row's own words that tell a plan, tier, family or premium apart (plainTable). */
const PLAIN_TABLE_STOP = /\b(?:plans?|tiers?|options?|packages?|class(?:es)?|famil(?:y|ies)|premiums?|individual|couple|single|per\s+(?:person|insured)|contributions?|cost\s+of\s+cover|waiv\w*|instal?l?ments?|direct\s+debit|payable\s+by)\b/i;
/** A row whose own words print a share of a sum, or name a sum insured or assured: what it pays may be each person's own. */
const NAMES_SUM = /\bsum\s+(?:insured|assured|covered)\b|%|\bper\s*cent\b/i;
/** A family schedule's one plain table of benefits, with one figure per row for every life it names (TE-ACC-20261113 family
 * PA schedule: "5  Hospital cash  GBP 50 per day ..." and "6  Medical expenses  Up to GBP 2,500 ..." under "Section |
 * Benefit | Amount payable", below an insured persons table). The row is each named insured person's only when, beyond
 * the reader's own "each_named_insured" (reading.ts), all of these hold:
 * - the document is a personal schedule or certificate with two or more lives, each holding the one cover the row is
 *   linked to (no other cover, plan or product printed for any of them on it);
 * - every line it prints outside its benefit rows and cover lines is one of the closed set of structural lines (check.ts
 *   plainBlockers: title, insurer, policy number and period, insured persons lines, the premium, column headings, page
 *   furniture, admin lines with no money, share, person, kind of life or amount-scope word, a row's own footnotes); the
 *   row's label is no payment and its figure no premium-line figure; its cell, conditions and footnotes print nothing but
 *   its label, its figures and the known shapes of a condition (onlyRowShapes); and whoseRows never gives a person more than
 *   their own printed sum insured (TE gate round 2: an allow-list, after word lists leaked in round 1);
 * - no row of the document has a column (no plan, tier, life or person columns: one figure for everyone), and no section
 *   heading names a kind of life, a person, an age, a plan, tier or family;
 * - the document prints no line making a figure one limit shared by all the lives (sharedNotes: "Limits are per family",
 *   "Aggregate limit for all insured persons", "in total under this policy");
 * - the row's own words, line and conditions name no kind of life, person, age, plan, tier, family, premium or contribution
 *   (PREMIUM too), no shared limit, no sum insured or share of one, and no words giving some lives another figure ("half",
 *   "reduced", "second and subsequent", "for those ..."; FIGURE_CHANGE); every figure in its conditions and footnotes is
 *   one of its own; each footnote mark it prints ("*", "(note b)") points to a note found on the document that is clean
 *   by the same tests (TE gate on 4a8af1a5, H1-H3);
 * - the document prints no note, anywhere outside a row's own line, that names a kind of life or an age (lifeNotes: "all
 *   benefits for a child are halved"); a note on another row's own line (row 1's "For an insured child under 18, limited to
 *   25% of the Sum Insured") is that row's (checked in perPersonRows, for a per-person column too).
 * The rest of perPersonRows then applies as for a per-person column, and whoseRows still gives a figure equal to one
 * person's own sum to that person alone. */
function plainTable(r: CheckedReading, b: CheckedBenefit, coverKey: string): boolean {
  if (r.kind !== "personal_proof" || b.column != null && norm(b.column)) return false;
  // A line anywhere that makes a figure one limit for all the lives ("Limits are per family unless stated otherwise").
  if ((r.sharedNotes ?? []).length) return false;
  // Every line outside the rows and cover lines is one of the closed set a plain schedule prints (check.ts plainBlockers).
  if (!r.plainBlockers || r.plainBlockers.length) return false;
  // A payment, never a benefit: a payment label, or a figure the premium line prints (TE gate round 2, R2-H3).
  if (PAYMENT_LABEL.test(b.benefit) || (r.premiumFigures ?? []).some((v) => b.value != null && Math.abs(v - b.value) < 0.005)) return false;
  const lives = new Set(r.covers.map((c) => norm(c.person)));
  if (lives.size < 2 || r.covers.some((c) => coverKeyOf(c) !== coverKey) || r.covers.length !== lives.size) return false;
  if (r.benefits.some((x) => norm(x.column))) return false;
  const people = [...r.namedPeople, ...r.covers.map((c) => c.person)];
  for (const x of r.benefits) {
    const h = x.section ?? "";
    if (h && (KIND_OF_LIFE.test(h) || PLAIN_TABLE_STOP.test(h) || SHARED_LIMIT.test(h) || ageBand(h) || tierMarkers(h).length || namesALife(h, people))) return false;
  }
  const own = [b.benefit, b.rowText ?? b.source.excerpt, anotherRowsNote(r, b, b.nextLine) ? "" : b.nextLine ?? "", ...b.conditions].join("\n");
  if (KIND_OF_LIFE.test(own) || PLAIN_TABLE_STOP.test(own) || SHARED_LIMIT.test(own) || FIGURE_CHANGE.test(own) || NAMES_SUM.test(own) || PREMIUM.test(own)
    || ageBand(own) || tierMarkers(b.benefit).length || namesALife(own, people)) return false;
  // A footnote mark the row prints ("GBP 50*", "(note b)") is read with its note: a mark with no note found, or a note that
  // names a life, gives another figure or a shared limit, keeps the row from each person (its figures: perPersonRows).
  for (const mark of marksIn(b.rowText ?? b.source.excerpt)) {
    const notes = plainFootnotes(r, mark);
    if (!notes.length || notes.some((t) => KIND_OF_LIFE.test(t) || FIGURE_CHANGE.test(t) || SHARED_LIMIT.test(t) || NAMES_SUM.test(t) || ageBand(t) || namesALife(t, people))) return false;
    // A note prints nothing beyond the shapes a row's own cell may print.
    if (notes.some((t) => !onlyRowShapes(t.replace(/^\s*(?:notes?\s*)?(?:\(\s*\w{1,2}\s*\)|\w{1,2}[.):]|\*{1,3}|†|‡)\s*:?/i, " ")))) return false;
  }
  // The row's own cell and its conditions print nothing but its label, its figure and the known shapes of a condition
  // (per day, in hospital, from the third day, up to 30 days, per accident, after an excess of ...): any other words may make
  // it a limit shared by all the lives or another life's figure (TE gate round 2, R2-H2). An allow-list, not words to refuse.
  const line = (b.rowText ?? b.source.excerpt).replace(/^\s*(?:section\s+)?\d{1,3}[.)]?\s*\t/i, " ");
  const label = b.benefit.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const cell = line.replace(new RegExp(String.raw`(?<![\p{L}\p{N}])${label}(?![\p{L}\p{N}])`, "iu"), " ");
  if (!onlyRowShapes(cell, true) || b.conditions.some((c) => !onlyRowShapes(c))) return false;
  return true;
}
/** A row label that names a payment, never a benefit (TE gate round 2, R2-H3). */
const PAYMENT_LABEL = /\b(?:price|fees?|premiums?|due|payable|total|quotes?|quotation|charges?|tax(?:es)?|contributions?|instal\w*|cost|debit|renewal)\b/i;
/** The shapes a plain row's cell and conditions may print besides its money figures. */
const ROW_SHAPES = [
  /\bup\s+to\s+\d{1,3}\s+(?:consecutive\s+)?(?:days?|nights?|weeks?)\b/g,
  /\b(?:payable\s+)?(?:from|after)\s+the\s+(?:\d{1,3}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:consecutive\s+)?(?:day|night)\b/g,
  /\b(?:after\s+)?an?\s+excess\s+of\b/g,
  /\b(?:per|a|each)\s+(?:day|night|accident|claim|event|injury|fracture|week|month|year|period\s+of\s+insurance)\b/g,
  /\bin\s+hospital\b/g, /\bup\s+to\b/g, /\b(?:a\s+)?maximum(?:\s+of)?\b/g,
  /\b(?:and|or|the|of|a|an)\b/g,
];
function onlyRowShapes(text: string, own = false): boolean {
  let t = text;
  for (const f of [...anyMoneyFigures(t)].reverse()) t = t.slice(0, f.index) + " " + t.slice(f.index + f.length);
  t = ` ${t.toLowerCase()} `;
  if (own) t = t.replace(/\(\s*(?:note\s+)?[a-z0-9]{1,2}\s*\)|\*{1,3}|†|‡/g, " ");
  for (const re of ROW_SHAPES) t = t.replace(re, " ");
  return !/[a-z0-9]/.test(t);
}
/** The notes a footnote mark points to on the document. */
const plainFootnotes = (r: CheckedReading, mark: string) => (r.footnotes ?? []).filter((f) => f.mark === mark).map((f) => f.text);
/** The number a row's section heading gives it ("5", "Section 5", "SECTION 2 - MEDICAL BENEFITS"), or null. */
function sectionNumber(section: string | null): number | null {
  const m = /^\s*(\d{1,3})[.)]?\s*$/.exec(section ?? "") ?? /^\s*(?:section|part|item|benefit)\s+(\d{1,3})\b(?!\s*(?:years?|yrs?|%|[.,]\d))/i.exec(section ?? "");
  return m ? Number(m[1]) : null;
}
/** Whether the line after a row is another row's own note: it starts with a note mark ("Note (a):", "(a)", "*") that another
 * row of the document prints on its own line ("... maximum GBP 1,500 per accident (note a)") and this row does not. */
function anotherRowsNote(r: CheckedReading, b: CheckedBenefit, line: string | undefined): boolean {
  const m = /^\s*(?:notes?\s*)?(?:\(([a-z]|\d{1,2})\)|([a-z]|\d{1,2})[.):]|(\*{1,3}))/i.exec(line ?? "");
  if (!m) return false;
  const mark = (m[1] ?? m[2] ?? m[3]).toLowerCase();
  const marks = (t: string) => mark.startsWith("*") ? t.trimEnd().endsWith(mark) || t.includes(`${mark} `) || t.includes(`${mark}\t`)
    : new RegExp(String.raw`\(\s*(?:note\s+)?${mark}\s*\)|\bnote\s+${mark}\b`, "i").test(t);
  return !marks(b.rowText ?? b.source.excerpt) && r.benefits.some((x) => x !== b && marks(x.rowText ?? x.source.excerpt));
}
function perPersonRows(readings: CheckedReading[], columnsOn: Map<string, Set<string>>, ownProof: (documentId: string, coverKey: string) => boolean) {
  const figure = (x: CheckedBenefit) => `${x.pays}|${x.value}|${x.currency ?? ""}|${x.period ?? ""}`;
  const firstLine = (t: string) => norm(t.split("\n")[0]);
  return (r: CheckedReading, b: CheckedBenefit, coverKey: string): false | "column" | "plain" => {
    // The reader, which sees the whole document, says the row is each named insured person's and nothing limits it to some
    // (a child's, an adult's, a senior's row; "half for children"): words no layout rule can read (Critic and TE on this rule).
    if (b.forWhom !== "each_named_insured") return false;
    if (b.value == null || b.pays === "percent" || b.pays === "not_covered") return false;
    // A column that says "per (insured) person", or a family schedule's one plain table (plainTable).
    const plain = !PER_PERSON_HEADING.test(b.column ?? "") && plainTable(r, b, coverKey);
    if (!plain && !PER_PERSON_HEADING.test(b.column ?? "")) return false;
    // A note anywhere on the document, off every row's own line, that names a kind of life or an age ("Note: for insured
    // children the limits are 50% of those shown") may change any row for some of the lives (check.ts lifeNotes).
    if ((r.lifeNotes ?? []).length) return false;
    if (KIND_OF_LIFE.test(`${b.benefit} ${b.section ?? ""} ${b.column ?? ""} ${b.rowText ?? b.source.excerpt} ${b.nextLine ?? ""}`)) return false;
    if ((!plain && !figureOnlyHeading(b.column, (columnsOn.get(r.documentId)?.size ?? 0) === 1)) || !ownProof(r.documentId, coverKey)) return false;
    const others = r.benefits.filter((x) => x !== b);
    // A document that tells its lives apart in its row names prints its rows per life: none of them is every person's.
    if (r.benefits.some((x) => namesALife(x.benefit, [...r.namedPeople, ...r.covers.map((c) => c.person)])) || contrastsTiers(r.benefits)) return false;
    // The same benefit printed again, or printed once per life with a tag ("Medical expenses - Insured 1"), is no one's;
    // distinct benefits whose names share a word ("Travel delay", "Baggage delay") are each their own row.
    if (others.some((x) => norm(x.benefit) === norm(b.benefit) || (x.value != null && figure(x) !== figure(b) && sameBenefitPerLife(x.benefit, b.benefit)))) return false;
    // The rows whose own printed line is the line right below or above this row's.
    const rowAt = (line: string | undefined) => line && norm(line) ? others.filter((x) => { const f = firstLine(x.rowText ?? x.source.excerpt), l = norm((x.rowText ?? x.source.excerpt).split("\n").at(-1) ?? "");
      return (f && norm(line).startsWith(f)) || l === norm(line); }) : [];
    const below = rowAt(b.nextLine), above = rowAt(b.prevLine);
    // In a plain table, a neighbour that is a share of each person's own sum insured, unmarked and naming no kind of life,
    // is no other life's figure for this row (a family PA schedule's "4  Fracture of skull ...  5% of the Sum Insured").
    const shareOfOwnSum = (x: CheckedBenefit) => plain && x.forWhom == null && x.pays === "percent" && x.percentOf === "sum_insured"
      && !KIND_OF_LIFE.test(`${x.benefit} ${x.rowText ?? x.source.excerpt} ${x.conditions.join(" ")}`);
    if ([...below, ...above].some((x) => x.forWhom !== "each_named_insured" && !shareOfOwnSum(x))) return false;
    const next = below.length || (plain && anotherRowsNote(r, b, b.nextLine)) ? "" : b.nextLine ?? "";
    // Each number printed may be one of the row's own figures once (amount, cap, days), never twice. The row's own section
    // number, printed in its heading and as the first cell of its line ("5  Hospital cash ..."), is its number, not a figure.
    const own = [b.value, b.cap, b.maxDays, b.fromDay].filter((n): n is number => n != null);
    const num = sectionNumber(b.section);
    if (num != null) {
      own.push(num);
      if (new RegExp(String.raw`^\s*${num}[.)]?\t`).test(b.rowText ?? b.source.excerpt)) own.push(num);
    }
    // In a plain table, the excess the row prints for itself ("after an excess of GBP 100 per claim") is its own too.
    if (plain) for (const m of [b.rowText ?? b.source.excerpt, next, ...b.conditions].join("\n").matchAll(/\b(?:an?\s+)?(?:excess|deductible)\s+(?:of\s+)?(?:\p{Lu}{1,3}\s?)?\p{Sc}?\s?(\d[\d,]*(?:\.\d+)?)/giu)) own.push(Number(m[1].replace(/,/g, "")));
    const owned = new Set(own);
    for (const n of numbersIn([b.section, b.column, b.benefit, b.rowText ?? b.source.excerpt, next].filter(Boolean).join("\n"))) {
      const i = own.indexOf(n);
      if (i < 0) return false;
      own.splice(i, 1);
    }
    // In a plain table the row's conditions and footnotes are its words too: a figure in them that is none of the row's own
    // ("* GBP 25 per day for those in full-time education") is another life's (TE gate H2). A condition that repeats the
    // row's own line was counted with it.
    if (plain) {
      const line = norm(b.rowText ?? b.source.excerpt);
      const more = [...b.conditions.filter((c) => !line.includes(norm(c))), ...marksIn(b.rowText ?? b.source.excerpt).flatMap((m) => plainFootnotes(r, m))];
      if (numbersIn(more.join("\n")).some((n) => !owned.has(n))) return false;
    }
    return plain ? "plain" : "column";
  };
}
/** Why a section's rows are shown for no one when its document prints the cover for two or more people and the rows do
 * not say whose they are (whoseRows). */
export const NOT_TOLD_WHY = "printed for more than one person on this document, and these rows do not say whose they are: not shown for anyone";
/** Whose a linked section's row is, by what its own document prints (joint schedule fix, 10 Nov: a section linked by cover
 * type was shown for every holder of that type, so one life's amounts showed for the other life on a joint schedule).
 * `undefined`: every holder of the cover type, as before (a wording or product summary, a document that prints no one's
 * cover of that type). A heading that is one holder's life gives the row to that holder alone, wherever. Otherwise the people the row may be shown for: when the document prints the cover for exactly one
 * holder, only that holder (never another holder whose own cover is printed elsewhere); when it prints it for two or more,
 * only the one whose life the row's column or section heading is (headingIsLife; never its own line, which may name a payee);
 * when no one life is the heading, those whose own sum printed on that document is the row's figure; otherwise no one (an empty set). Never by page or position. A row that prints
 * no figure of its own, or one worked out on each person's own sum insured, is every holder's. */
function whoseRows(documentId: string, b: CheckedBenefit, coverKey: string, covers: PersonCover[], family: FamilyMember[], perPerson: false | "column" | "plain" = false): Set<string> | undefined {
  // A block or column heading that is a holder's life (Critic #406 X1, J1): only that holder, wherever the document prints
  // covers or none (a benefit summary with one column per person).
  const holders = [...new Set(covers.filter((c) => c.coverKey === coverKey).map((c) => c.personId))];
  const namesOf = (id: string) => [...covers.filter((c) => c.personId === id).map((c) => c.person), family.find((m) => m.id === id)?.display_name ?? ""];
  const headed = holders.filter((id) => [b.column, b.section].some((h) => headingIsLife(h, namesOf(id))));
  if (headed.length === 1) return new Set(headed);
  // A row whose figure is worked out on each person's own sum insured, or that prints none, is right for every holder (a
  // scheme summary's "Death Benefit" for each member): only a row that prints its own figure can be one life's.
  if (b.value == null || (b.pays === "percent" && b.percentOf === "sum_insured")) return undefined;
  const onDoc = (c: PersonCover) => c.source.documentId === documentId || (c.copyDocuments ?? []).some((d) => d.documentId === documentId);
  let printed = covers.filter((c) => c.coverKey === coverKey && onDoc(c));
  // The cover type is not printed on this document, but its holders' other covers are (a personal schedule whose rider is
  // printed only as a benefit section): those holders only.
  if (!printed.length) printed = covers.filter((c) => holders.includes(c.personId) && onDoc(c));
  const ids = new Set(printed.map((c) => c.personId));
  if (!ids.size) return undefined;
  if (ids.size === 1) return ids;
  // No one life is the heading: the people whose own sum printed on this document is the row's figure (DC, 10 Nov). Never
  // anyone else: no one is shown an amount that is not theirs.
  const own = (c: PersonCover) => c.confirmation ? c.confirmation.printed : c.sumInsured;
  const bySum = new Set([...ids].filter((id) => printed.some((c) => c.personId === id && own(c) != null && own(c) === b.value
    && (!c.currency || !b.currency || c.currency === b.currency))));
  // A certificate's one column of per-person limits (perPersonRow): every insured person it names, unless the row's
  // label names one of them. Each is still checked against the row's kind of life (tierProblem in assembleTable).
  if (!bySum.size && perPerson) {
    const label = `${b.benefit} ${b.section ?? ""}`;
    const names = [...covers.filter(onDoc).map((c) => c.person), ...family.flatMap((m) => [m.display_name, m.preferred_name ?? ""])];
    if (!names.some((n) => norm(n).split(" ").some((w) => w && ` ${norm(label)} `.includes(` ${w} `)))) {
      // A family schedule's plain row never gives a person more than their own printed sum insured (TE gate round 2, R2-M2:
      // a fixed GBP 40,000 row on a child insured for GBP 25,000): only those whose own sum on this document is printed and
      // at least the row's figure, in the row's currency.
      if (perPerson === "plain") return new Set([...ids].filter((id) => { const own = printed.filter((c) => c.personId === id).map((c) => ({ v: c.confirmation ? c.confirmation.printed : c.sumInsured, cur: c.currency }));
        return own.length > 0 && own.every((x) => x.v != null && x.v >= b.value! && (!x.cur || !b.currency || x.cur === b.currency)); }));
      return ids;
    }
  }
  // Otherwise no one's own sum: no one, whatever the row says. A family schedule's shared table cannot show whose a figure is: an
  // age group's, a child's or another life's figure can sit in its section, its line or its name (#449, and the Critic on
  // the #447 merge: "per insured person" rows in an "aged 65 and over" section, or with a child's rate beside them).
  return bySum;
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
    // Where each row the reading quotes starts: the first line of every cover's and benefit row's quote, by page.
    const starts = new Set([...r.covers, ...r.benefits].filter((x) => x.source.documentId === r.documentId)
      .map((x) => `${x.source.page}\u0000${firstLine(x.source.excerpt)}`));
    const byLine = new Map<string, Set<string>>();
    for (const c of own) {
      if (!oneRow(c.source, starts)) continue;
      if (own.some((o) => o !== c && o.source.page === c.source.page && flat(o.source) !== flat(c.source) && flat(c.source).includes(flat(o.source)))) continue;
      const k = ownLineKey(c.source);
      byLine.set(k, new Set([...(byLine.get(k) ?? []), coverKeyOf(c)]));
    }
    // A cover quoted by its label cell alone ("Hospital income rider", its figure in the next cell): the label's place.
    const labels = new Map<string, CheckedCover[]>();
    for (const c of own) {
      if (c.source.excerpt.includes("\n") || numbersIn(c.source.excerpt).length) continue;
      const k = ownLineKey(c.source);
      labels.set(k, [...(labels.get(k) ?? []), c]);
    }
    const spaced = (t: string) => t.replace(/\s+/g, " ").trim();
    const labelOf = (b: CheckedBenefit) => {
      const first = spaced(b.source.excerpt.trim().split("\n")[0]);
      for (const [k, cs] of labels) {
        const label = spaced(cs[0].source.excerpt);
        if (cs[0].source.page !== b.source.page || !first.toLowerCase().startsWith(label.toLowerCase())) continue;
        if (figureAt(first.slice(label.length))) return { k, cs };
      }
      return null;
    };
    const byLabel = new Map<string, CheckedBenefit[]>();
    for (const b of r.benefits) {
      if (b.source.documentId !== r.documentId || !b.source.excerpt.trim()) continue;
      const line = ownLineKey(b.source), keys = byLine.get(line);
      if (keys?.size === 1) { const key = [...keys][0]; if (held.has(key)) out.set(b, { cover: key, line }); continue; }
      if (keys) continue;
      const hit = labelOf(b);
      if (hit) byLabel.set(hit.k, [...(byLabel.get(hit.k) ?? []), b]);
    }
    // Only when the label is one person's one cover line, and exactly one row of the page starts with it: a label two
    // people's covers share, or two rows print, never places a row (a joint schedule's "Hospital income rider" for each life).
    for (const [k, rows] of byLabel) {
      const cs = labels.get(k)!;
      const keys = new Set(cs.map(coverKeyOf)), people = new Set(cs.map((c) => nameKey(c.person)));
      if (rows.length !== 1 || keys.size !== 1 || people.size !== 1 || cs.length !== 1) continue;
      const key = [...keys][0];
      if (held.has(key)) out.set(rows[0], { cover: key, line: k });
    }
  }
  return out;
}
const firstLine = (excerpt: string) => excerpt.trim().split("\n")[0].toLowerCase().replace(/\s+/g, " ").trim();
/** A quote is one printed row when it is one line, or a row whose last cell wrapped onto the next line(s): none of its
 * later lines starts another row the same reading quotes on that page ("Hospital income rider S$100 per day, up to 365
 * days per" / "policy year"). A block of several rows ("Death S$300,000" / "Total and permanent disability ...") is not. */
function oneRow(s: Source, starts: ReadonlySet<string>): boolean {
  const lines = s.excerpt.trim().split("\n").map((l) => l.toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean);
  // A later line that is words and then a figure ("Ben Rao Critical illness S$250,000", "ICU benefit S$300 a day") is a
  // row of its own, quoted elsewhere or not; a wrap is words only ("policy year") or starts with its figure ("$1,000",
  // "RM 50,000, once per lifetime") (Critic 4 on #447).
  return lines.slice(1).every((l) => !starts.has(`${s.page}\u0000${l}`) && (!numbersIn(l).length || startsWithFigure(l)));
}
const startsWithFigure = (line: string) => figureAt(` ${line.trim()}`);
/** What follows a label cell in its row: a figure cell, with an optional currency code or sign before it ("S$100", "RM 250",
 * "$5,000", "GBP 50", "100%"). */
const FIGURE_CELL = /^\s+(?:(\p{Lu}{1,3})\s?)?(\p{Sc})?\s?\d/u;
const CURRENCY_CODES = new Set([...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : []), "RM", "RP"]);
/** A figure at the start (after the leading space): a digit, a currency sign, or a currency code; "TPD 50,000" is not. */
function figureAt(text: string): boolean {
  const m = FIGURE_CELL.exec(text);
  if (!m) return false;
  return !m[1] || !!m[2] || CURRENCY_CODES.has(m[1].toUpperCase());
}
/** Why a section's rows are shown for no one (documentLives). */
export const NOT_THEIR_DOCUMENT_WHY = "printed on the own document of people who hold no cover this part is linked to: not shown for anyone else";
/** Why a holder is not shown a row printed on another person's own document (documentLives). */
export const OTHER_PERSONS_DOCUMENT_WHY = "printed on another person's own document, not on one of this person's";
/** Kinds of document that are for every holder of a cover type (a wording, a summary, a scheme's terms, an illustration). */
const FOR_EVERY_HOLDER = new Set(["policy_wording", "product_summary", "scheme_terms", "illustration"]);
/** The lives a person's own document (a schedule, a certificate, a pack: any kind but a wording, a summary, a scheme's
 * terms or an illustration) is about. A row printed on it is shown only for these lives, never for another holder of the
 * cover type (#449 repro, 13 Nov: a certificate whose own cover was not read gave its "1% of the Sum Insured" row to another
 * member holding a cover of the same name, worked out on that member's own sum; Critic/TE #454: the same row is not that
 * member's even when both covers were read, as their own document may print other terms). The lives are the people whose
 * cover was read from it, the people the reading gave a cover to whose name the document prints (checkReading coverPeople;
 * a name outside the family counts too, as a life that is no one here), and the people the household linked to it; never
 * one the household took off it. A document with no such life (an attachment naming no one) is shared as before. Fixed
 * for any document: it reads who the document is about, never a product, cover or benefit name. */
function documentLives(r: CheckedReading, covers: PersonCover[], family: FamilyMember[]): Set<string> | null {
  if (FOR_EVERY_HOLDER.has(r.kind)) return null;
  const onDoc = (c: PersonCover) => c.source.documentId === r.documentId || (c.copyDocuments ?? []).some((d) => d.documentId === r.documentId);
  const lives = new Set<string>();
  let outsider = false;
  for (const c of covers) if (onDoc(c)) lives.add(c.personId);
  // A household link makes a life only of a document that prints none, or one the household chose by hand on it: an upload
  // to a parent's profile of a child's certificate never makes the parent a life of it (Critic #454 round 2).
  const printsLives = (r.coverPeople ?? []).length > 0;
  for (const m of family) if ((m.documents ?? []).includes(r.documentId)
    && (!printsLives || (m.chosenAs ?? []).some((p) => p.documentId === r.documentId))) lives.add(m.id);
  for (const name of r.coverPeople ?? []) {
    const record = householdRecord(name, r.documentId, family);
    if (record === "nobody") { outsider = true; continue; }
    const shared = record ? null : sharedNameMatch(name, r.documentId, family);
    const member = record?.member ?? findFamilyMatchWithKind(name, family)?.member ?? (shared && "member" in shared ? shared.member : null);
    if (member) lives.add(member.id); else if (!shared) outsider = true;
  }
  for (const id of [...lives]) if ((family.find((m) => m.id === id)?.excludedFrom ?? []).includes(r.documentId)) lives.delete(id);
  return lives.size || outsider ? lives : null;
}
/** A printed line's place: its page and words, spacing aside. */
export const ownLineKey = (s: Source) => `${s.page}\u0000${s.excerpt.toLowerCase().replace(/\s+/g, " ").trim()}`;
/** For a section of a personal document (schedule, certificate) linked by the model to a cover this document does not
 * print, where that cover is printed by another personal document sharing a policy number with this one: the key of this
 * document's own copy of that same cover. A renewal schedule's benefits were linked to the expired schedule's cover of the
 * same policy (the two readings named the cover a little differently, so they were two covers), and its percentages were
 * worked out on last year's sums insured (TE-ACC-20261113, Okafor: fracture GBP 1,200 for 1,500; PTD GBP 60,000 for 80,000).
 * "Its own copy of that same cover" means, on this document: a cover for the same family member(s) as the linked cover
 * (as each was matched, whatever name is printed), printing a sum insured, the same rider-of and plan, and a cover name
 * that is the other's name with words added or left out ("Family Personal Accident" and "Family Personal Accident
 * Policy"), by at least two words when this document prints more than one cover for them (never a basic plan for a
 * rider, or a rider for the plan: Critic #445 F1, F2, round 2). Exactly one such cover moves the link; none or several leave it as it was (never guessed, and
 * never refused, so nothing is hidden and nothing is asked again on every upload: Critic #445 F4). A link the household
 * chose is never moved (Critic #445 F3). Policy numbers only say which documents are copies of one policy; nothing is
 * merged or added across them. */
function ownVersionOf(readings: CheckedReading[], covers: PersonCover[]) {
  const byDoc = new Map(readings.map((r) => [r.documentId, r]));
  const numbers = (r: CheckedReading) => r.covers.map((c) => c.policyNumber?.trim()).filter((n): n is string => !!n);
  const nameWords = (c: { cover: string }) => new Set(norm(c.cover).split(" ").filter(Boolean));
  const within = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every((w) => b.has(w));
  /** The words both names share, when one name is the other with words added or left out; 0 otherwise. */
  const shared = (a: { cover: string }, b: { cover: string }) => {
    const x = nameWords(a), y = nameWords(b);
    return within(x, y) || within(y, x) ? Math.min(x.size, y.size) : 0;
  };
  return (docId: string | undefined, coverKey: string): string | null => {
    const r = docId ? byDoc.get(docId) : undefined;
    if (!r || r.kind !== "personal_proof" || r.covers.some((c) => coverKeyOf(c) === coverKey)) return null;
    const mineNumbers = numbers(r);
    if (!mineNumbers.length) return null;
    // The linked cover as the other copies of this policy hold it, for the family members it was matched to.
    const copies = new Set(readings.filter((o) => o !== r && o.kind === "personal_proof" && numbers(o).some((n) => mineNumbers.some((m) => samePolicyNumber(n, m)))).map((o) => o.documentId));
    const linked = covers.filter((c) => c.coverKey === coverKey && copies.has(c.source.documentId));
    if (!linked.length) return null;
    const people = new Set(linked.map((c) => c.personId));
    // This document's covers for the same family members (whatever name it prints for them), with a sum insured.
    const theirs = covers.filter((c) => c.source.documentId === r.documentId && people.has(c.personId) && c.sumInsured != null);
    // The same cover: same rider-of and plan, and a name that is the other's with words added or left out. Where this
    // document prints more than one cover for them, a one-word match ("Plan", "Accident") is no evidence of which
    // (Critic #445 round 2: a basic plan's benefits moved onto "Waiver Plan").
    const need = new Set(theirs.map((c) => c.coverKey)).size > 1 ? 2 : 1;
    const keys = [...new Set(theirs.filter((c) => linked.some((l) => norm(c.riderOf) === norm(l.riderOf) && (!c.plan || !l.plan || norm(c.plan) === norm(l.plan))
      && shared(c, l) >= need)).map((c) => c.coverKey))];
    return keys.length === 1 ? keys[0] : null;
  };
}
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
  // The different column headings each document prints (figureOnlyHeading).
  // Counted per heading and column, so one column printed under two headings ("ADULT", "CHILD") is not the sole one.
  const columnsOn = new Map(readings.map((r) => [r.documentId, new Set(r.benefits.filter((b) => norm(b.column)).map((b) => `${norm(b.section)}|${norm(b.column)}`))] as const));
  const proofs = new Set(readings.filter((r) => r.kind === "personal_proof").map((r) => r.documentId));
  const ownProof = (documentId: string, coverKey: string) => proofs.has(documentId) && covers.some((c) => c.coverKey === coverKey && c.source.documentId === documentId);
  const perPersonRow = perPersonRows(readings, columnsOn, ownProof);
  const refusedLinks: BenefitTable["refusedLinks"] = [];
  const linkOf = new Map<string, SectionLink>();
  const ownVersion = ownVersionOf(readings, covers);
  for (const linked of links) {
    // A personal document's own sections are paid under its own copy of the cover, never another document's copy of the
    // same policy (an earlier or later schedule of the same policy number), unless the household chose that link.
    const chosenByHousehold = (linked as { chosenBy?: string }).chosenBy === "household";
    const own = linked.cover && !chosenByHousehold ? ownVersion(docOf.get(linked.section), linked.cover) : null;
    const l = own ? { ...linked, cover: own } : linked;
    const type = l.cover ? types.find((t) => t.key === l.cover) : null;
    const section = sections.find((s) => s.key === l.section);
    if (!section) { refusedLinks.push({ link: l, why: "no such section" }); continue; }
    if (linkOf.has(l.section)) { refusedLinks.push({ link: l, why: "section linked twice" }); continue; }
    if (l.cover && !type) { refusedLinks.push({ link: l, why: "no such cover" }); continue; }
    const problem = type ? columnProblem(section.column, type, plansOf.get(docOf.get(section.key) ?? "") ?? new Set(), (columnsOn.get(docOf.get(section.key) ?? "")?.size ?? 0) === 1
      && ownProof(docOf.get(section.key) ?? "", type.key)) : null;
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
  const notForPerson: NonNullable<BenefitTable["notForPerson"]> = [];
  const isAgeTier = ageAlternatives(readings);
  const notTold = new Set<string>();
  const notToldRows: NonNullable<BenefitTable["notToldRows"]> = [];
  const notTheirs = new Set<string>();
  const livesOf = new Map(readings.map((r) => [r.documentId, documentLives(r, covers, family)] as const));
  for (const r of readings) for (const b of r.benefits) {
    const l = placedOf(sectionKeyOf(r.documentId, b), b);
    if (!l) continue;
    // A row placed by its section's link is shown only for the people its own document says it is for (whoseRows).
    const who = l.line ? undefined : whoseRows(r.documentId, b, l.cover, covers, family, perPersonRow(r, b, l.cover));
    if (who && !who.size) { notTold.add(sectionKeyOf(r.documentId, b)); notToldRows.push({ benefit: b.benefit, section: b.section, column: b.column, value: b.value, currency: b.currency, source: b.source }); continue; }
    // A row on a person's own document is only for that document's own lives (documentLives).
    const about = livesOf.get(r.documentId) ?? null;
    const holders = people.filter((x) => (!who || who.has(x.id)) && x.covers.some((c) => c.coverKey === l.cover));
    const shownFor = people.filter((x) => (!who || who.has(x.id)) && (!about || about.has(x.id)));
    if (about) {
      for (const p of holders) if (!about.has(p.id)) notForPerson.push({ personId: p.id, benefit: b.benefit, section: b.section, column: b.column, why: OTHER_PERSONS_DOCUMENT_WHY, source: b.source });
      if (holders.length && !holders.some((p) => about.has(p.id))) notTheirs.add(sectionKeyOf(r.documentId, b));
    }
    // A row placed by its own line is shown only for the people whose cover was read from that line.
    for (const p of shownFor) for (const c of ownCovers(p.covers.filter((x) => x.coverKey === l.cover && (!l.line || (x.source.documentId === r.documentId && ownLineKey(x.source) === l.line))), r.documentId)) {
      // A row on the person's own schedule or certificate is theirs as printed ("Total Permanent Disability (below 65 years
      // of age)" is a condition of their own cover, not another tier's row): the rule is for wordings, summaries and terms.
      // A share of another of the person's covers' sum, named in the row's own words (shareBaseCover): worked out on that sum.
      const sibling = r.documentId === c.source.documentId ? shareBaseCover(b, c, p.covers) : null;
      const named = sibling ? { b: { ...b, percentOf: "sum_insured" as const }, cover: sibling } : null;
      // A per-person limit given to every named insured (perPersonRow) is checked against each one's kind of life even on
      // their own certificate: it was not printed on their own line.
      const everyNamed = who != null && r.documentId === c.source.documentId && !!perPersonRow(r, b, l.cover);
      const tier = r.documentId === c.source.documentId && !everyNamed ? null
        : tierProblem(everyNamed ? { benefit: `${b.benefit} ${b.section ?? ""}`, column: b.column } : b, ownTierWords(c, readings), ageOn(family.find((m) => m.id === p.id)?.date_of_birth, singaporeDay(now)), everyNamed || isAgeTier(r, b));
      // A row for another tier stays on the table with no amount and the reason, so nothing is lost without a word.
      if (tier) notForPerson.push({ personId: p.id, benefit: b.benefit, section: b.section, column: b.column, why: tier, source: b.source });
      // A cover the person's own schedule prints as not covered shows no amount from another document (a wording's figure
      // for an optional cover they did not buy).
      const figure: Figure = tier ? { kind: "none", why: tier }
        : r.documentId !== c.source.documentId && b.pays !== "not_covered" && printedNotCovered(b, notCoveredOn(c, readings))
          ? { kind: "none", why: "the person's own schedule prints this cover as not covered" } : named ? figureFor(named.b, named.cover, r.kind === "illustration") : figureFor(b, c, r.kind === "illustration");
      p.rows.push({ personId: p.id, person: p.name, coverKey: c.coverKey, product: c.product, cover: c.cover, plan: c.plan, benefit: b.benefit,
        section: b.section, column: b.column, pays: b.pays, figure, fromDay: b.fromDay, maxDays: b.maxDays,
        conditions: b.limitsHeading && belowSumInsured(figure, c) && !b.conditions.includes(b.source.excerpt) ? [...b.conditions, b.source.excerpt] : b.conditions, source: b.source, baseSource: named ? named.cover.source : b.percentOf === "sum_insured" ? c.source : b.baseSource, linkWhy: l.why, qualifier: qualifierOf(b.column),
        percent: b.pays === "percent" ? b.value : null, percentOf: named ? "sum_insured" : b.pays === "percent" ? b.percentOf : null,
        base: named ? named.cover.sumInsured : b.pays !== "percent" ? null : b.percentOf === "sum_insured" ? c.sumInsured : b.percentOf === "fixed_amount" ? b.baseAmount : null,
        baseCorrected: named ? named.cover.confirmation?.status === "corrected" : b.pays === "percent" && b.percentOf === "sum_insured" && c.confirmation?.status === "corrected", capSource: b.capSource ?? null,
        combinedLimit: (b.combinedLimit ?? false) || (!!b.limitsHeading && limitUnderHeading(figure, c)), ...(c.holding ? { holding: c.holding } : {}), coverEnded: c.ended ?? null });
    }
  }
  for (const s of sections) if (notTold.has(s.key) && !unlinkedSections.some((u) => u.section.key === s.key)) unlinkedSections.push({ section: s, why: NOT_TOLD_WHY, source: firstSource.get(s.key) ?? null });
  for (const s of sections) if (notTheirs.has(s.key) && !unlinkedSections.some((u) => u.section.key === s.key)) unlinkedSections.push({ section: s, why: NOT_THEIR_DOCUMENT_WHY, source: firstSource.get(s.key) ?? null });
  return { people, unmatchedCovers: unmatched, ambiguousCovers: ambiguous, illustrationCovers: illustration, unlinkedSections, staleConfirmations, refusedLinks, notForPerson, notToldRows };
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
