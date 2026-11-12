/**
 * Reliable chat, contract A: the benefit records the model selects from, resolved on the SERVER from what the system
 * already stores and parses (personBenefits' documented lines; pct-rows' reconstructed percentage tables on the
 * person's linked documents). Nothing is written. A record carries a stable id, the household and person it was
 * resolved for, the document identity and version, what the benefit prints (an amount, a rate, a percentage, or a
 * percentage schedule with its base), its conditions, its exact source, and a resolution status with explicit unknowns.
 *
 * The id is only a handle: every evaluation re-resolves the records for that household and person (lifecycle and
 * links included) and looks the id up again, so an id from another household, a deleted or superseded document or
 * another person never resolves. Reference wording stays reference wording; a person's own row is personal proof.
 */
import { createHash } from "node:crypto";
import { personBenefits, type PersonBenefit, type PrintedValue } from "./benefits";
import { evidenceAt, type EvidenceRef } from "./evidence";
import { loadDocs, loadLinks, loadMembers, loadPages, policyFamily, type DocRow } from "./store";
import { percentTables, rowNotes, tableConditions, type PctTable } from "./calc/pct-rows";
import { sharedTopic, topicStems } from "./loop/topic";
import { productSection } from "./headings";
import { definitionFor, definitionsIn, type Definition } from "./applicability";

/** A footnote the page prints for THIS row (its marker is on the row; calc/pct-rows.ts rowNotes), with the span it is printed in. */
export type ScheduleNote = { marker: string; text: string; evidence: EvidenceRef };
export type ScheduleRow = { id: string; label: string; percent: number; ppm: number; evidence: EvidenceRef; notes: ScheduleNote[] };
export type ScheduleBase =
  | { kind: "fixed_limit"; label: string; cents: number; currency: string; evidence: EvidenceRef }
  | { kind: "sum_insured"; label: string; cents: number; currency: string; evidence: EvidenceRef; from: PersonBenefit; section?: string }
  | { kind: "unresolved"; words: string; why: string };
export type BenefitRecord = {
  id: string;
  householdId: string;
  memberId: string;
  memberName: string;
  policy: { id: string; product: string | null; insurer: string | null; documentRole: string | null; personalProof: boolean; policyNumber: string | null; groupPolicyNumber: string | null;
    version: { documentHash: string | null; documentDate: string | null; effectiveDate: string | null } };
  benefit: string;
  kind: "printed_amount" | "printed_percent" | "printed_reference" | "percentage_schedule";
  applicability: PersonBenefit["applicability"];
  printed: PrintedValue | null;
  asOf: string | null;
  conditions: string[];
  schedule: { header: string; base: ScheduleBase; rows: ScheduleRow[]; table: PctTable; page: number; pageText: string;
    /** PR #57 follow-up (QC Q1): what the page prints under the table, unmarked, for the table's benefit (every row) -- calc/pct-rows.ts tableConditions. */
    conditions?: ScheduleNote[] } | null;
  status: "resolved" | "incomplete" | "ambiguous" | "conflicting" | "unsupported";
  unknowns: string[];
  source: { page: number; evidence: EvidenceRef };
  personBenefit: PersonBenefit | null;
  /** PR #54 follow-up: the definitions printed in this record's own document (and version) when one of them defines this
   * benefit -- what evaluate_benefit checks the household's report against (lib/rag2/applicability.ts). */
  definitions: Definition[];
};

const MONEY = /(S\$|US\$|HK\$|(?:(?<![A-Za-z])|(?<=[a-z])(?=[A-Z]{2,3}\s?\d))(?:SGD|USD|RM|MYR|HKD))\s?(\d[\d,]*(?:\.\d+)?)/;
const CUR: Record<string, string> = { "S$": "SGD", SGD: "SGD", "US$": "USD", USD: "USD", RM: "MYR", MYR: "MYR", "HK$": "HKD", HKD: "HKD" };
const hid = (...parts: string[]) => "b" + createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 10);
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !["policy", "wording", "summary", "benefits", "schedule", "certificate", "document", "insurance", "group", "scheme"].includes(w)));

