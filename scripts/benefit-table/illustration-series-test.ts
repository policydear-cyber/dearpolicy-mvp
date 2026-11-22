/** An illustration's columns are series of figures for its one plan (premium by payment frequency, total premiums paid,
 * values by year at a rate), never other plans: a heading on them must not hide the rows. Controls: a column that names a
 * plan, and a non-illustration document's other-plan column, stay refused.
 *   node --import tsx scripts/benefit-table/illustration-series-test.ts */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, illustrationSeries, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const SCHED = "bbbbbbbb-0000-0000-0000-000000000001", ILL = "bbbbbbbb-0000-0000-0000-000000000002", WORD = "bbbbbbbb-0000-0000-0000-000000000003";
const family: FamilyMember[] = [{ id: "p1", display_name: "Ong Pei Lin Charmaine" }];
const illText = "Basic Premium\nMonthly ($)\tQuarterly ($)\tSemi-Annually ($)\tAnnually ($)\n399.24\t1,195.45\t2,372.31\t4,651.59\nPolicy Illustration\nTotal Basic Premiums Paid To-Date ($)\n1/29\t4,791\t5,030\n5/33\t23,954\t25,152\n10/38\t47,909\t50,304";
const src = (id: string, name: string, text: string): SourceDoc => ({ id, name, readable: true, pages: [{ page: 1, text }] });
const reading = (kind: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product: "READYBUILDER 10", insurer: null, namedPeople: ["Ong Pei Lin Charmaine"], plan: "READYBUILDER 10", periodFrom: null, periodTo: null }, covers, benefits });
const base = { cap: null, basis: null, period: null, capQuote: null, baseQuote: null, percentOf: null, baseAmount: null, conditions: [], page: 1 };
const sched = checkReading(src(SCHED, "Schedule", "Ong Pei Lin Charmaine\tREADYBUILDER 10\tS$49,000"), reading("personal_proof",
  [{ person: "Ong Pei Lin Charmaine", product: "READYBUILDER 10", cover: "READYBUILDER 10", plan: "READYBUILDER 10", sumInsured: 49000, asOf: null, page: 1, quote: "Ong Pei Lin Charmaine READYBUILDER 10 S$49,000" }], []));
const FREQ = "399.24\t1,195.45\t2,372.31\t4,651.59";
const premium = (column: string, value: number) => ({ ...base, pays: "amount", quote: FREQ, value, column, benefit: "Basic Premium", section: "Policy Illustration" });
const paid = (column: string, year: number, value: number, line: string) => ({ ...base, pays: "value", quote: line, value, column, benefit: "Total premiums paid", section: "Policy Illustration", atPolicyYear: year });
const illRows = (paidColumn: string) => [premium("Monthly ($)", 399.24), premium("Quarterly ($)", 1195.45), premium("Semi-Annually ($)", 2372.31), premium("Annually ($)", 4651.59),
  paid(paidColumn, 1, 4791, "1/29\t4,791\t5,030"), paid(paidColumn, 5, 23954, "5/33\t23,954\t25,152"), paid(paidColumn, 10, 47909, "10/38\t47,909\t50,304")];
const cover = coverKeyOf({ product: "READYBUILDER 10", cover: "READYBUILDER 10", plan: "READYBUILDER 10" });
const linksFor = (id: string, rows: { column: string; section: string }[]) => [...new Set(rows.map((r) => sectionKeyOf(id, r)))].map((section) => ({ section, cover, why: "the plan" }));
const shown = (t: ReturnType<typeof assembleTable>) => t.people[0]!.rows.map((r) => r.figure).filter((f) => f.kind !== "none").map((f) => (f as { amount?: number }).amount);

test("an illustration's frequency and total-premiums-paid columns are shown for the plan", () => {
  const rows = illRows("Total Basic Premiums Paid To-Date ($)");
  const ill = checkReading(src(ILL, "Illustration", illText), reading("illustration", [], rows));
  const t = assembleTable([sched, ill], family, linksFor(ILL, rows as never));
  const amounts = shown(t);
  for (const n of [1195.45, 2372.31, 4651.59, 4791, 23954, 47909]) assert.ok(amounts.includes(n), `missing ${n}: ${JSON.stringify(amounts)} refused ${JSON.stringify(t.refusedLinks.map((x) => x.why))}`);
});
test("illustrationSeries names those sections", () => {
  const rows = illRows("Total Basic Premiums Paid To-Date ($)");
  const ill = checkReading(src(ILL, "Illustration", illText), reading("illustration", [], rows));
  const s = illustrationSeries([ill]);
  assert.ok(s.has(sectionKeyOf(ILL, { section: "Policy Illustration", column: "Quarterly ($)" })));
  assert.ok(s.has(sectionKeyOf(ILL, { section: "Policy Illustration", column: "Total Basic Premiums Paid To-Date ($)" })));
});
test("control: a column that says plan stays refused in an illustration", () => {
  const rows = illRows("Plan B ($)");
  const ill = checkReading(src(ILL, "Illustration", illText), reading("illustration", [], rows));
  const t = assembleTable([sched, ill], family, linksFor(ILL, rows as never));
  assert.ok(!shown(t).includes(47909), "a Plan B column is not shown");
  assert.ok(t.refusedLinks.some((x) => /Plan B/.test(x.why)));
});
test("control: another plan's column in a document that is not an illustration stays refused", () => {
  const text = "Benefit\tClassic\tPremier\nDeath benefit\tS$1,000\tS$2,000";
  const rows = [{ ...base, pays: "amount", quote: "Death benefit\tClassic\tPremier", value: 2000, column: "Premier", benefit: "Death benefit", section: "Benefits" }];
  const w = checkReading(src(WORD, "Wording", text), reading("product_summary", [], rows));
  const t = assembleTable([sched, w], family, linksFor(WORD, rows as never));
  assert.ok(!shown(t).includes(2000));
});
for (const heading of ["Standard", "Enhanced", "Cover Term 20 years", "Sum Assured $200,000", "Rider A", "Basic"]) {
  test(`control: an alternative heading "${heading}" on by-year values stays refused`, () => {
    const rows = illRows(heading);
    const ill = checkReading(src(ILL, "Illustration", illText), reading("illustration", [], rows));
    const t = assembleTable([sched, ill], family, linksFor(ILL, rows as never));
    assert.ok(!shown(t).includes(47909), `${heading} was shown`);
    assert.ok(t.refusedLinks.some((x) => x.why.includes(heading)));
  });
}
test("control: two by-year columns Standard and Enhanced side by side are both refused, and so is a series beside them", () => {
  const rows = [...illRows("Total Basic Premiums Paid To-Date ($)"), paid("Standard", 5, 11111, "5/33\t23,954\t25,152"), paid("Enhanced", 5, 22222, "5/33\t23,954\t25,152")];
  const ill = checkReading(src(ILL, "Illustration", illText), reading("illustration", [], rows));
  const t = assembleTable([sched, ill], family, linksFor(ILL, rows as never));
  assert.ok(!shown(t).includes(11111) && !shown(t).includes(22222), "alternatives are not shown");
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`illustration-series: ${passed} pass`);
process.exit(0);
