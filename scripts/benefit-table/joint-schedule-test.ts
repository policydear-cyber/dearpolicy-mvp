/** Joint schedules, 10 Nov: a section linked by cover type was shown for every holder of that type, so on a schedule that
 * prints two lives, one life's amounts showed under the other life too. A row that prints its own figure is shown for a
 * person only when its own document says it is theirs (DC, 10 Nov): the life named in its block or column heading, or the
 * only holder the document prints; otherwise the lives whose own sum printed on that document is the row's figure; otherwise
 * no one, and the section is said to be not shown. Made-up households in S$ and A$; no
 * model, database or network.
 *   npm run benefit-table:joint-schedule-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, NOT_TOLD_WHY, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type CheckedReading, type SourceDoc } from "@/lib/benefit-table/check";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const JANE = "Jane Doe", JOHN = "John Roe";
const family: FamilyMember[] = [{ id: "p1", display_name: JANE }, { id: "p2", display_name: JOHN }];
const PRODUCT = "Harbour Life Plan";
const KEY = coverKeyOf({ product: PRODUCT, cover: PRODUCT, plan: null, riderOf: null });
const cover = (person: string, sum: number, quote: string, page = 1) => ({ person, product: PRODUCT, cover: PRODUCT, plan: null, riderOf: null, policyNumber: null, premium: null,
  premiumFrequency: null, asOf: null, startDate: null, endDate: null, page, sumInsured: sum, quote });
const row = (section: string, benefit: string, value: number, quote: string, column: string | null = null, page = 1) => ({ section, column, benefit, pays: "amount", value, period: null,
  basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page, quote });
function read(id: string, kind: string, named: string[], pages: string[], covers: unknown[], benefits: unknown[]): CheckedReading {
  const doc: SourceDoc = { id, name: `${id.slice(-2)}.pdf`, readable: true, pages: pages.map((text, i) => ({ page: i + 1, text })) };
  const r = checkReading(doc, { document: { kind, product: PRODUCT, insurer: null, namedPeople: named, plan: null, periodFrom: null, periodTo: null }, covers, benefits });
  assert.equal(r.covers.length, covers.length, `${id}: every cover checks against its page`);
  assert.equal(r.benefits.length, benefits.length, `${id}: every row checks against its page`);
  return r;
}
const doc = (n: number) => `dddddddd-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const rowsFor = (t: ReturnType<typeof assembleTable>, id: string) => t.people.find((p) => p.id === id)!.rows.map((x) => `${x.benefit} ${x.figure.kind === "printed" ? x.figure.amount : x.figure.kind}`).sort();

/** One schedule printing both lives, each with the same plan and its own block of benefits. */
function joint(sign: string, headings: [string, string]) {
  const page = `JOINT POLICY SCHEDULE\nLives Assured: ${JANE} and ${JOHN}\n${headings[0]}\n${PRODUCT}\t${sign}500,000\nDeath Benefit\t${sign}500,000\nHospital Cash\t${sign}200 per day\n`
    + `${headings[1]}\n${PRODUCT}\t${sign}300,000\nDeath Benefit\t${sign}300,000\nHospital Cash\t${sign}100 per day`;
  const id = doc(1);
  return read(id, "personal_proof", [JANE, JOHN], [page],
    [cover(JANE, 500000, `${PRODUCT}\t${sign}500,000`), cover(JOHN, 300000, `${PRODUCT}\t${sign}300,000`)],
    [row(headings[0], "Death Benefit", 500000, `Death Benefit\t${sign}500,000`), row(headings[0], "Hospital Cash", 200, `Hospital Cash\t${sign}200 per day`),
      row(headings[1], "Death Benefit", 300000, `Death Benefit\t${sign}300,000`), row(headings[1], "Hospital Cash", 100, `Hospital Cash\t${sign}100 per day`)]);
}
const linkAll = (r: CheckedReading) => [...new Set(r.benefits.map((b) => sectionKeyOf(r.documentId, b)))].map((section) => ({ section, cover: KEY, why: "the plan's benefits" }));

