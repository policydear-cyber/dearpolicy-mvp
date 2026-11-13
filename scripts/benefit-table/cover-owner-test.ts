/**
 * Two general rules (wrong-person defect found while testing #449, 13 Nov):
 *  A. A row printed on a personal document (kind personal_proof) is shown only for the people that document is about:
 *     whose cover was read from it, whom it names, or whom the household linked to it; never one taken off it.
 *  B. A cover whose quote does not print the reading's sum keeps the sum from the page's one sum insured line when the
 *     page is about that life only and the reading gives that person no other cover there; else the cover is kept without
 *     the sum. An unproved sum never drops the cover.
 * Made-up people, insurers and currencies; no database.
 */
import assert from "node:assert/strict";
import { NOT_THEIR_DOCUMENT_WHY, OTHER_PERSONS_DOCUMENT_WHY, assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import type { SectionLink } from "@/lib/benefit-table/reading";
import { checkReading, type CheckedReading, type SourceDoc } from "@/lib/benefit-table/check";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };

type Cover = { person: string; cover?: string; sum: number | null; quote: string; page?: number; premium?: number };
type Row = { benefit: string; quote: string; pays?: string; value?: number | null; percentOf?: string | null; section?: string; column?: string | null };
const PRODUCT = "Personal Accident Certificate";
const read = (id: string, text: string | string[], covers: Cover[], rows: Row[], kind = "personal_proof", namedPeople: string[] = covers.map((c) => c.person), people?: string[]): CheckedReading => {
  const pages = (Array.isArray(text) ? text : [text]).map((t, i) => ({ page: i + 1, text: t }));
  const src: SourceDoc = { id, name: `${id.slice(0, 4)}.pdf`, readable: true, pages, ...(people ? { people } : {}) } as SourceDoc;
  return checkReading(src, {
    document: { kind, product: PRODUCT, insurer: "Example Insurer", namedPeople, plan: null, periodFrom: null, periodTo: null },
    covers: covers.map((c) => ({ person: c.person, product: PRODUCT, cover: c.cover ?? "Personal Accident", plan: null, riderOf: null, policyNumber: null, premium: c.premium ?? null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: c.page ?? 1, sumInsured: c.sum, quote: c.quote })),
    benefits: rows.map((b) => ({ section: b.section ?? "BENEFITS", benefit: b.benefit, column: b.column ?? null, pays: b.pays ?? "percent", value: b.value === undefined ? 1 : b.value, percentOf: b.percentOf === undefined ? "sum_insured" : b.percentOf, quote: b.quote, page: 1, conditions: [] })),
  });
};
const KEY = coverKeyOf({ product: PRODUCT, cover: "Personal Accident", plan: null, riderOf: null });
const linkAll = (rs: CheckedReading[], cover = KEY): SectionLink[] => {
  const seen = new Set<string>();
  return rs.flatMap((r) => r.benefits.map((b) => sectionKeyOf(r.documentId, b))).filter((k) => !seen.has(k) && seen.add(k)).map((section) => ({ section, cover, why: "test" }) as SectionLink);
};
const rowsOf = (t: ReturnType<typeof assembleTable>, id: string) => t.people.find((p) => p.id === id)!.rows;
const fromDoc = (t: ReturnType<typeof assembleTable>, id: string, doc: string) => rowsOf(t, id).filter((r) => r.source.documentId === doc);

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", W = "33333333-3333-4333-8333-333333333333";
const cert = (person: string, sumLine: string, extra = "") => `PERSONAL ACCIDENT CERTIFICATE\nInsured person: ${person}\n${sumLine}\n${extra}Dislocation\t1% of the Sum Insured\nHospital cash\t400 a day`;
const rowsPA: Row[] = [{ benefit: "Dislocation", quote: "Dislocation\t1% of the Sum Insured" }, { benefit: "Hospital cash", quote: "Hospital cash\t400 a day", pays: "per_day", value: 400, percentOf: null }];
const fam = (extra: Partial<Record<"p1" | "p2", Partial<FamilyMember>>> = {}): FamilyMember[] => [
  { id: "p1", display_name: "Chen Wei Ling", documents: [A], ...extra.p1 }, { id: "p2", display_name: "Ho Ka Yan", documents: [B], ...extra.p2 }];

