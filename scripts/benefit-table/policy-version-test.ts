/** A personal document's own sections are paid under its own version of the policy (TE-ACC-20261113, Okafor): a renewal
 * schedule's benefits were linked to the expired schedule's cover of the same policy number, which the two readings named a
 * little differently, so percentages were worked out on last year's sums insured (fracture GBP 1,200 for 1,500). The rule is
 * general: for any insurer, currency, wording and order of upload, a section of a personal document (schedule,
 * certificate) linked to a cover that only another personal document of the same policy number prints is placed on its
 * own document's cover of that policy. Policy numbers only say which documents are copies of one policy: nothing is merged
 * or added. Made-up households in GBP, S$, RM and a bare "$"; no model, database or network.
 *   npm run benefit-table:policy-version-test */
import assert from "node:assert/strict";
import { ANOTHER_VERSION_WHY, assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type CheckedReading, type SourceDoc } from "@/lib/benefit-table/check";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}

type Cov = { product: string; cover: string; plan?: string | null; policyNumber: string | null; person: string; sum: number; quote: string };
type Row = { section: string; benefit: string; percent?: number; value?: number; quote: string };
function read(id: string, kind: string, product: string, pages: string[], covers: Cov[], rows: Row[]): CheckedReading {
  const doc: SourceDoc = { id, name: `${id.slice(-2)}.pdf`, readable: true, pages: pages.map((text, i) => ({ page: i + 1, text })) };
  const r = checkReading(doc, { document: { kind, product, insurer: null, namedPeople: covers.map((c) => c.person), plan: null, periodFrom: null, periodTo: null },
    covers: covers.map((c) => ({ person: c.person, product: c.product, cover: c.cover, plan: c.plan ?? null, riderOf: null, policyNumber: c.policyNumber, premium: null, premiumFrequency: null,
      asOf: null, startDate: null, endDate: null, page: 1, sumInsured: c.sum, quote: c.quote })),
    benefits: rows.map((b) => ({ section: b.section, column: null, benefit: b.benefit, pays: b.percent != null ? "percent" : "amount", value: b.percent ?? b.value ?? null, period: null, basis: null,
      asOf: null, percentOf: b.percent != null ? "sum_insured" : null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: b.quote })) } as never);
  assert.equal(r.covers.length, covers.length, `${id}: covers check`);
  assert.equal(r.benefits.length, rows.length, `${id}: rows check`);
  return r;
}
const id = (n: number) => `eeeeeeee-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const linkTo = (r: CheckedReading, cover: string) => [...new Set(r.benefits.map((b) => sectionKeyOf(r.documentId, b)))].map((section) => ({ section, cover, why: "model" }));
/** Each row's figure for a person: the amount worked out or printed, and the cover it is under. */
const rows = (t: ReturnType<typeof assembleTable>, person: string) => t.people.find((p) => p.id === person)!.rows
  .map((x) => `${x.benefit} ${x.figure.kind === "printed" ? x.figure.amount : x.figure.kind}${x.base != null ? ` of ${x.base}` : ""} @${x.coverKey}`).sort();

/** Two schedules of one policy, last year's and this year's, whose readings name the cover differently. */
function versions(o: { sign: string; number: string; numberNew?: string; product: string; oldName: string; newName: string; oldSum: number; newSum: number; person: string }) {
  const oldR = read(id(1), "personal_proof", o.product, [`${o.product} - SCHEDULE\nPolicy number ${o.number}\nPeriod 1 March 2025 to 28 February 2026\n${o.person}\t${o.sign}${o.oldSum.toLocaleString("en-US")}\nAccidental death\t100% of sum insured\nFracture\t2% of sum insured`],
    [{ product: o.product, cover: o.oldName, policyNumber: o.number, person: o.person, sum: o.oldSum, quote: `${o.person}\t${o.sign}${o.oldSum.toLocaleString("en-US")}` }],
    [{ section: "Benefits", benefit: "Accidental death", percent: 100, quote: "Accidental death\t100% of sum insured" }, { section: "Benefits", benefit: "Fracture", percent: 2, quote: "Fracture\t2% of sum insured" }]);
  const newR = read(id(2), "personal_proof", o.product, [`${o.product} - RENEWAL SCHEDULE\nPolicy number ${o.numberNew ?? o.number}\nThis schedule replaces the schedule dated 18 February 2025\n${o.person}\t${o.sign}${o.newSum.toLocaleString("en-US")}\nSection 1 Accidental death\t100% of sum insured\nSection 2 Fracture\t2% of sum insured`],
    [{ product: o.product, cover: o.newName, policyNumber: o.numberNew ?? o.number, person: o.person, sum: o.newSum, quote: `${o.person}\t${o.sign}${o.newSum.toLocaleString("en-US")}` }],
    [{ section: "Section 1", benefit: "Accidental death", percent: 100, quote: "Section 1 Accidental death\t100% of sum insured" }, { section: "Section 2", benefit: "Fracture", percent: 2, quote: "Section 2 Fracture\t2% of sum insured" }]);
  return { oldR, newR, oldKey: coverKeyOf({ product: o.product, cover: o.oldName, plan: null }), newKey: coverKeyOf({ product: o.product, cover: o.newName, plan: null }) };
}
const fam = (...names: string[]): FamilyMember[] => names.map((n, i) => ({ id: `p${i + 1}`, display_name: n }));

const CASES = [
  { label: "GBP, renewal linked to last year's cover", sign: "GBP ", number: "HPA-55120-K", product: "Family Personal Accident Policy", oldName: "Family Personal Accident Policy", newName: "Family Personal Accident", oldSum: 75000, newSum: 100000, person: "Ngozi Okafor" },
  { label: "S$, policy number printed with a suffix on one copy", sign: "S$", number: "0012345", numberNew: "12345-01", product: "SafeHarbour Accident Shield", oldName: "Accident Shield", newName: "SafeHarbour Accident Shield Plan", oldSum: 50000, newSum: 80000, person: "Tan Mei Ling" },
  { label: "RM, an older schedule linked to the newer one's cover", sign: "RM ", number: "MY/88/2210", product: "Pelindung Kemalangan", oldName: "Pelindung Kemalangan Plus", newName: "Pelindung Kemalangan", oldSum: 120000, newSum: 90000, person: "Aisyah Rahman" },
  { label: "bare $, currency unknown", sign: "$", number: "QX7781", product: "Everyday Accident Cover", oldName: "Everyday Accident", newName: "Everyday Accident Cover", oldSum: 20000, newSum: 25000, person: "Sam Lee" },
];
for (const c of CASES) {
  test(`${c.label}: each schedule's own sections are worked out on its own sums insured`, () => {
    const { oldR, newR, oldKey, newKey } = versions(c);
    // The model linked every section of both schedules to the one cover (once to the old, once to the new): either way.
    for (const wrong of [oldKey, newKey]) {
      const t = assembleTable([oldR, newR], fam(c.person), [...linkTo(oldR, wrong), ...linkTo(newR, wrong)]);
      const got = rows(t, "p1");
      assert.ok(got.includes(`Fracture percent of ${c.newSum} @${newKey}`) || got.some((x) => x.startsWith("Fracture") && x.includes(`of ${c.newSum}`) && x.endsWith(`@${newKey}`)), `${wrong}: ${JSON.stringify(got)}`);
      assert.ok(got.some((x) => x.startsWith("Fracture") && x.includes(`of ${c.oldSum}`) && x.endsWith(`@${oldKey}`)), `${wrong}: ${JSON.stringify(got)}`);
      assert.ok(!got.some((x) => x.includes(`of ${c.oldSum}`) && x.endsWith(`@${newKey}`)), `old base never on the new cover: ${JSON.stringify(got)}`);
      assert.ok(!got.some((x) => x.includes(`of ${c.newSum}`) && x.endsWith(`@${oldKey}`)), `new base never on the old cover: ${JSON.stringify(got)}`);
    }
  });
}