test("two lives with the same plan, each block headed with the life's name: each person sees only their own amounts (S$)", () => {
  const r = joint("S$", [`Benefits for Life Assured: ${JANE}`, `Benefits for Life Assured: ${JOHN}`]);
  const t = assembleTable([r], family, linkAll(r));
  assert.deepEqual(rowsFor(t, "p1"), ["Death Benefit 500000", "Hospital Cash 200"]);
  assert.deepEqual(rowsFor(t, "p2"), ["Death Benefit 300000", "Hospital Cash 100"]);
  assert.deepEqual(t.unlinkedSections, []);
});
test("the life is named in the column heading: the same (A$)", () => {
  const page = `JOINT POLICY SCHEDULE\n${PRODUCT}\tA$500,000\n${PRODUCT}\tA$300,000\nBenefit\t${JANE}\t${JOHN}\nDeath Benefit\tA$500,000\tA$300,000`;
  const r = read(doc(2), "personal_proof", [JANE, JOHN], [page], [cover(JANE, 500000, `${PRODUCT}\tA$500,000`), cover(JOHN, 300000, `${PRODUCT}\tA$300,000`)],
    [row("Benefits", "Death Benefit", 500000, "Death Benefit\tA$500,000", JANE), row("Benefits", "Death Benefit", 300000, "A$300,000", JOHN)]);
  const t = assembleTable([r], family, linkAll(r));
  assert.deepEqual(rowsFor(t, "p1"), ["Death Benefit 500000"]);
  assert.deepEqual(rowsFor(t, "p2"), ["Death Benefit 300000"]);
});
test("blocks that do not name the life: a figure that is one life's own sum goes to that life; any other figure to neither, and the section is said to be not shown", () => {
  const r = joint("S$", ["Benefits (Life 1)", "Benefits (Life 2)"]);
  const t = assembleTable([r], family, linkAll(r));
  assert.deepEqual(rowsFor(t, "p1"), ["Death Benefit 500000"]);
  assert.deepEqual(rowsFor(t, "p2"), ["Death Benefit 300000"]);
  assert.equal(t.unlinkedSections.length, 2);
  assert.ok(t.unlinkedSections.every((u) => u.why === NOT_TOLD_WHY));
  // Each person's own cover is still shown: only the rows that cannot be told apart are held back.
  assert.equal(t.people[0].covers.length, 1);
  assert.equal(t.people[1].covers.length, 1);
});
test("a heading that names both lives tells no one apart: only a figure that is a life's own sum is shown, for that life", () => {
  const r = joint("S$", [`Benefits for ${JANE} and ${JOHN}`, "Benefits (Life 2)"]);
  const t = assembleTable([r], family, linkAll(r));
  assert.deepEqual(rowsFor(t, "p1"), ["Death Benefit 500000"]);
  assert.deepEqual(rowsFor(t, "p2"), ["Death Benefit 300000"]);
});
test("a given name alone is not a name: a heading saying only 'Jane' tells no one apart", () => {
  const r = joint("S$", ["Benefits for Jane", "Benefits for John"]);
  const t = assembleTable([r], family, linkAll(r));
  assert.ok(!rowsFor(t, "p1").some((x) => x.startsWith("Hospital Cash")));
  assert.ok(!rowsFor(t, "p2").some((x) => x.startsWith("Hospital Cash")));
  assert.ok(!rowsFor(t, "p2").includes("Death Benefit 500000"), "never Jane's sum for John");
});
test("a shared certificate's figure that is one member's own sum is shown for that member only, never the other", () => {
  const page = `GROUP CERTIFICATE\nMember: ${JANE}\t${PRODUCT}\tS$300,000\nMember: ${JOHN}\t${PRODUCT}\tS$120,000\nDeath benefit\tS$300,000`;
  const r = read(doc(11), "personal_proof", [JANE, JOHN], [page], [cover(JANE, 300000, `Member: ${JANE}\t${PRODUCT}\tS$300,000`), cover(JOHN, 120000, `Member: ${JOHN}\t${PRODUCT}\tS$120,000`)],
    [row("Schedule", "Death benefit", 300000, "Death benefit\tS$300,000")]);
  const t = assembleTable([r], family, linkAll(r));
  assert.deepEqual(rowsFor(t, "p1"), ["Death benefit 300000"]);
  assert.deepEqual(rowsFor(t, "p2"), []);
});
test("two lives with the same sum: a figure equal to it is right for both, and shown for both", () => {
  const page = `JOINT POLICY SCHEDULE\n${JANE}\t${PRODUCT}\tA$200,000\n${JOHN}\t${PRODUCT}\tA$200,000\nDeath Benefit\tA$200,000\nFuneral Benefit\tA$5,000`;
  const r = read(doc(12), "personal_proof", [JANE, JOHN], [page], [cover(JANE, 200000, `${JANE}\t${PRODUCT}\tA$200,000`), cover(JOHN, 200000, `${JOHN}\t${PRODUCT}\tA$200,000`)],
    [row("Benefits", "Death Benefit", 200000, "Death Benefit\tA$200,000"), row("Benefits", "Funeral Benefit", 5000, "Funeral Benefit\tA$5,000")]);
  const t = assembleTable([r], family, linkAll(r));
  assert.deepEqual(rowsFor(t, "p1"), ["Death Benefit 200000"]);
  assert.deepEqual(rowsFor(t, "p2"), ["Death Benefit 200000"]);
  assert.ok(t.unlinkedSections.some((u) => u.why === NOT_TOLD_WHY), "the funeral benefit, no one's sum, is said to be not shown");
});
test("two lives with the same plan on separate schedules: each schedule's rows only for its own life", () => {
  const a = read(doc(3), "personal_proof", [JANE], [`POLICY SCHEDULE\nLife Assured: ${JANE}\n${PRODUCT}\tS$500,000\nBenefits\nDeath Benefit\tS$500,000`],
    [cover(JANE, 500000, `${PRODUCT}\tS$500,000`)], [row("Benefits", "Death Benefit", 500000, "Death Benefit\tS$500,000")]);
  const b = read(doc(4), "personal_proof", [JOHN], [`POLICY SCHEDULE\nLife Assured: ${JOHN}\n${PRODUCT}\tS$300,000\nBenefits\nDeath Benefit\tS$300,000`],
    [cover(JOHN, 300000, `${PRODUCT}\tS$300,000`)], [row("Benefits", "Death Benefit", 300000, "Death Benefit\tS$300,000")]);
  const t = assembleTable([a, b], family, [...linkAll(a), ...linkAll(b)]);
  assert.deepEqual(rowsFor(t, "p1"), ["Death Benefit 500000"]);
  assert.deepEqual(rowsFor(t, "p2"), ["Death Benefit 300000"]);
});
test("a wording that prints no one's cover is still shown for every holder of the plan", () => {
  const j = joint("S$", [`Benefits for Life Assured: ${JANE}`, `Benefits for Life Assured: ${JOHN}`]);
  const w = read(doc(5), "wording", [], ["POLICY WORDING\nSchedule of Benefits\nFuneral Expenses\tS$5,000"], [], [row("Schedule of Benefits", "Funeral Expenses", 5000, "Funeral Expenses\tS$5,000")]);
  const t = assembleTable([j, w], family, [...linkAll(j), ...linkAll(w)]);
  assert.ok(rowsFor(t, "p1").includes("Funeral Expenses 5000"));
  assert.ok(rowsFor(t, "p2").includes("Funeral Expenses 5000"));
});
test("a single-life household is unchanged: every linked row is shown, by a block heading with or without the name", () => {
  const solo: FamilyMember[] = [family[0]];
  const r = read(doc(6), "personal_proof", [JANE], [`POLICY SCHEDULE\nLife Assured: ${JANE}\n${PRODUCT}\tS$500,000\nBenefits\nDeath Benefit\tS$500,000\nHospital Cash\tS$200 per day`],
    [cover(JANE, 500000, `${PRODUCT}\tS$500,000`)], [row("Benefits", "Death Benefit", 500000, "Death Benefit\tS$500,000"), row("Benefits", "Hospital Cash", 200, "Hospital Cash\tS$200 per day")]);
  const w = read(doc(7), "wording", [], ["POLICY WORDING\nSchedule of Benefits\nFuneral Expenses\tS$5,000"], [], [row("Schedule of Benefits", "Funeral Expenses", 5000, "Funeral Expenses\tS$5,000")]);
  const t = assembleTable([r, w], solo, [...linkAll(r), ...linkAll(w)]);
  assert.deepEqual(rowsFor(t, "p1"), ["Death Benefit 500000", "Funeral Expenses 5000", "Hospital Cash 200"]);
  assert.deepEqual(t.unlinkedSections, []);
});
test("a person's cover kept from another copy of the schedule still gets the copy's rows", () => {
  const page = `POLICY SCHEDULE\nLife Assured: ${JANE}\n${PRODUCT}\tS$500,000\nBenefits\nDeath Benefit\tS$500,000`;
  const a = read(doc(8), "personal_proof", [JANE], [page], [cover(JANE, 500000, `${PRODUCT}\tS$500,000`)], []);
  const b = read(doc(9), "personal_proof", [JANE], [page], [cover(JANE, 500000, `${PRODUCT}\tS$500,000`)], [row("Benefits", "Death Benefit", 500000, "Death Benefit\tS$500,000")]);
  const john = read(doc(10), "personal_proof", [JOHN], [`POLICY SCHEDULE\nLife Assured: ${JOHN}\n${PRODUCT}\tS$300,000`], [cover(JOHN, 300000, `${PRODUCT}\tS$300,000`)], []);
  const t = assembleTable([a, b, john], family, linkAll(b));
  assert.deepEqual(rowsFor(t, "p1"), ["Death Benefit 500000"]);
  assert.deepEqual(rowsFor(t, "p2"), [], "never John's: the schedule prints only Jane's cover");
});

console.log(`benefit-table joint schedule: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