/** The benefit a percentage table is for, as the document heads it: its section name; else a "<X> Benefit Limit"
 * line above it; else the nearest title-like heading line above it. */
function tableBenefit(t: PctTable): string | null {
  if (t.name) return t.name.trim();
  const lines = t.heading.split("\n").map((l) => l.trim()).filter(Boolean).reverse();
  for (const l of lines) { const m = /^(.+?)\s+(?:benefit\s+)?(?:sub-?)?limit\b/i.exec(l); if (m && !/\d/.test(m[1])) return m[1].replace(/\s+benefit$/i, "").trim(); }
  // Death-journey release: the section heading the table is printed under (however far above it), before any nearer line: the
  // line nearest a table can be the wrapped start of that section's own sentence ("If an Insured Person sustains bodily
  // injury as a result of an Accident, which"), which names no benefit.
  if (t.section) return t.section;
  // (structured-answers release: a table's own column-header words -- "Schedule", "Compensation", "Benefit" -- name
  // nothing; the benefit is the section title the table is printed under, as the document words it, with its section
  // letter / number dropped: "E. Simple Fracture or Other Fracture due to Accident")
  const HEADER_WORD = /^(?:compensation|schedule|schedule of indemnities|benefit|benefits|amount|amounts|table|description|nature of (?:injury|loss)|bone fractured|payable|limit)(?:\s+(?:compensation|schedule|benefit|amount|payable))*$/i;
  for (const l of lines) { const c = l.replace(/^(?:[A-Z]|\d{1,2}|[ivx]+)[.)]\s+/, "").trim(); if (!/\d/.test(c) && !/[.;:]-?$/.test(c) && c.length <= 80 && !/\bpage\b/i.test(c) && /[A-Za-z]{3}/.test(c) && !HEADER_WORD.test(c) && !/\t/.test(c) && !/^\(/.test(c)) return c; }
  return null;
}