test("control: a policy wording (not a personal document) linked to a schedule's cover stays linked", () => {
  const { newR, newKey } = versions(CASES[0]);
  const wording = read(id(3), "policy_wording", "Family Personal Accident Policy", ["POLICY WORDING\nPolicy number HPA-55120-K\nHospital cash\tGBP 50 per day"],
    [{ product: "Family Personal Accident Policy", cover: "Wording cover", policyNumber: "HPA-55120-K", person: "Ngozi Okafor", sum: 1, quote: "Policy number HPA-55120-K" }].slice(0, 0),
    [{ section: "Hospital", benefit: "Hospital cash", value: 50, quote: "Hospital cash\tGBP 50 per day" }]);
  const t = assembleTable([newR, wording], fam("Ngozi Okafor"), [...linkTo(newR, newKey), ...linkTo(wording, newKey)]);
  assert.ok(rows(t, "p1").some((x) => x.startsWith("Hospital cash") && x.endsWith(`@${newKey}`)), JSON.stringify(rows(t, "p1")));
  assert.deepEqual(t.refusedLinks, []);
});
test("control: two policies with different numbers keep the link the model gave (a rider schedule on its base policy)", () => {
  const base = read(id(4), "personal_proof", "Harbour Life", ["Harbour Life schedule\nPolicy number HL-100\nJane Doe\tS$500,000"],
    [{ product: "Harbour Life", cover: "Harbour Life", policyNumber: "HL-100", person: "Jane Doe", sum: 500000, quote: "Jane Doe\tS$500,000" }], []);
  const rider = read(id(5), "personal_proof", "Harbour Life", ["Rider schedule\nPolicy number HL-200\nJane Doe\tS$100,000\nEarly CI\t25% of sum insured"],
    [{ product: "Harbour Life", cover: "Early CI Rider", policyNumber: "HL-200", person: "Jane Doe", sum: 100000, quote: "Jane Doe\tS$100,000" }],
    [{ section: "Rider", benefit: "Early CI", percent: 25, quote: "Early CI\t25% of sum insured" }]);
  const baseKey = coverKeyOf({ product: "Harbour Life", cover: "Harbour Life", plan: null });
  const t = assembleTable([base, rider], fam("Jane Doe"), linkTo(rider, baseKey));
  assert.ok(rows(t, "p1").some((x) => x.startsWith("Early CI") && x.endsWith(`@${baseKey}`)), JSON.stringify(rows(t, "p1")));
});
test("control: a schedule linked to its own cover is unchanged", () => {
  const { oldR, newR, oldKey, newKey } = versions(CASES[0]);
  const t = assembleTable([oldR, newR], fam("Ngozi Okafor"), [...linkTo(oldR, oldKey), ...linkTo(newR, newKey)]);
  assert.deepEqual(t.refusedLinks, []);
  assert.ok(rows(t, "p1").some((x) => x.startsWith("Fracture") && x.includes("of 100000") && x.endsWith(`@${newKey}`)));
});
test("a schedule printing two covers of the same policy number, linked to another copy's cover: refused, never guessed", () => {
  const { oldR, oldKey } = versions(CASES[0]);
  const two = read(id(6), "personal_proof", "Family Personal Accident Policy", ["RENEWAL\nPolicy number HPA-55120-K\nNgozi Okafor\tGBP 100,000\nDaniel Okafor\tGBP 80,000\nFracture\t2% of sum insured"],
    [{ product: "Family Personal Accident Policy", cover: "Adult accident", policyNumber: "HPA-55120-K", person: "Ngozi Okafor", sum: 100000, quote: "Ngozi Okafor\tGBP 100,000" },
      { product: "Family Personal Accident Policy", cover: "Spouse accident", policyNumber: "HPA-55120-K", person: "Daniel Okafor", sum: 80000, quote: "Daniel Okafor\tGBP 80,000" }],
    [{ section: "Benefits", benefit: "Fracture", percent: 2, quote: "Fracture\t2% of sum insured" }]);
  const t = assembleTable([oldR, two], fam("Ngozi Okafor", "Daniel Okafor"), linkTo(two, oldKey));
  assert.deepEqual(t.refusedLinks.map((x) => x.why), [ANOTHER_VERSION_WHY]);
  assert.ok(!rows(t, "p1").some((x) => x.includes("of 75000") && x.startsWith("Fracture") && !x.endsWith(`@${oldKey}`)));
});

test("control: a certificate of the same policy that prints no sum insured keeps its link to the schedule that does", () => {
  const { newR, newKey } = versions(CASES[0]);
  const cert = read(id(7), "personal_proof", "Family Personal Accident Policy", ["CERTIFICATE OF INSURANCE\nPolicy number HPA-55120-K\nInsured: Ngozi Okafor\nFracture\t2% of sum insured"],
    [{ product: "Family Personal Accident Policy", cover: "Certificate cover", policyNumber: "HPA-55120-K", person: "Ngozi Okafor", sum: null as unknown as number, quote: "Insured: Ngozi Okafor" }],
    [{ section: "Cert", benefit: "Fracture", percent: 2, quote: "Fracture\t2% of sum insured" }]);
  const t = assembleTable([newR, cert], fam("Ngozi Okafor"), [...linkTo(newR, newKey), ...linkTo(cert, newKey)]);
  assert.deepEqual(t.refusedLinks, []);
  assert.ok(rows(t, "p1").filter((x) => x.startsWith("Fracture") && x.includes("of 100000") && x.endsWith(`@${newKey}`)).length >= 1, JSON.stringify(rows(t, "p1")));
});

console.log(`policy versions: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
export {};
