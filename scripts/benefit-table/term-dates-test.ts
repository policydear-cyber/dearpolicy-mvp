/** A cover's premium end date, premium term and maturity date, and a value's age, policy year and illustrated rate (DC 19
 * Nov: "how long more he needs to pay and how much he can receive at maturity or a projection at each stage of life"):
 * each kept only where the page prints it, never worked out. Invented schedules and illustrations. Pure; no network.
 *   node --import tsx scripts/benefit-table/term-dates-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { termDates, valueAt } from "@/lib/benefit-table/check";
import { READING_PROMPT, READING_SCHEMA } from "@/lib/benefit-table/reading";
import { atYearFigure, type Figure } from "@/lib/benefit-table/assemble";
import { keyBenefits, type SummaryRow } from "@/lib/benefit-table/headline";
import { categoryRows } from "@/lib/coverage/table-figures";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const tablePage = "Component\tStatus\tSum Assured\tPremium\tCover Start Date\tCover Expiry Date\tPremium End Date\nAccident Assist\tIn Force\t100,000.00\t15.98\t17-Nov-2016\t17-Nov-2066\t17-Nov-2061\nTerm Cover\tIn Force\t200,000.00\t40.00\t17-Nov-2016\t17-Nov-2076\t17-Nov-2056";
const row = "Accident Assist\tIn Force\t100,000.00\t15.98\t17-Nov-2016\t17-Nov-2066\t17-Nov-2061";

test("a premium end date printed in the cover's own row is kept", () => {
  assert.deepEqual(termDates({ premiumEndDate: "17-Nov-2061" }, row, tablePage), { premiumEndDate: "17-Nov-2061" });
});
test("another row's premium end date is not this cover's, even though the page prints it", () => {
  assert.deepEqual(termDates({ premiumEndDate: "17-Nov-2056" }, row, tablePage), {});
});
test("a premium end date on a labelled line of the page is kept; on an unlabelled line it is not", () => {
  const page = "Plan: Harbourline Endowment 20\nSum Assured: S$60,000\nPremiums payable until: 01/03/2036\nMaturity Date: 01/03/2046\nIssue date 01/03/2026";
  const q = "Plan: Harbourline Endowment 20\nSum Assured: S$60,000";
  assert.deepEqual(termDates({ premiumEndDate: "01/03/2036", maturityDate: "01/03/2046" }, q, page), { premiumEndDate: "01/03/2036", maturityDate: "01/03/2046" });
  assert.deepEqual(termDates({ premiumEndDate: "01/03/2026" }, q, page), {}, "the issue date line names no premium");
  assert.deepEqual(termDates({ maturityDate: "01/03/2036" }, q, page), {}, "the premium line is no maturity line");
});
test("a premium term only in its own printed words; a made-up term is dropped", () => {
  const page = "Premium Term: To Age 65\nPolicy Term: 30 years";
  assert.deepEqual(termDates({ premiumTerm: "To Age 65" }, "x", page), { premiumTerm: "To Age 65" });
  assert.deepEqual(termDates({ premiumTerm: "20 years" }, "x", page), {});
  assert.deepEqual(termDates({ premiumTerm: "  " }, "x", page), {});
});
test("an illustration row's age, policy year and the column's rate are kept where printed", () => {
  const page = "BENEFIT ILLUSTRATION\nIllustrated at 4.25% p.a.\tIllustrated at 3.00% p.a.\nEnd of Policy Year\tAge\tTotal Premiums Paid\tGuaranteed Surrender Value\tNon-Guaranteed\tTotal\n10\t51\t24,000\t18,200\t6,410\t24,610\n15\t56\t36,000\t30,050\t12,880\t42,930";
  const q = "15\t56\t36,000\t30,050\t12,880\t42,930";
  assert.deepEqual(valueAt({ atAge: 56, atPolicyYear: 15, rate: "4.25%" }, q, page), { atAge: 56, atPolicyYear: 15, rate: "4.25%" });
  assert.deepEqual(valueAt({ atAge: 51, atPolicyYear: 10 }, q, page), {}, "another row's age and year");
  assert.deepEqual(valueAt({ rate: "5%" }, q, page), {}, "a rate the page does not print");
  assert.deepEqual(valueAt({ rate: "4.25% p.a. assumed" }, q, page), {}, "only a plain rate");
  assert.deepEqual(valueAt({ atAge: 56.5, atPolicyYear: -1 }, q, page), {});
});
test("the reading asks for the new fields as optional, and says never to put a premium end in the cover's end date", () => {
  const covers = (READING_SCHEMA as unknown as { properties: { covers: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties.covers.items;
  for (const k of ["premiumEndDate", "premiumTerm", "maturityDate"]) { assert.ok(k in covers.properties, k); assert.ok(!covers.required.includes(k), k); }
  const benefits = (READING_SCHEMA as unknown as { properties: { benefits: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties.benefits.items;
  for (const k of ["atAge", "atPolicyYear", "rate"]) { assert.ok(k in benefits.properties, k); assert.ok(!benefits.required.includes(k), k); }
  assert.match(READING_PROMPT, /never the cover's own end date/);
  assert.match(READING_PROMPT, /every fifth policy year/);
});

test("a figure printed for an age or policy year is never a current amount: not on Home, not leading a card (Critic MED-5)", () => {
  const printed: Figure = { kind: "printed", amount: 200000, currency: "SGD", unit: "lump_sum" };
  assert.deepEqual(atYearFigure(printed, { policyYear: 20, age: 55 }), { kind: "value", amount: 200000, currency: "SGD", asOf: "policy year 20, age 55" });
  assert.equal(atYearFigure(printed, {}), printed, "a row printed for no year is untouched, so every stored reading reads as before");
  const proj: Figure = { kind: "projected", amount: 52900, currency: "SGD", basis: "non_guaranteed", asOf: null };
  assert.deepEqual(atYearFigure(proj, { age: 65 }), { ...proj, asOf: "age 65" });
  const row = (benefit: string, figure: Figure, valueAt?: SummaryRow["valueAt"]) => ({ benefit, section: null, pays: "lump_sum", figure, qualifier: null, fromDay: null, maxDays: null, conditions: [], cover: "Saver 20", product: "Saver 20", plan: null, ...(valueAt ? { valueAt } : {}) }) as unknown as SummaryRow & { cover: string; product: string; plan: null };
  const now = row("Death benefit", { kind: "printed", amount: 100000, currency: "SGD", unit: "lump_sum" });
  const later = row("Death benefit", atYearFigure({ kind: "printed", amount: 250000, currency: "SGD", unit: "lump_sum" }, { policyYear: 20 }), { policyYear: 20 });
  assert.deepEqual(keyBenefits([later, now]), [1], "the current death benefit leads; the year-20 row never does");
  assert.deepEqual(keyBenefits([later]), []);
  assert.deepEqual(categoryRows("Death", [later, now] as never[]).map((r: { figure: Figure }) => r.figure.kind), ["printed"]);
});

if (failures.length) { console.error(failures.join("\n")); console.error(`${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`term-dates: ${passed} passed`);
