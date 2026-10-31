/** Family's "Covered for" (kindsOfTable) does not list a cover that has ended. A single trip whose printed period is over
 * (coverEnded, lib/benefit-table/assemble.ts) is not current cover: Home tiles already leave it out, and Family listed it
 * as "Travel". Made-up households only, no database and no model: each table is assembled from synthetic readings and sent
 * through JSON, as GET /api/benefit-table hands it to the Family page.
 *   npm run benefit-table:family-ended-test */
import assert from "node:assert/strict";
import { checkReading } from "@/lib/benefit-table/check";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import type { SectionLink } from "@/lib/benefit-table/reading";
import { endedKinds, kindsOfTable, type TableKindCover, type TableKindRow } from "@/components/cover-kinds";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const person = "Lim Ah Kow";
const family: FamilyMember[] = [{ id: "p1", display_name: person }];
const TRIP = "aaaaaaaa-0000-0000-0000-00000000e001", LIFE = "aaaaaaaa-0000-0000-0000-00000000e002", ANNUAL = "aaaaaaaa-0000-0000-0000-00000000e003";
const b = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
const reading = (product: string, covers: unknown[], benefits: unknown[], period: { from?: string; to?: string } = {}) =>
  ({ document: { kind: "personal_proof", product, insurer: null, namedPeople: [], plan: null, periodFrom: period.from ?? null, periodTo: period.to ?? null }, covers, benefits });
const sgt = (iso: string) => new Date(`${iso}T12:00:00+08:00`);

/** A single trip with Example Insurance; `period` is printed on its page 1 only when given. */
const tripReading = (period: string | null) => checkReading({ id: TRIP, name: "Trip summary.pdf", readable: true, pages: [
  { page: 1, text: `TRAVEL INSURANCE SUMMARY\nSingle Trip\tPlan: Classic\n${period ? `Period of insurance: ${period}` : "Period of insurance: see schedule"}\nInsured person\t${person}` },
  { page: 4, text: "Section 2 Medical expenses\nOverseas medical expenses\tup to S$200,000\nSection 5 Baggage\nLoss of baggage\tup to S$3,000" },
] }, reading("Example Travel Insurance", [{ person, product: "Example Travel Insurance", cover: "Single Trip", plan: "Classic", sumInsured: null, asOf: null, page: 1, quote: `Insured person\t${person}` }],
  [b({ section: "Section 2 Medical expenses", benefit: "Overseas medical expenses", pays: "up_to", value: 200000, page: 4, quote: "Overseas medical expenses\tup to S$200,000" }),
    b({ section: "Section 5 Baggage", benefit: "Loss of baggage", pays: "up_to", value: 3000, page: 4, quote: "Loss of baggage\tup to S$3,000" })],
  period ? { from: period.split(" to ")[0], to: period.split(" to ")[1] } : {}));
const lifeReading = checkReading({ id: LIFE, name: "Life schedule.pdf", readable: true, pages: [
  { page: 1, text: `POLICY SCHEDULE\nExample Term Life\nLife assured\t${person}\tSum assured S$500,000\nDeath benefit\tS$500,000` },
] }, reading("Example Term Life", [{ person, product: "Example Term Life", cover: "Term Life", plan: null, sumInsured: 500000, asOf: null, page: 1, quote: `Life assured\t${person}\tSum assured S$500,000` }],
  [b({ section: "POLICY SCHEDULE", benefit: "Death benefit", pays: "amount", value: 500000, quote: "Death benefit\tS$500,000" })]));
const annualReading = checkReading({ id: ANNUAL, name: "Annual travel.pdf", readable: true, pages: [
  { page: 1, text: `CERTIFICATE OF INSURANCE\nExample Travel Insurance\tAnnual Multi-Trip\nPeriod of insurance: 01/04/2026 to 31/03/2027\nInsured person\t${person}\nTravel delay\tS$100 for every 6 hours` },
] }, reading("Example Travel Insurance", [{ person, product: "Example Travel Insurance", cover: "Annual Multi-Trip", plan: null, sumInsured: null, asOf: null, page: 1, quote: `Insured person\t${person}` }],
  [b({ section: "CERTIFICATE OF INSURANCE", benefit: "Travel delay", pays: "words", quote: "Travel delay\tS$100 for every 6 hours" })], { from: "01/04/2026", to: "31/03/2027" }));

