/** A personal document's own sections are paid under its own version of the policy (TE-ACC-20261113, Okafor): a renewal
 * schedule's benefits were linked to the expired schedule's cover of the same policy number, which the two readings named a
 * little differently, so percentages were worked out on last year's sums insured (fracture GBP 1,200 for 1,500). The rule is
 * general: for any insurer, currency, wording and order of upload, a section of a personal document (schedule,
 * certificate) linked to a cover that only another personal document of the same policy number prints is placed on its
 * own document's cover of that policy. Policy numbers only say which documents are copies of one policy: nothing is merged
 * or added. Made-up households in GBP, S$, RM and a bare "$"; no model, database or network.
 *   npm run benefit-table:policy-version-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type CheckedReading, type SourceDoc } from "@/lib/benefit-table/check";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}

type Cov = { product: string; cover: string; plan?: string | null; riderOf?: string | null; policyNumber: string | null; person: string; sum: number | null; quote: string };
type Row = { section: string; benefit: string; percent?: number; value?: number; quote: string };
function read(id: string, kind: string, product: string, pages: string[], covers: Cov[], rows: Row[]): CheckedReading {
  const doc: SourceDoc = { id, name: `${id.slice(-2)}.pdf`, readable: true, pages: pages.map((text, i) => ({ page: i + 1, text })) };
  const r = checkReading(doc, { document: { kind, product, insurer: null, namedPeople: covers.map((c) => c.person), plan: null, periodFrom: null, periodTo: null },
    covers: covers.map((c) => ({ person: c.person, product: c.product, cover: c.cover, plan: c.plan ?? null, riderOf: c.riderOf ?? null, policyNumber: c.policyNumber, premium: null, premiumFrequency: null,
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
test("a schedule printing two covers of the same name for the person: the link is left as it was, never guessed or refused", () => {
  const { oldR, oldKey } = versions(CASES[0]);
  const two = read(id(6), "personal_proof", "Family Personal Accident Policy", ["RENEWAL\nPolicy number HPA-55120-K\nNgozi Okafor\tGBP 100,000\nNgozi Okafor\tGBP 30,000\nFracture\t2% of sum insured"],
    [{ product: "Family Personal Accident Policy", cover: "Family Personal Accident", plan: "Gold", policyNumber: "HPA-55120-K", person: "Ngozi Okafor", sum: 100000, quote: "Ngozi Okafor\tGBP 100,000" },
      { product: "Family Personal Accident Policy", cover: "Personal Accident", plan: "Silver", policyNumber: "HPA-55120-K", person: "Ngozi Okafor", sum: 30000, quote: "Ngozi Okafor\tGBP 30,000" }],
    [{ section: "Benefits", benefit: "Fracture", percent: 2, quote: "Fracture\t2% of sum insured" }]);
  const t = assembleTable([oldR, two], fam("Ngozi Okafor"), linkTo(two, oldKey));
  assert.deepEqual(t.refusedLinks, []);
  assert.ok(rows(t, "p1").some((x) => x.startsWith("Fracture") && x.endsWith(`@${oldKey}`)), JSON.stringify(rows(t, "p1")));
});
// Critic #445: never a basic plan for a rider, never a rider for the plan, never over the household's own choice.
const HL = "Harbour Life";
test("F1 a rider printed with no policy number on the renewal moves to the renewal's own rider, not to its basic plan", () => {
  const last = read(id(8), "personal_proof", HL, ["Schedule 2025\nPolicy number HL-100\nJane Doe\tS$400,000\nEarly CI Rider\tS$90,000"],
    [{ product: HL, cover: "Basic plan", policyNumber: "HL-100", person: "Jane Doe", sum: 400000, quote: "Jane Doe\tS$400,000" },
      { product: HL, cover: "Early CI Rider", policyNumber: "HL-100", person: "Jane Doe", sum: 90000, quote: "Early CI Rider\tS$90,000" }], []);
  const now = read(id(9), "personal_proof", HL, ["Schedule 2026\nPolicy number HL-100\nJane Doe\tS$500,000\nEarly CI\tS$100,000\nEarly CI benefit\t25% of sum insured"],
    [{ product: HL, cover: "Basic plan", policyNumber: "HL-100", person: "Jane Doe", sum: 500000, quote: "Jane Doe\tS$500,000" },
      { product: HL, cover: "Early CI", policyNumber: null, person: "Jane Doe", sum: 100000, quote: "Early CI\tS$100,000" }],
    [{ section: "Rider", benefit: "Early CI benefit", percent: 25, quote: "Early CI benefit\t25% of sum insured" }]);
  const t = assembleTable([last, now], fam("Jane Doe"), linkTo(now, coverKeyOf({ product: HL, cover: "Early CI Rider", plan: null })));
  const got = rows(t, "p1");
  assert.ok(got.some((x) => x.startsWith("Early CI benefit") && x.includes("of 100000")), JSON.stringify(got));
  assert.ok(!got.some((x) => x.includes("of 500000")), JSON.stringify(got));
});
test("F2 a certificate printing only a rider keeps its sections on the base schedule's cover they were linked to", () => {
  const base = read(id(10), "personal_proof", HL, ["Schedule\nPolicy number HL-100\nJane Doe\tS$500,000"],
    [{ product: HL, cover: HL, policyNumber: "HL-100", person: "Jane Doe", sum: 500000, quote: "Jane Doe\tS$500,000" }], []);
  const cert = read(id(11), "personal_proof", HL, ["Certificate\nPolicy number HL-100\nInsured: Jane Doe\nHospital Cash Rider\tS$100\nAccidental death\t100% of sum insured"],
    [{ product: HL, cover: "Hospital Cash Rider", policyNumber: "HL-100", person: "Jane Doe", sum: 100, quote: "Hospital Cash Rider\tS$100" }],
    [{ section: "Benefits", benefit: "Accidental death", percent: 100, quote: "Accidental death\t100% of sum insured" }]);
  const key = coverKeyOf({ product: HL, cover: HL, plan: null });
  const got = rows(assembleTable([base, cert], fam("Jane Doe"), linkTo(cert, key)), "p1");
  assert.ok(got.some((x) => x.startsWith("Accidental death") && x.includes("of 500000") && x.endsWith(`@${key}`)), JSON.stringify(got));
});
test("F3 a link the household chose is never moved", () => {
  const { oldR, newR, oldKey } = versions(CASES[0]);
  const chosen = linkTo(newR, oldKey).map((x) => ({ ...x, chosenBy: "household" }));
  const got = rows(assembleTable([oldR, newR], fam("Ngozi Okafor"), chosen), "p1");
  assert.ok(got.some((x) => x.startsWith("Fracture") && x.includes("of 75000") && x.endsWith(`@${oldKey}`)), JSON.stringify(got));
});
test("another person's cover on the other copy is never taken as this document's own", () => {
  const { oldR, oldKey } = versions(CASES[0]);
  const other = read(id(12), "personal_proof", "Family Personal Accident Policy", ["RENEWAL\nPolicy number HPA-55120-K\nDaniel Okafor\tGBP 80,000\nFracture\t2% of sum insured"],
    [{ product: "Family Personal Accident Policy", cover: "Family Personal Accident", policyNumber: "HPA-55120-K", person: "Daniel Okafor", sum: 80000, quote: "Daniel Okafor\tGBP 80,000" }],
    [{ section: "Benefits", benefit: "Fracture", percent: 2, quote: "Fracture\t2% of sum insured" }]);
  const t = assembleTable([oldR, other], fam("Ngozi Okafor", "Daniel Okafor"), linkTo(other, oldKey));
  assert.ok(rows(t, "p1").some((x) => x.startsWith("Fracture") && x.endsWith(`@${oldKey}`)), JSON.stringify(rows(t, "p1")));
});

// Critic #445 round 2: a one-word name is no evidence when the document prints several covers for the person; the person is
// the family member each cover was matched to, whatever name is printed.
test("P6 last year's base read as 'Plan', the renewal printing 'Shield' and 'Waiver Plan': the link is left, never moved onto the waiver", () => {
  const last = read(id(13), "personal_proof", HL, ["2025\nPolicy number HL-300\nJane Doe\tS$300,000"], [{ product: HL, cover: "Plan", policyNumber: "HL-300", person: "Jane Doe", sum: 300000, quote: "Jane Doe\tS$300,000" }], []);
  const now = read(id(14), "personal_proof", HL, ["2026\nPolicy number HL-300\nJane Doe\tS$500,000\nWaiver Plan\tS$2,000\nDeath\t100% of sum insured"],
    [{ product: HL, cover: "Shield", policyNumber: "HL-300", person: "Jane Doe", sum: 500000, quote: "Jane Doe\tS$500,000" }, { product: HL, cover: "Waiver Plan", policyNumber: "HL-300", person: "Jane Doe", sum: 2000, quote: "Waiver Plan\tS$2,000" }],
    [{ section: "Benefits", benefit: "Death", percent: 100, quote: "Death\t100% of sum insured" }]);
  const got = rows(assembleTable([last, now], fam("Jane Doe"), linkTo(now, coverKeyOf({ product: HL, cover: "Plan", plan: null }))), "p1");
  assert.ok(!got.some((x) => x.includes("of 2000")), JSON.stringify(got));
});
test("P7 'Accident' against the renewal's 'Term Life' and 'Accident Rider': never moved onto the rider", () => {
  const last = read(id(15), "personal_proof", HL, ["2025\nPolicy number HL-400\nJane Doe\tS$200,000"], [{ product: HL, cover: "Accident", policyNumber: "HL-400", person: "Jane Doe", sum: 200000, quote: "Jane Doe\tS$200,000" }], []);
  const now = read(id(16), "personal_proof", HL, ["2026\nPolicy number HL-400\nJane Doe\tS$400,000\nAccident Rider\tS$50,000\nTerminal illness\t100% of sum insured"],
    [{ product: HL, cover: "Term Life", policyNumber: "HL-400", person: "Jane Doe", sum: 400000, quote: "Jane Doe\tS$400,000" }, { product: HL, cover: "Accident Rider", policyNumber: "HL-400", person: "Jane Doe", sum: 50000, quote: "Accident Rider\tS$50,000" }],
    [{ section: "Benefits", benefit: "Terminal illness", percent: 100, quote: "Terminal illness\t100% of sum insured" }]);
  const got = rows(assembleTable([last, now], fam("Jane Doe"), linkTo(now, coverKeyOf({ product: HL, cover: "Accident", plan: null }))), "p1");
  assert.ok(!got.some((x) => x.includes("of 50000")), JSON.stringify(got));
});
test("P9 the renewal prints the person with a title ('Mrs Ngozi Okafor'): still her own copy", () => {
  const o = CASES[0];
  const { oldR, oldKey } = versions(o);
  const newR = read(id(17), "personal_proof", o.product, [`RENEWAL\nPolicy number ${o.number}\nMrs Ngozi Okafor\tGBP 100,000\nSection 2 Fracture\t2% of sum insured`],
    [{ product: o.product, cover: o.newName, policyNumber: o.number, person: "Mrs Ngozi Okafor", sum: 100000, quote: "Mrs Ngozi Okafor\tGBP 100,000" }],
    [{ section: "Section 2", benefit: "Fracture", percent: 2, quote: "Section 2 Fracture\t2% of sum insured" }]);
  const got = rows(assembleTable([oldR, newR], fam("Ngozi Okafor"), [...linkTo(oldR, oldKey), ...linkTo(newR, oldKey)]), "p1");
  assert.ok(got.some((x) => x.startsWith("Fracture") && x.includes("of 100000")), JSON.stringify(got));
});

test("control: a schedule of a different policy number, linked to another policy's cover of the same name, keeps that link", () => {
  const o = { ...CASES[0], numberNew: "ZZ-999" };
  const { oldR, newR, oldKey } = versions(o);
  const got = rows(assembleTable([oldR, newR], fam(o.person), [...linkTo(oldR, oldKey), ...linkTo(newR, oldKey)]), "p1");
  assert.ok(got.filter((x) => x.startsWith("Fracture") && x.endsWith(`@${oldKey}`)).length === 2, JSON.stringify(got));
});

console.log(`policy versions: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
export {};
