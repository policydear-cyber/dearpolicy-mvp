/** The test engineer's adversarial matrix of made-up certificates for per-person rows (13 Nov). Each case states, before
 * running, who must see which rows; safeOnly names people and rows the case does not judge. Used by the paid reader check
 * (per-person-reader-run.ts), which reads each certificate's page text with the real reader, and by its replay. Names,
 * certificates and figures are invented. */
import { coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";


export const BASE_FAMILY: FamilyMember[] = [
  { id: "a", display_name: "Asha Rao", date_of_birth: "1980-04-02" } as FamilyMember,
  { id: "b", display_name: "Ben Rao", date_of_birth: "1978-09-12" } as FamilyMember,
  { id: "k", display_name: "Kiran Rao", date_of_birth: "2016-01-20" } as FamilyMember,
  { id: "c", display_name: "Chen Rao", date_of_birth: "1950-06-30" } as FamilyMember,
  { id: "d", display_name: "Devi Rao", date_of_birth: "1992-03-03" } as FamilyMember,
  { id: "j", display_name: "Jo Lim", date_of_birth: "1985-05-05" } as FamilyMember,
];
export const NAME: Record<string, string> = { a: "Asha Rao", b: "Ben Rao", k: "Kiran Rao", c: "Chen Rao", d: "Devi Rao", x: "John Tan", j: "Jo Lim" };
export const NOW = new Date("2026-11-13T00:00:00Z");

type R = { benefit: string; value: number | null; quote: string; section?: string | null; column?: string | null; pays?: string; maxDays?: number; cap?: number; period?: string };
export type Doc = { id: string; product?: string; lives: string[]; text: string; rows: R[]; kind?: string; extraCovers?: string[] };
const cov = (o: Record<string, unknown>) => ({ plan: null, riderOf: null, policyNumber: "C-7", sumInsured: null, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, ...o });
const row = (o: Record<string, unknown>) => ({ section: null, column: null, value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });

export function build(d: Doc) {
  const product = d.product ?? "Globe Travel Annual";
  const insuredLine = d.text.split("\n").find((l) => /insured/i.test(l) && d.lives.every((n) => l.includes(n))) ?? d.text.split("\n")[1];
  const reading = { document: { kind: d.kind ?? "personal_proof", product, insurer: null, namedPeople: d.lives, plan: null, periodFrom: null, periodTo: null },
    covers: (d.kind ?? "personal_proof") === "personal_proof" ? d.lives.map((person) => cov({ person, product, cover: "Travel", quote: insuredLine, policyNumber: `P-${d.id.slice(-2)}` })) : [],
    benefits: d.rows.map((r) => row({ section: r.section ?? null, column: r.column ?? null, benefit: r.benefit, pays: r.pays ?? "up_to", value: r.value, maxDays: r.maxDays ?? null, cap: r.cap ?? null, capQuote: r.cap ? r.quote.match(/maximum[^\n]*$/)?.[0] ?? null : null, period: r.period ?? null, quote: r.quote })) };
  const page: SourceDoc = { id: d.id, name: `${d.id}.pdf`, readable: true, pages: [{ page: 1, text: d.text }] };
  const r = checkReading(page, reading);
  const key = coverKeyOf({ product, cover: "Travel", plan: null });
  const secs = new Set(d.rows.map((x) => sectionKeyOf(d.id, { section: x.section ?? null, column: x.column ?? null })));
  return { r, links: [...secs].map((section) => ({ section, cover: key, why: "certificate benefits" })) };
}

type Expect = Record<string, string[]>; // person -> benefit names expected shown (exact set). Missing person => [].
export type Case = { id: string; what: string; docs: Doc[]; expect: Expect; family?: FamilyMember[]; safeOnly?: string[] };
const DOCID = (n: number) => `eeeeeeee-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const D1 = DOCID(1), D2 = DOCID(2);
const cert = (lives: string[], body: string[], title = "GLOBE TRAVEL ANNUAL - CERTIFICATE OF INSURANCE") =>
  [title, `Certificate C-7\tInsured persons: ${lives.join(", ")}`, ...body, "Terms and conditions apply."].join("\n");
const L = (ids: string[]) => ids.map((i) => NAME[i]);
/** A one-column per-person table: rows as [benefit, cell, value, extra]. */
function simple(id: string, what: string, lives: string[], column: string, rows: [string, string, number, Partial<R>?][], expectFor: string[], o: { section?: string; pre?: string[]; post?: string[]; product?: string; kind?: string } = {}): Case {
  const lines = rows.map(([b, cell]) => `${b}\t${cell}`);
  const text = cert(L(lives), [...(o.pre ?? []), ...(o.section ? [o.section] : []), `Benefit\t${column}`, ...lines, ...(o.post ?? [])]);
  const docRows = rows.map(([benefit, , value, extra], i) => ({ benefit, value, quote: lines[i], section: o.section ?? null, column, ...(extra ?? {}) }));
  const names = rows.map(([b]) => b);
  return { id, what, docs: [{ id: D1, lives: L(lives), text, rows: docRows, product: o.product, kind: o.kind }], expect: Object.fromEntries(expectFor.map((p) => [p, names])) };
}

export const CASES: Case[] = [
  // ---------------- positives
  simple("P1", "SGD travel couple, S$", ["a", "b"], "Limit per insured person", [["Overseas medical expenses", "S$500,000", 500000], ["Trip cancellation", "S$10,000", 10000]], ["a", "b"]),
  simple("P2", "MYR PA, 3 lives incl child, sum insured per insured person", ["a", "b", "k"], "Sum insured per insured person", [["Accidental death", "RM 100,000", 100000], ["Medical reimbursement", "RM 5,000", 5000]], ["a", "b", "k"], { product: "Takaful PA Family" }),
  simple("P3", "GBP travel, 4 lives, 'Limit per person'", ["a", "b", "k", "c"], "Limit per person", [["Emergency medical", "GBP 10,000,000", 10000000], ["Personal belongings", "GBP 1,500", 1500]], ["a", "b", "k", "c"]),
  simple("P4", "EUR daily rate with day limit", ["a", "b"], "Limit per insured person", [["Hospital daily allowance", "€50 per day, up to 20 days", 50, { pays: "per_day", maxDays: 20 }]], ["a", "b"]),
  simple("P5", "AUD, 5 lives", ["a", "b", "k", "c", "d"], "Benefit limit per person", [["Medical and hospital", "A$ 1,000,000", 1000000], ["Luggage", "A$ 7,500", 7500]], ["a", "b", "k", "c", "d"]),
  simple("P6", "HKD, each insured person", ["a", "d"], "Maximum benefit each insured person", [["Medical expenses", "HK$800,000", 800000]], ["a", "d"]),
  simple("P7", "PHP medical, every insured person", ["b", "d"], "Limit for every insured person", [["Hospitalisation", "PHP 1,000,000", 1000000]], ["b", "d"], { product: "Lakbay Medical" }),
  simple("P8", "bare $ daily rate with day limit and cap", ["a", "b"], "Limit per insured person", [["Hospital cash", "$100 per day up to 30 days, maximum $3,000", 100, { pays: "per_day", maxDays: 30, cap: 3000 }]], ["a", "b"]),
  { id: "P9", what: "partial quote (only the cell)", docs: [{ id: D1, lives: L(["a", "b"]), text: cert(L(["a", "b"]), ["Benefit\tLimit per insured person", "Personal liability\tSGD 1,000,000\tany one event"]),
    rows: [{ benefit: "Personal liability", value: 1000000, quote: "SGD 1,000,000", column: "Limit per insured person" }] }], expect: { a: ["Personal liability"], b: ["Personal liability"] } },
  simple("P10", "section heading without numbers", ["a", "b"], "Limit per insured person", [["Medical expenses", "SGD 250,000", 250000]], ["a", "b"], { section: "SECTION A - MEDICAL BENEFITS" }),
  simple("P11", "section heading with a section number", ["a", "b"], "Limit per insured person", [["Medical expenses", "SGD 250,000", 250000]], ["a", "b"], { section: "SECTION 2 - MEDICAL BENEFITS" }),
  { id: "P12", what: "wrapped row: name wraps, figure on 2nd line", docs: [{ id: D1, lives: L(["a", "b"]), text: cert(L(["a", "b"]), ["Benefit\tLimit per insured person", "Emergency medical evacuation and", "repatriation\tUSD 1,000,000", "Trip curtailment\tUSD 8,000"]),
    rows: [{ benefit: "Emergency medical evacuation and repatriation", value: 1000000, quote: "Emergency medical evacuation and\nrepatriation\tUSD 1,000,000", column: "Limit per insured person" },
      { benefit: "Trip curtailment", value: 8000, quote: "Trip curtailment\tUSD 8,000", column: "Limit per insured person" }] }],
    expect: { a: ["Emergency medical evacuation and repatriation", "Trip curtailment"], b: ["Emergency medical evacuation and repatriation", "Trip curtailment"] } },
  { id: "P13", what: "wrapped row: description continues on next line (no figure)", docs: [{ id: D1, lives: L(["a", "b"]), text: cert(L(["a", "b"]), ["Benefit\tLimit per insured person", "Travel delay\tSGD 1,000", "(for each full 6 hours of delay)", "Baggage delay\tSGD 500"]),
    rows: [{ benefit: "Travel delay", value: 1000, quote: "Travel delay\tSGD 1,000", column: "Limit per insured person" }, { benefit: "Baggage delay", value: 500, quote: "Baggage delay\tSGD 500", column: "Limit per insured person" }] }],
    expect: { a: ["Baggage delay"], b: ["Baggage delay"] }, safeOnly: ["Travel delay"] },
  simple("P14", "MYR hospital income per day 60 days, 3 lives", ["a", "b", "d"], "Limit per insured person", [["Hospital income", "RM 100 per day, maximum 60 days", 100, { pays: "per_day", maxDays: 60 }], ["Accidental death", "RM 50,000", 50000]], ["a", "b", "d"]),
  simple("P15", "single named life (pre-existing behaviour)", ["a"], "Limit per insured person", [["Medical expenses", "SGD 200,000", 200000]], ["a"]),
  simple("P16", "a named life outside the family (John Tan) + Asha", ["a", "x"], "Limit per insured person", [["Medical expenses", "SGD 200,000", 200000]], ["a"]),
  simple("P17", "medical plan per policy year, per insured person", ["a", "b"], "Annual limit per insured person", [["Inpatient", "S$1,000,000 per policy year", 1000000, { period: "per_year" }], ["Outpatient", "S$5,000 per policy year", 5000, { period: "per_year" }]], ["a", "b"], { product: "Shield Family Medical" }),
  // ---------------- negatives
  simple("N1", "age group section with 'years'", ["a", "c"], "Limit per insured person", [["Home nursing", "SGD 2,000", 2000]], [], { section: "INSURED PERSONS AGED 70 YEARS AND ABOVE" }),
  simple("N2", "age group section without 'years'", ["a", "c"], "Limit per insured person", [["Home nursing", "SGD 2,000", 2000]], [], { section: "INSURED PERSONS AGED 70 AND ABOVE" }),
  { ...simple("N3", "age group with no number: 'SENIOR CITIZENS' section", ["a", "c"], "Limit per insured person", [["Home nursing", "SGD 2,000", 2000]], [], { section: "BENEFITS FOR SENIOR CITIZENS" }), safeOnly: ["c"] },
  { ...simple("N4", "kind-of-life word in row: 'Child hospital cash'", ["a", "k"], "Limit per insured person", [["Child hospital cash", "SGD 50", 50]], [] ), safeOnly: ["k"] },
  { ...simple("N5", "kind-of-life word: \"Children's education fund\"", ["a", "b", "k"], "Limit per insured person", [["Children's education fund", "SGD 10,000", 10000]], []), safeOnly: ["k"] },
  { ...simple("N6", "kind-of-life word: 'Adult accidental death' with a child named", ["a", "k"], "Limit per insured person", [["Adult accidental death", "SGD 100,000", 100000]], []), safeOnly: ["a"] },
  simple("N7", "child rate on the row's line", ["a", "k"], "Limit per insured person", [["Hospital cash", "S$50 per day (S$25 per day for a child)", 50, { pays: "per_day" }]], []),
  simple("N8", "child rate on next line in words (no number)", ["a", "k"], "Limit per insured person", [["Hospital cash", "S$50 per day", 50, { pays: "per_day" }]], [], { post: ["Children: half of the above amount"] }),
  simple("N9", "footnote two lines below: children 50%", ["a", "k"], "Limit per insured person", [["Medical expenses", "S$200,000", 200000], ["Baggage", "S$3,000", 3000]], [], { post: ["", "Note: for insured children the limits are 50% of those shown."] }),
  simple("N10", "row per life naming each person", ["a", "b"], "Limit per insured person", [["Medical expenses - Asha", "USD 100,000", 100000], ["Medical expenses - Ben", "USD 50,000", 50000]], []),
  simple("N11", "row naming a person by first name, single row", ["a", "b"], "Limit per insured person", [["Asha's medical expenses", "USD 100,000", 100000]], []),
  simple("N12", "kind-of-life 'Infant care' with no infant named", ["a", "b", "k"], "Limit per insured person", [["Infant care benefit", "SGD 1,000", 1000]], []),
  { ...simple("N13", "household members not named (Kiran linked to doc by record, Chen/Devi not)", ["a", "b"], "Limit per insured person", [["Medical expenses", "SGD 300,000", 300000]], ["a", "b"]),
    family: BASE_FAMILY.map((m) => m.id === "k" ? { ...m, documents: [D1] } : m) },
  simple("N14", "second column 'Child limit'", ["a", "k"], "Limit per insured person", [["Medical expenses", "SGD 300,000\tSGD 150,000", 300000]], [], { pre: [] }),
  simple("N15", "age column 'Limit per insured person aged 18-69'", ["a", "c"], "Limit per insured person aged 18-69", [["Medical expenses", "SGD 300,000", 300000]], []),
  simple("N16", "scheme terms", ["a", "b"], "Limit per insured person", [["Medical expenses", "SGD 300,000", 300000]], [], { kind: "scheme_terms" }),
  simple("N17", "policy wording", ["a", "b"], "Limit per insured person", [["Medical expenses", "SGD 300,000", 300000]], [], { kind: "policy_wording" }),
  simple("N18", "age groups in row labels (no 'years')", ["a", "c"], "Limit per insured person", [["Personal accident (age below 70)", "SGD 100,000", 100000], ["Personal accident (age 70 and above)", "SGD 50,000", 50000]], []),
  simple("N19", "age groups in row labels (no number): Adult / Senior", ["a", "c"], "Limit per insured person", [["Personal accident - Adult", "SGD 100,000", 100000], ["Personal accident - Senior", "SGD 50,000", 50000]], []),
  { ...simple("N20", "kind-of-life section 'CHILD BENEFITS' (no number)", ["a", "k"], "Limit per insured person", [["Hospital cash", "SGD 80", 80]], [], { section: "CHILD BENEFITS" }), safeOnly: ["k"] },
  { id: "N21", what: "child rate extracted as its own row too", docs: [{ id: D1, lives: L(["a", "k"]), text: cert(L(["a", "k"]), ["Benefit\tLimit per insured person", "Hospital cash\tS$50 per day", "Hospital cash (child)\tS$25 per day"]),
    rows: [{ benefit: "Hospital cash", value: 50, pays: "per_day", quote: "Hospital cash\tS$50 per day", column: "Limit per insured person" }, { benefit: "Hospital cash (child)", value: 25, pays: "per_day", quote: "Hospital cash (child)\tS$25 per day", column: "Limit per insured person" }] }], expect: {} },
  { id: "N22", what: "two certificates, same product, different couples", docs: [
    { id: D1, lives: L(["a", "b"]), text: cert(L(["a", "b"]), ["Benefit\tLimit per insured person", "Medical expenses\tSGD 500,000"]), rows: [{ benefit: "Medical expenses", value: 500000, quote: "Medical expenses\tSGD 500,000", column: "Limit per insured person" }] },
    { id: D2, lives: L(["k", "c"]), text: cert(L(["k", "c"]), ["Benefit\tLimit per insured person", "Medical expenses\tSGD 200,000"]), rows: [{ benefit: "Medical expenses", value: 200000, quote: "Medical expenses\tSGD 200,000", column: "Limit per insured person" }] }],
    expect: { a: ["Medical expenses=500,000"], b: ["Medical expenses=500,000"], k: ["Medical expenses=200,000"], c: ["Medical expenses=200,000"] } },
  { id: "N23", what: "two certificates overlapping (Asha on both)", docs: [
    { id: D1, lives: L(["a", "b"]), text: cert(L(["a", "b"]), ["Benefit\tLimit per insured person", "Medical expenses\tSGD 500,000"]), rows: [{ benefit: "Medical expenses", value: 500000, quote: "Medical expenses\tSGD 500,000", column: "Limit per insured person" }] },
    { id: D2, lives: L(["a", "k"]), text: cert(L(["a", "k"]), ["Benefit\tLimit per insured person", "Medical expenses\tSGD 200,000"]), rows: [{ benefit: "Medical expenses", value: 200000, quote: "Medical expenses\tSGD 200,000", column: "Limit per insured person" }] }],
    expect: { b: ["Medical expenses=500,000"], k: ["Medical expenses=200,000"] }, safeOnly: ["a"] },
  { id: "N24", what: "two certificates, different products, disjoint families", docs: [
    { id: D1, product: "Globe Travel Annual", lives: L(["a", "b"]), text: cert(L(["a", "b"]), ["Benefit\tLimit per insured person", "Medical expenses\tGBP 5,000,000"]), rows: [{ benefit: "Medical expenses", value: 5000000, quote: "Medical expenses\tGBP 5,000,000", column: "Limit per insured person" }] },
    { id: D2, product: "Sun Travel Single Trip", lives: L(["c", "d"]), text: cert(L(["c", "d"]), ["Benefit\tLimit per insured person", "Medical expenses\tGBP 2,000,000"], "SUN TRAVEL SINGLE TRIP - CERTIFICATE"), rows: [{ benefit: "Medical expenses", value: 2000000, quote: "Medical expenses\tGBP 2,000,000", column: "Limit per insured person" }] }],
    expect: { a: ["Medical expenses=GBP 5,000,000"], b: ["Medical expenses=GBP 5,000,000"], c: ["Medical expenses=GBP 2,000,000"], d: ["Medical expenses=GBP 2,000,000"] } },
  simple("N25", "row naming a person by role 'Spouse'", ["a", "b"], "Limit per insured person", [["Medical expenses (spouse)", "USD 50,000", 50000], ["Medical expenses (policyholder)", "USD 100,000", 100000]], []),
  simple("N26", "row naming a 2-letter-name member (Jo)", ["j", "b"], "Limit per insured person", [["Medical expenses - Jo", "USD 50,000", 50000]], ["j"]),
  simple("P18", "realistic travel certificate, rows sharing words", ["a", "b"], "Limit per insured person", [["Medical expenses", "S$500,000", 500000], ["Emergency medical evacuation", "S$1,000,000", 1000000], ["Trip cancellation", "S$10,000", 10000], ["Trip curtailment", "S$10,000", 10000], ["Travel delay", "S$1,000", 1000], ["Baggage delay", "S$500", 500], ["Personal accident", "S$200,000", 200000], ["Personal liability", "S$1,000,000", 1000000]], ["a", "b"]),
  simple("P19", "label with a number (24-hour assistance)", ["a", "b"], "Limit per insured person", [["24-hour emergency assistance", "S$50,000", 50000]], ["a", "b"]),
  simple("N27", "column not per person ('Sum insured')", ["a", "b"], "Sum insured", [["Medical expenses", "USD 50,000", 50000]], []),
  simple("N28", "per insured child column", ["a", "k"], "Limit per insured child", [["Medical expenses", "USD 50,000", 50000]], []),
];

