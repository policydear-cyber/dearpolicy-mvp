/** A table printed again on other pages, or a running total that stays flat once premiums stop, is one row, never many
 * figures to add up. Controls: a changing amount, another benefit, another currency and another person stay separate.
 *   node --import tsx scripts/benefit-table/repeated-rows-test.ts */
import assert from "node:assert/strict";
import { collapseRepeats } from "@/lib/benefit-table/repeats";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const mk = (benefit: string, year: number, amount: number, extra: Record<string, unknown> = {}) => ({
  personId: "p1", coverKey: "c1", benefit, section: null, column: null, pays: "value",
  figure: { kind: "value", amount, currency: "SGD" }, valueAt: { policyYear: year }, source: { documentId: "d1", page: 38 }, ...extra });

test("a running total flat from year 10 to year 40 is one row naming the later years", () => {
  const rows = [10, 15, 20, 25, 30, 35, 40].map((y) => mk("Total Basic Premiums Paid To-Date", y, 47909));
  const out = collapseRepeats(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.valueAt!.policyYear, 10);
  assert.deepEqual(out[0]!.repeatedAt, [15, 20, 25, 30, 35, 40]);
});
test("the same table printed on two pages is one row per year", () => {
  const out = collapseRepeats([mk("Surrender value", 5, 1000), mk("Surrender value", 5, 1000, { source: { documentId: "d1", page: 40 } }), mk("Surrender value", 10, 2000)]);
  assert.equal(out.length, 2);
});
test("control: a value that is not a running total and changes with the year is kept for every year", () => {
  assert.equal(collapseRepeats([mk("Surrender value", 5, 1000), mk("Surrender value", 10, 2000), mk("Surrender value", 15, 3000)]).length, 3);
});
test("control: the same flat amount on a non-running benefit in different years is not collapsed", () => {
  assert.equal(collapseRepeats([mk("Guaranteed cash value", 10, 500), mk("Guaranteed cash value", 20, 500)]).length, 2);
});
test("control: a running total that grows keeps each amount", () => {
  assert.equal(collapseRepeats([mk("Total premiums paid", 5, 100), mk("Total premiums paid", 10, 200), mk("Total premiums paid", 15, 200)]).length, 2);
});
test("control: another currency, person or benefit is never merged", () => {
  const a = mk("Total premiums paid", 10, 100);
  assert.equal(collapseRepeats([a, { ...a, figure: { kind: "value", amount: 100, currency: "USD" }, valueAt: { policyYear: 15 } }]).length, 2);
  assert.equal(collapseRepeats([a, { ...a, personId: "p2", valueAt: { policyYear: 15 } }]).length, 2);
  assert.equal(collapseRepeats([a, { ...a, benefit: "Total distribution cost to-date", valueAt: { policyYear: 15 } }]).length, 2);
});
test("control: a row with no year or no amount is always kept", () => {
  const n = { ...mk("Total premiums paid", 10, 100), valueAt: undefined };
  assert.equal(collapseRepeats([n, { ...n }]).length, 2);
});
test("control: a different rate is a different projection", () => {
  assert.equal(collapseRepeats([mk("Projected value", 10, 500, { valueAt: { policyYear: 10, rate: "4.25%" } }), mk("Projected value", 10, 500, { valueAt: { policyYear: 10, rate: "3.00%" } })]).length, 2);
});
test("control: another period, basis or qualifier is another figure", () => {
  const a = mk("Total premiums paid", 10, 500, { figure: { kind: "value", amount: 500, currency: "SGD", period: "month" } });
  assert.equal(collapseRepeats([a, { ...a, figure: { ...a.figure, period: "year" }, valueAt: { policyYear: 20 } }]).length, 2);
  assert.equal(collapseRepeats([a, { ...a, figure: { ...a.figure, basis: "non_guaranteed" }, valueAt: { policyYear: 20 } }]).length, 2);
  assert.equal(collapseRepeats([{ ...a, qualifier: "child" }, { ...a, qualifier: "per family", valueAt: { policyYear: 20 } }]).length, 2);
});
test("control: Total Premium 1000, 2000, 1000 keeps all three; per-year wording is not a running total", () => {
  assert.equal(collapseRepeats([mk("Total Premium", 1, 1000), mk("Total Premium", 2, 2000), mk("Total Premium", 3, 1000)]).length, 3);
  assert.equal(collapseRepeats([mk("Total charges deducted", 1, 50), mk("Total charges deducted", 2, 50)]).length, 2);
  assert.equal(collapseRepeats([mk("Total Premium Payable (Annual)", 1, 50), mk("Total Premium Payable (Annual)", 2, 50)]).length, 2);
});
test("control: a running total that dips back is not merged into the older row", () => {
  assert.equal(collapseRepeats([mk("Total premiums paid to date", 5, 100), mk("Total premiums paid to date", 10, 200), mk("Total premiums paid to date", 15, 100)]).length, 3);
});
test("the same flat running total with a different asOf wording is still one row", () => {
  const f = (y: number) => mk("Total premiums paid", y, 9, { figure: { kind: "value", amount: 9, currency: "SGD", asOf: `policy year ${y}` } });
  assert.equal(collapseRepeats([f(10), f(20)]).length, 1);
});

test("control: a bare Premiums paid column is a yearly figure, not a running total", () => {
  assert.equal(collapseRepeats([mk("Premiums paid", 1, 50), mk("Premiums paid", 2, 50)]).length, 2);
});
test("the earliest year is shown whatever the input order, and the input is not changed", () => {
  const rows = [mk("Total premiums paid to date", 40, 9), mk("Total premiums paid to date", 10, 9)];
  const out = collapseRepeats(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.valueAt!.policyYear, 10);
  assert.deepEqual(out[0]!.repeatedAt, [40]);
  assert.equal((rows[0] as { repeatedAt?: number[] }).repeatedAt, undefined);
});
test("control: an age and a policy year with the same number are different dates", () => {
  const a = mk("Surrender value", 65, 5);
  assert.equal(collapseRepeats([a, { ...a, valueAt: { age: 65 } }]).length, 2);
});
test("control: 'up to date' and 'due to date' are not running totals", () => {
  assert.equal(collapseRepeats([mk("Premium up to date", 5, 800), mk("Premium up to date", 10, 800)]).length, 2);
  assert.equal(collapseRepeats([mk("Premium due to date of payment", 5, 800), mk("Premium due to date of payment", 10, 800)]).length, 2);
});

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`repeated-rows: ${passed} pass`);