// ---- Rule A: a personal document's rows go only to the people it is about ----
for (const [label, line] of [["AUD", "Sum Insured\tAUD 250,000"], ["GBP", "Sum Insured: £250,000"], ["RM", "Amount Insured\tRM 250,000"], ["bare $", "Sum Insured\t$250,000"]] as const) {
  test(`A1 (${label}): a certificate whose own cover was not read gives its rows to no other member`, () => {
    const a = read(A, cert("Chen Wei Ling", line), [{ person: "Chen Wei Ling", sum: 250000, quote: line }], rowsPA);
    // The second certificate's cover quote is not on its page at all: the cover is dropped by checkReading.
    const b = read(B, cert("Ho Ka Yan", "Sum Insured\tHK$800,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "Principal Sum\tHK$800,000" }], rowsPA);
    assert.equal(b.covers.length, 0);
    const t = assembleTable([a, b], fam(), linkAll([a, b]));
    assert.equal(fromDoc(t, "p1", B).length, 0, "no row from Ho Ka Yan's certificate for Chen Wei Ling");
    assert.equal(fromDoc(t, "p1", A).length, 2, "Chen Wei Ling keeps her own rows");
    assert.ok(t.unlinkedSections.some((u) => u.why === NOT_THEIR_DOCUMENT_WHY), "the section says why it is not shown");
  });
}
test("A2: same, with the second person not linked to the certificate by record (named only)", () => {
  const a = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000"), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], rowsPA);
  const b = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 800,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "not on the page" }], rowsPA);
  const t = assembleTable([a, b], fam({ p2: { documents: [] } }), linkAll([a, b]));
  assert.equal(fromDoc(t, "p1", B).length, 0);
});
test("A3: a certificate naming someone outside the family gives its rows to no member", () => {
  const a = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000"), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], rowsPA);
  const b = read(B, cert("Okafor Ngozi", "Sum Insured\tUSD 90,000"), [{ person: "Okafor Ngozi", sum: 90000, quote: "nowhere" }], rowsPA);
  const t = assembleTable([a, b], fam({ p2: { documents: [] } }), linkAll([a, b]));
  assert.equal(fromDoc(t, "p1", B).length, 0);
  assert.equal(fromDoc(t, "p2", B).length, 0);
});
test("A4: the household took Chen Wei Ling off the second certificate: still none for her", () => {
  const a = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000"), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], rowsPA);
  const b = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 800,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "nowhere" }], rowsPA);
  const t = assembleTable([a, b], fam({ p1: { documents: [A, B], excludedFrom: [B] } }), linkAll([a, b]));
  assert.equal(fromDoc(t, "p1", B).length, 0);
});
test("A5 control: a policy wording's rows still go to every holder, each on their own sum", () => {
  const a = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000", ""), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], []);
  const b = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 800,000", ""), [{ person: "Ho Ka Yan", sum: 800000, quote: "Sum Insured\tHKD 800,000" }], []);
  const w = read(W, "POLICY WORDING\nDislocation\t1% of the Sum Insured", [], [{ benefit: "Dislocation", quote: "Dislocation\t1% of the Sum Insured" }], "policy_wording", []);
  const t = assembleTable([a, b, w], fam(), linkAll([w]));
  const f1 = fromDoc(t, "p1", W)[0]?.figure as { amount?: number; currency?: string }, f2 = fromDoc(t, "p2", W)[0]?.figure as { amount?: number; currency?: string };
  assert.equal(f1?.amount, 2500); assert.equal(f1?.currency, "AUD");
  assert.equal(f2?.amount, 8000); assert.equal(f2?.currency, "HKD");
});
test("A6 control: a joint certificate naming both, both covers read, shows its rows for both", () => {
  const text = "PERSONAL ACCIDENT CERTIFICATE\nInsured person: Chen Wei Ling\tSum Insured\tAUD 250,000\nInsured person: Ho Ka Yan\tSum Insured\tAUD 100,000\nDislocation\t1% of the Sum Insured";
  const j = read(A, text, [{ person: "Chen Wei Ling", sum: 250000, quote: "Insured person: Chen Wei Ling\tSum Insured\tAUD 250,000" }, { person: "Ho Ka Yan", sum: 100000, quote: "Insured person: Ho Ka Yan\tSum Insured\tAUD 100,000" }], [rowsPA[0]]);
  const t = assembleTable([j], fam({ p2: { documents: [A] } }), linkAll([j]));
  assert.equal((fromDoc(t, "p1", A)[0]?.figure as { amount?: number }).amount, 2500);
  assert.equal((fromDoc(t, "p2", A)[0]?.figure as { amount?: number }).amount, 1000);
});
test("A7 control: the same person's older certificate, whose cover was not read, still shows for them", () => {
  const old = read(B, cert("Chen Wei Ling", "Sum Insured\tAUD 200,000"), [{ person: "Chen Wei Ling", sum: 200000, quote: "nowhere" }], rowsPA);
  const now = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000"), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], rowsPA);
  const t = assembleTable([now, old], fam({ p1: { documents: [A, B] }, p2: { documents: [] } }), linkAll([now, old]));
  assert.equal(fromDoc(t, "p1", B).length, 2);
  assert.ok(!t.unlinkedSections.some((u) => u.why === NOT_THEIR_DOCUMENT_WHY));
});
test("A8 control: a personal document read normally still shows its rows for its own person", () => {
  const a = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000"), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], rowsPA);
  const t = assembleTable([a], fam(), linkAll([a]));
  assert.equal(fromDoc(t, "p1", A).length, 2);
  assert.equal(rowsOf(t, "p2").length, 0);
});