/** What a schedule's percentages are OF, resolved from the document's own wording and the person's own rows. */
function resolveBase(t: PctTable, pageText: string, doc: DocRow, page: number, docs: DocRow[], own: PersonBenefit[], memberName: string, before = ""): ScheduleBase {
  const base = t.base.replace(/\)+$/, "").trim();
  const m = MONEY.exec(base);
  if (m) {
    const cents = Math.round(Number(m[2].replace(/,/g, "")) * 100), currency = CUR[m[1]];
    // the limit line the header restates ("Simple Fracture Benefit Limit: S$5,000"), when the page prints exactly one
    const lines: { text: string; start: number }[] = []; let at = 0;
    for (const l of pageText.split("\n")) { lines.push({ text: l, start: at }); at += l.length + 1; }
    const named = lines.filter((l) => /\blimit\b/i.test(l.text) && (() => { const x = MONEY.exec(l.text); return !!x && CUR[x[1]] === currency && Math.round(Number(x[2].replace(/,/g, "")) * 100) === cents; })() && !/%\s*of/i.test(l.text));
    const line = named.length === 1 ? named[0] : null;
    const evidence = line ? evidenceAt({ policyId: doc.id, documentHash: doc.fileHash, page, pageText, start: line.start, end: line.start + line.text.length, subjectId: null })
      : evidenceAt({ policyId: doc.id, documentHash: doc.fileHash, page, pageText, start: t.headerStart, end: t.headerStart + t.header.length, subjectId: null });
    return { kind: "fixed_limit", label: line ? line.text.split(":")[0].trim() : `the amount the table is a percentage of (${base})`, cents, currency, evidence };
  }
  if (/\bsum (?:insured|assured)\b/i.test(base)) {
    // the person's own Sum Insured: a row printed for them under this policy (its family) or under a product heading
    // that shares this document's distinctive words -- exactly one, never the first of several
    const family = new Set(policyFamily(docs, doc).map((d) => d.id));
    const want = words(doc.productName ?? "");
    const cands = own.filter((b) => b.applicability === "person_row" && b.printed.kind === "money" && !b.conflicts?.length
      && (family.has(b.policy.id) || [...words(b.benefit.label + " " + (b.policy.product ?? ""))].some((w) => want.has(w))));
    let distinct = [...new Map(cands.map((b) => [`${b.printed.kind === "money" ? b.printed.cents : 0}|${b.benefit.label}`, b])).values()];
    // Actual-library findings: a document holding several products under a generic title ("Group Insurance Benefits
    // Booklet"): the product section the table is printed in, as its own headings name it, binds the table to that
    // product's certificate entry -- never the first, the largest, or one sharing only a policy number.
    const section = productSection(`${before}\n${pageText.slice(0, t.start)}`, [...new Set(own.filter((b) => b.applicability === "person_row" && b.printed.kind === "money").map((b) => b.benefit.label))]);
    if (section) {
      const inSection = distinct.filter((b) => b.benefit.label === section.label);
      if (inSection.length === 1) distinct = inSection;
      else if (!inSection.length) return { kind: "unresolved", words: base, why: `the table is printed under “${section.heading}”, and no ${section.label} sum insured is printed for ${memberName} under this scheme in the household's documents` };
    }
    // several products on one certificate (Group Term Life and Group Personal Accident): the one whose own label shares
    // the most distinctive words with this document's product -- a unique best only
    if (distinct.length > 1) {
      const score = (b: PersonBenefit) => [...words(b.benefit.label)].filter((w) => want.has(w)).length;
      const best = Math.max(...distinct.map(score));
      if (best > 0 && distinct.filter((b) => score(b) === best).length === 1) distinct = distinct.filter((b) => score(b) === best);
    }
    if (distinct.length === 1 && distinct[0].printed.kind === "money") {
      const b = distinct[0];
      return { kind: "sum_insured", label: `${memberName}'s ${b.benefit.label} sum insured`, cents: (b.printed as { cents: number }).cents, currency: (b.printed as { currency: string }).currency, evidence: b.source.evidence, from: b, ...(section && section.label === b.benefit.label ? { section: section.heading } : {}) };
    }
    return { kind: "unresolved", words: base, why: distinct.length ? `the ${doc.productName ?? "document"} does not print this table under one of ${memberName}'s certificate products (${distinct.map((b) => b.benefit.label).join(", ")}), so which of those amounts is its Sum Insured is not established` : `no sum insured printed for ${memberName} under this policy was found in the household's documents` };
  }
  return { kind: "unresolved", words: base, why: `the table is a percentage of “${base}”, which is not a printed amount or the person's sum insured` };
}