const trip = coverKeyOf({ product: "Example Travel Insurance", cover: "Single Trip", plan: "Classic" });
const life = coverKeyOf({ product: "Example Term Life", cover: "Term Life", plan: null });
const annual = coverKeyOf({ product: "Example Travel Insurance", cover: "Annual Multi-Trip", plan: null });
const LINKS: SectionLink[] = [
  { section: sectionKeyOf(TRIP, { section: "Section 2 Medical expenses", column: null }), cover: trip, why: "the trip" },
  { section: sectionKeyOf(TRIP, { section: "Section 5 Baggage", column: null }), cover: trip, why: "the trip" },
  { section: sectionKeyOf(LIFE, { section: "POLICY SCHEDULE", column: null }), cover: life, why: "the plan" },
  { section: sectionKeyOf(ANNUAL, { section: "CERTIFICATE OF INSURANCE", column: null }), cover: annual, why: "the plan" },
];

/** What Family lists for the one person, from the table as GET /api/benefit-table sends it (JSON, rows and covers). */
function familyKinds(readings: ReturnType<typeof checkReading>[], on: string, links = LINKS) {
  const p = JSON.parse(JSON.stringify(assembleTable(readings, family, links, [], sgt(on)).people[0])) as { rows: TableKindRow[]; covers: TableKindCover[] };
  return kindsOfTable(p.rows, p.covers);
}
const ENDED = "29/09/2026 to 04/10/2026";

test("an ended single trip and an ongoing life plan: Death, no Travel", () => {
  assert.deepEqual(familyKinds([tripReading(ENDED), lifeReading], "2026-10-28"), ["Death"]);
});
test("an ended single trip whose pages are not linked yet: still no Travel", () => {
  assert.deepEqual(familyKinds([tripReading(ENDED), lifeReading], "2026-10-28", LINKS.filter((l) => l.cover !== trip)), ["Death"]);
});
test("only an ended single trip: nothing listed", () => {
  assert.deepEqual(familyKinds([tripReading(ENDED)], "2026-10-28"), []);
});
// Negative controls: what must not change.
test("during the trip (and on its last day) it is Travel", () => {
  assert.deepEqual(familyKinds([tripReading(ENDED), lifeReading], "2026-10-01"), ["Death", "Travel"]);
  assert.deepEqual(familyKinds([tripReading(ENDED), lifeReading], "2026-10-04"), ["Death", "Travel"]);
});
test("an ended single trip and a running annual multi-trip plan: Travel", () => {
  assert.deepEqual(familyKinds([tripReading(ENDED), annualReading, lifeReading], "2026-10-28"), ["Death", "Travel"]);
});
test("an annual multi-trip plan past its printed end (no renewal on file) stays Travel", () => {
  assert.deepEqual(familyKinds([annualReading], "2027-06-01"), ["Travel"]);
});
// Changed in #213 (TE F3): a single trip whose printed period was not read may be long over, so it is neither current
// (no "Travel" in Covered for) nor ended. Missing dates still never make it ended: Family says its dates were not found.
test("a single trip with no printed period is not listed as current Travel, nor as ended: its dates were not found", () => {
  assert.deepEqual(familyKinds([tripReading(null), lifeReading], "2026-10-28"), ["Death"]);
  const p = JSON.parse(JSON.stringify(assembleTable([tripReading(null), lifeReading], family, LINKS, [], sgt("2026-10-28")).people[0])) as { rows: TableKindRow[]; covers: TableKindCover[] };
  assert.deepEqual(endedKinds(p.rows, p.covers), ["Travel: trip dates not found"]);
});
test("rows and covers without an end field (older callers) are listed as before", () => {
  assert.deepEqual(kindsOfTable([{ benefit: "Loss of baggage", pays: "up_to", product: "Example Travel Insurance", cover: "Single Trip" }],
    [{ product: "Example Term Life", cover: "Term Life" }]), ["Death", "Travel"]);
});
test("an ended single trip beside a current one of the same name whose rows are not linked yet: Travel (TE E9)", () => {
  assert.deepEqual(kindsOfTable(
    [{ benefit: "Loss of baggage", pays: "up_to", product: "Example Travel Insurance", cover: "Single Trip", coverEnded: "2026-10-04" }],
    [{ product: "Example Travel Insurance", cover: "Single Trip", ended: "2026-10-04" }, { product: "Example Travel Insurance", cover: "Single Trip", ended: null }]),
  ["Travel"]);
});
test("a cover sent with ended: null and no rows is still listed (TE Q3)", () => {
  assert.deepEqual(kindsOfTable([], [{ product: "Example Term Life", cover: "Term Life", ended: null }]), ["Death"]);
});

if (failures.length) {
  console.error(`family-ended: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`family-ended: ${passed} passed`);