// ---- Rule B: an unproved sum never drops the cover ----
const sumOf = (r: CheckedReading) => r.covers.map((c) => [c.person, c.sumInsured, c.currency]);
for (const [label, line, sum, cur] of [["HKD", "Sum Insured\tHK$800,000", 800000, "HKD"], ["GBP colon", "Sum Insured: £150,000", 150000, "GBP"], ["RM bracket label", "Sum Assured (RM)\t75,000", 75000, "MYR"], ["face amount USD", "Face Amount\tUSD 40,000", 40000, "USD"]] as const) {
  test(`B1 (${label}): the sum is taken from the page's one sum insured line when the quote is the name line`, () => {
    const r = read(B, cert("Ho Ka Yan", line), [{ person: "Ho Ka Yan", sum, quote: "Insured person: Ho Ka Yan" }], []);
    assert.equal(r.covers.length, 1);
    assert.equal(r.covers[0].sumInsured, sum);
    assert.ok(r.covers[0].source.excerpt.includes(String(sum).slice(0, 2)), "the cover's evidence is the sum line");
    if (cur !== "MYR") assert.equal(r.covers[0].currency, cur);
  });
}
test("B2: two sum insured lines on the page: the cover is kept without a sum", () => {
  const r = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 800,000\nSum Insured (Accidental Death)\tHKD 400,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "Insured person: Ho Ka Yan" }], []);
  assert.deepEqual(sumOf(r), [["Ho Ka Yan", null, null]]);
  assert.ok(r.dropped.some((d) => /kept the cover without it/.test(d.why)));
});
test("B3: the page names another insured life: kept without a sum", () => {
  const r = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 800,000", "Spouse: Lee Mei Fong\n"), [{ person: "Ho Ka Yan", sum: 800000, quote: "Insured person: Ho Ka Yan" }], []);
  assert.deepEqual(sumOf(r), [["Ho Ka Yan", null, null]]);
});
test("B4: the reading gives the person two covers on that page: kept without a sum", () => {
  const r = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 800,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "Insured person: Ho Ka Yan" }, { person: "Ho Ka Yan", cover: "Medical Expenses", sum: null, quote: "Insured person: Ho Ka Yan" }], []);
  assert.equal(r.covers.find((c) => c.cover === "Personal Accident")?.sumInsured, null);
});
test("B5: the page's sum line prints a different figure: kept without a sum", () => {
  const r = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 500,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "Insured person: Ho Ka Yan" }], []);
  assert.deepEqual(sumOf(r), [["Ho Ka Yan", null, null]]);
});
test("B6: a line that only mentions the sum insured in words is not a sum insured line", () => {
  const r = read(B, cert("Ho Ka Yan", "Premium\tHKD 800,000", "The sum insured is reduced by 800,000 claims paid\n"), [{ person: "Ho Ka Yan", sum: 800000, quote: "Insured person: Ho Ka Yan" }], []);
  assert.deepEqual(sumOf(r), [["Ho Ka Yan", null, null]]);
});
test("B7 control: a sum the quote prints is read as before", () => {
  const r = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 800,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "Sum Insured\tHKD 800,000" }], []);
  assert.deepEqual(sumOf(r), [["Ho Ka Yan", 800000, "HKD"]]);
  assert.equal(r.dropped.length, 0);
});
test("B8 control: a quote not on the page still drops the cover", () => {
  const r = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 800,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "Principal Sum\tHKD 800,000" }], []);
  assert.equal(r.covers.length, 0);
});
test("B9: end to end, the recovered cover's rows are its own person's, on their own sum", () => {
  const a = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000"), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], rowsPA);
  const b = read(B, cert("Ho Ka Yan", "Sum Insured\tHK$800,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "Insured person: Ho Ka Yan" }], rowsPA);
  const t = assembleTable([a, b], fam(), linkAll([a, b]));
  assert.equal(fromDoc(t, "p1", B).length, 0);
  const own = fromDoc(t, "p2", B).find((r) => r.benefit === "Dislocation")!.figure as { amount?: number; currency?: string };
  assert.equal(own.amount, 8000); assert.equal(own.currency, "HKD");
});

// ---- Critic #454 round 1 ----
test("H1: a total sum insured line is never taken for one cover, nor is a sum the quote contradicts", () => {
  const page = "POLICY SCHEDULE\nLife Assured: Tan Mei Hua\nTotal Sum Insured: S$300,000\nBasic Plan\tS$200,000\nAccident Rider\tS$100,000";
  const r = read(B, page, [{ person: "Tan Mei Hua", cover: "Basic Plan", sum: 300000, quote: "Basic Plan\tS$200,000" }], []);
  assert.equal(r.covers[0]?.sumInsured ?? null, null);
  const r2 = read(B, "POLICY SCHEDULE\nLife Assured: Tan Mei Hua\nTotal Sum Insured: S$300,000", [{ person: "Tan Mei Hua", cover: "Basic Plan", sum: 300000, quote: "Life Assured: Tan Mei Hua" }], []);
  assert.equal(r2.covers[0]?.sumInsured ?? null, null);
});
test("H2: a sum insured line printing a figure for each column gives no sum", () => {
  const page = "POLICY SCHEDULE\nLife Assured: Tan Mei Hua\n\tBasic\tCritical Illness Rider\nSum Insured\tS$100,000\tS$50,000";
  const r = read(B, page, [{ person: "Tan Mei Hua", cover: "Critical Illness Rider", sum: 100000, quote: "Life Assured: Tan Mei Hua" }], []);
  assert.equal(r.covers[0]?.sumInsured ?? null, null);
});
test("L1: a premium the quote printed is kept when the sum comes from the sum line", () => {
  const page = "CERTIFICATE\nInsured person: Ho Ka Yan\nPersonal Accident\tAnnual premium S$120.00\nSum Insured: S$100,000";
  const r = read(B, page, [{ person: "Ho Ka Yan", sum: 100000, premium: 120, quote: "Personal Accident\tAnnual premium S$120.00" }], []);
  assert.equal(r.covers[0].sumInsured, 100000);
  assert.equal(r.covers[0].premium, 120);
});
test("M1: another member's certificate's row is not shown for a holder whose own documents print no such row, with the reason recorded", () => {
  const a = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000"), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], [rowsPA[0]]);
  const b = read(B, "PERSONAL ACCIDENT CERTIFICATE\nInsured person: Ho Ka Yan\nSum Insured\tAUD 50,000", [{ person: "Ho Ka Yan", sum: 50000, quote: "Sum Insured\tAUD 50,000" }], []);
  const t = assembleTable([a, b], fam(), linkAll([a, b]));
  assert.equal(fromDoc(t, "p2", A).length, 0);
  assert.equal(fromDoc(t, "p1", A).length, 1);
  assert.ok((t.notForPerson ?? []).some((n) => n.personId === "p2" && n.why === OTHER_PERSONS_DOCUMENT_WHY));
  assert.ok(!t.unlinkedSections.some((u) => u.why === NOT_THEIR_DOCUMENT_WHY), "shown for its own person, so not listed as shown for no one");
});
test("M2: a copy that proves no sum beside the person's proved copy is one cover, its rows shown once", () => {
  const a = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 100,000"), [{ person: "Chen Wei Ling", sum: 100000, quote: "Sum Insured\tAUD 100,000" }], [rowsPA[0]]);
  const pack = read(B, "WELCOME PACK\nInsured person: Chen Wei Ling\nSum Insured\tAUD 100,000\nSum Insured (Accidental Death)\tAUD 50,000", [{ person: "Chen Wei Ling", sum: 100000, quote: "Insured person: Chen Wei Ling" }], []);
  assert.equal(pack.covers[0].sumInsured, null);
  const t = assembleTable([a, pack], fam({ p1: { documents: [A, B] } }), linkAll([a]));
  assert.equal(t.people[0].covers.length, 1);
  const rows = rowsOf(t, "p1").filter((r) => r.benefit === "Dislocation");
  assert.equal(rows.length, 1);
  assert.equal((rows[0].figure as { amount?: number }).amount, 1000);
});
test("M3a: a policyholder printed on a child's certificate never gets the child's lost cover's rows", () => {
  const kid = read(B, "PERSONAL ACCIDENT CERTIFICATE\nPolicyholder: Chen Wei Ling\nInsured person: Ho Ka Yan\nSum Insured\tAUD 80,000\nDislocation\t1% of the Sum Insured", [{ person: "Ho Ka Yan", sum: 80000, quote: "nowhere" }], [rowsPA[0]], "personal_proof", ["Chen Wei Ling", "Ho Ka Yan"]);
  const own = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000"), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], []);
  const t = assembleTable([own, kid], fam({ p2: { documents: [] } }), linkAll([kid]));
  assert.equal(fromDoc(t, "p1", B).length, 0);
});
test("M3b: the same protection when the certificate was read as another kind of document", () => {
  const a = read(A, cert("Chen Wei Ling", "Sum Insured\tAUD 250,000"), [{ person: "Chen Wei Ling", sum: 250000, quote: "Sum Insured\tAUD 250,000" }], []);
  const b = read(B, cert("Ho Ka Yan", "Sum Insured\tHKD 800,000"), [{ person: "Ho Ka Yan", sum: 800000, quote: "nowhere" }], rowsPA, "other");
  const t = assembleTable([a, b], fam(), linkAll([b]));
  assert.equal(fromDoc(t, "p1", B).length, 0);
});
test("R1: a renewal's two certificates are each worked out on their own year's sum, once", () => {
  const pg = (sum: string) => `CERTIFICATE\nInsured Person: Chen Wei Ling\nSum Insured: ${sum}\nBroken bones: 2% of the Sum Insured`;
  const row = [{ benefit: "Broken bones", quote: "Broken bones: 2% of the Sum Insured", value: 2 }];
  const old = read(B, pg("£150,000"), [{ person: "Chen Wei Ling", sum: 150000, quote: "Insured Person: Chen Wei Ling" }], row);
  const now = read(A, pg("£200,000"), [{ person: "Chen Wei Ling", sum: 200000, quote: "Sum Insured: £200,000" }], row);
  const t = assembleTable([old, now], fam({ p1: { documents: [A, B] } }), linkAll([old, now]));
  assert.deepEqual(fromDoc(t, "p1", B).map((r) => (r.figure as { amount?: number }).amount), [3000]);
  assert.deepEqual(fromDoc(t, "p1", A).map((r) => (r.figure as { amount?: number }).amount), [4000]);
});
test("R2: an attachment of the person's pack that names no one is still shared to the cover's holders", () => {
  const own = read(A, cert("Chen Wei Ling", "Sum Insured\tNZ$100,000"), [{ person: "Chen Wei Ling", sum: 100000, quote: "Sum Insured\tNZ$100,000" }], []);
  const att = read(B, "SCHEDULE OF BENEFITS\nFracture\t6% of the Sum Insured", [], [{ benefit: "Fracture", quote: "Fracture\t6% of the Sum Insured", value: 6 }]);
  const t = assembleTable([own, att], fam({ p2: { documents: [] } }), linkAll([att]));
  assert.equal((fromDoc(t, "p1", B)[0]?.figure as { amount?: number }).amount, 6000);
});

console.log(`\n${passed} passed`);