export async function resolveBenefitRecords(accountId: string, memberId: string): Promise<BenefitRecord[]> {
  const members = await loadMembers(accountId);
  const member = members.find((m) => m.id === memberId);
  if (!member) return [];
  const memberName = member.preferredName || member.displayName;
  const docs = await loadDocs(accountId);
  const view = await personBenefits(accountId, memberId, { docs, members });
  const out: BenefitRecord[] = [];
  const policyOf = (d: DocRow): BenefitRecord["policy"] => ({ id: d.id, product: d.productName, insurer: d.insurer, documentRole: d.documentRole, personalProof: d.personalCoverageConfirmed, policyNumber: d.policyNumber, groupPolicyNumber: d.groupPolicyNumber,
    version: { documentHash: d.fileHash, documentDate: d.documentDate, effectiveDate: d.effectiveDate } });
  for (const b of view.benefits) {
    const d = docs.find((x) => x.id === b.policy.id); if (!d) continue;
    const kind = b.printed.kind === "money" ? "printed_amount" : b.printed.kind === "percent" ? "printed_percent" : "printed_reference";
    // (PR #54, rc-live-8: an amount printed with a bare "$" the document never explains is kept with its benefit, its
    // currency an explicit unknown -- the record is incomplete, never dropped and never given a currency)
    const unstated = b.currency?.status === "unstated";
    // (PR #57 follow-up: a section letter printed before a benefit's name -- "J, " / "G. " -- is not part of the name)
    out.push({ id: hid(accountId, memberId, b.key), householdId: accountId, memberId, memberName, policy: policyOf(d), benefit: b.benefit.label.replace(/^[•▪●◦*–-]\s*/, "").replace(/^[A-Z][.,]\s+(?=[A-Z])/, ""), kind, applicability: b.applicability, printed: b.printed, asOf: b.asOf, conditions: b.conditions,
      schedule: null, status: b.conflicts?.length ? "conflicting" : unstated ? "incomplete" : "resolved",
      unknowns: [...(b.conflicts?.length ? ["another document of this policy prints a different amount; which applies is not decided here"] : []), ...(unstated ? [UNSTATED_CURRENCY] : [])],
      source: { page: b.source.page, evidence: b.source.evidence }, personBenefit: b, definitions: [] });
  }
  // percentage schedules on the person's linked documents (the same documents personBenefits reads)
  const links = await loadLinks(accountId, docs.map((d) => d.id));
  const mine = docs.filter((d) => d.ownerId === memberId || links.some((l) => l.policyId === d.id && l.memberId === memberId));
  const pages = mine.length ? await loadPages(accountId, mine.map((d) => d.id)) : [];
  const defsOf = new Map<string, Definition[]>();
  const definitions = (docId: string, benefit: string): Definition[] => {
    const d = docs.find((x) => x.id === docId);
    if (!d) return [];
    let defs = defsOf.get(docId);
    if (!defs) { defs = definitionsIn(pages.filter((x) => x.policyId === docId).sort((a, b) => a.page - b.page), { id: d.id, hash: d.fileHash }); defsOf.set(docId, defs); }
    return definitionFor(benefit, defs) ? defs : [];
  };
  for (const d of mine) for (const p of pages.filter((x) => x.policyId === d.id)) {
    // the document's text before this page, in page order (the product section a table sits in may start pages earlier)
    const before = pages.filter((x) => x.policyId === d.id && x.page < p.page).sort((a, b) => a.page - b.page).map((x) => x.text).join("\n");
    for (const t of percentTables(p.text)) {
      const benefit = tableBenefit(t); if (!benefit) continue;
      const rows: ScheduleRow[] = t.rows.filter((r) => r.percents.length === 1).map((r, i) => ({ id: `${hid(accountId, memberId, d.id, String(p.page), String(t.start), benefit)}r${i + 1}`, label: r.label, percent: r.percents[0], ppm: Math.round(r.percents[0] * 10_000),
        evidence: evidenceAt({ policyId: d.id, documentHash: d.fileHash, page: p.page, pageText: p.text, start: r.start, end: r.end, subjectId: null }),
        notes: rowNotes(p.text, t, r).map((n) => ({ marker: n.marker, text: n.text, evidence: evidenceAt({ policyId: d.id, documentHash: d.fileHash, page: p.page, pageText: p.text, start: n.start, end: n.end, subjectId: null }) })) }));
      if (!rows.length) continue;
      const base = resolveBase(t, p.text, d, p.page, docs, view.benefits, memberName, before);
      const id = hid(accountId, memberId, d.id, String(p.page), String(t.start), benefit);
      const tableConds: ScheduleNote[] = tableConditions(p.text, t).map((n) => ({ marker: "", text: n.text, evidence: evidenceAt({ policyId: d.id, documentHash: d.fileHash, page: p.page, pageText: p.text, start: n.start, end: n.end, subjectId: null }) }));
      out.push({ id, householdId: accountId, memberId, memberName, policy: policyOf(d), benefit, kind: "percentage_schedule", applicability: "shared_wording", printed: null, asOf: null, conditions: tableConds.map((n) => n.text),
        schedule: { header: t.header, base, rows, table: t, page: p.page, pageText: p.text, conditions: tableConds },
        status: base.kind === "unresolved" ? "incomplete" : "resolved", unknowns: base.kind === "unresolved" ? [base.why] : [],
        source: { page: p.page, evidence: evidenceAt({ policyId: d.id, documentHash: d.fileHash, page: p.page, pageText: p.text, start: t.start, end: t.end, subjectId: null }) }, personBenefit: null, definitions: definitions(d.id, benefit) });
    }
  }
  // a schedule's own rows are its cases, not separate benefits: the printed percentages inside a schedule's table are
  // listed only through the schedule
  const inSchedule = (r: BenefitRecord) => r.kind === "printed_percent" && out.some((x) => x.schedule && x.policy.id === r.policy.id && x.schedule.page === r.source.page
    && r.source.evidence.passage.start >= x.source.evidence.passage.start && r.source.evidence.passage.start <= x.source.evidence.passage.end);
  for (const r of out) if (!r.definitions.length && mine.some((d) => d.id === r.policy.id)) r.definitions = definitions(r.policy.id, r.benefit);
  return out.filter((r) => !inSchedule(r));
}

/** Records ranked by how much they are about the topic (ties keep the document order). */
export function rankRecords(records: BenefitRecord[], topic: string): BenefitRecord[] {
  const want = topicStems(topic);
  const score = (r: BenefitRecord) => sharedTopic(want, topicStems([r.benefit, r.policy.product ?? "", ...r.conditions, ...(r.schedule?.rows.map((x) => x.label) ?? [])].join(" "))).length + (r.kind === "percentage_schedule" && want.size ? 0.5 : 0);
  return records.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
}

/** PR #54 (rc-live-8): what is said for an amount printed with a bare "$" the document never explains. */
export const UNSTATED_CURRENCY = "the document prints this amount with a bare “$” sign and does not say which currency";
/** A printed amount as said to the household and the model: with its currency, or -- for a bare "$" the document never
 * explains -- the figure with that currency stated as unknown (never "S$"). */
export function printedAmount(p: { cents: number; currency: string; unit: string | null }): string {
  if (!p.currency) return `${(p.cents / 100).toLocaleString("en-SG", { minimumFractionDigits: p.cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}${p.unit ? " " + p.unit : ""} (printed with a bare “$” sign; the document does not say which currency)`;
  return `${money(p.cents, p.currency)}${p.unit ? " " + p.unit : ""}`;
}
const money = (cents: number, currency: string) => `${currency === "SGD" ? "S$" : currency + " "}${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const formatMoney = money;
/** A compact record as the model sees it: identities, what is printed, the schedule rows and its base, what is unknown. */
export function recordForModel(r: BenefitRecord): Record<string, unknown> {
  const printed = r.printed?.kind === "money" ? printedAmount(r.printed) : r.printed?.kind === "percent" ? `${r.printed.percent}%${r.printed.of ? " of the " + r.printed.of : ""}` : r.printed?.kind === "reference" ? `the ${r.printed.of}` : null;
  const s = r.schedule;
  return { benefit_id: r.id, benefit: r.benefit, product: r.policy.product, insurer: r.policy.insurer, document: r.policy.personalProof ? "personal proof (lists this person)" : r.applicability === "amendment" ? "amendment" : "reference wording",
    kind: r.kind, ...(printed ? { printed } : {}), ...(r.asOf ? { as_of: r.asOf } : {}), ...(r.conditions.length ? { conditions: r.conditions } : {}), page: r.source.page,
    ...(s ? { schedule: { percentage_of: s.base.kind === "fixed_limit" ? `${s.base.label} (${money(s.base.cents, s.base.currency)})` : s.base.kind === "sum_insured" ? `${s.base.label} (${money(s.base.cents, s.base.currency)})` : `unresolved: ${s.base.why}`,
      cases: s.rows.map((x) => ({ option_id: x.id, case: x.label, percent: x.percent, ...(x.notes.length ? { footnote: x.notes.map((n) => `${n.marker} ${n.text.replace(/\s+/g, " ")}`) } : {}) })) } } : {}),
    status: r.status, ...(r.unknowns.length ? { unknown: r.unknowns } : {}), evidence: r.source.evidence };
}
