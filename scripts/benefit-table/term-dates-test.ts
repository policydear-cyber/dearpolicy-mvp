/** A cover's premium end date, premium term and maturity date, and a value's age, policy year and illustrated rate (DC 19
 * Nov: "how long more he needs to pay and how much he can receive at maturity or a projection at each stage of life"):
 * each kept only where the page prints it, never worked out. Invented schedules and illustrations. Pure; no network.
 *   node --import tsx scripts/benefit-table/term-dates-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { byYearOnly, checkReading, termDates, valueAt, type SourceDoc } from "@/lib/benefit-table/check";
import { assembleTable } from "@/lib/benefit-table/assemble";
import { READING_PROMPT, READING_SCHEMA } from "@/lib/benefit-table/reading";
import { atYearFigure, type Figure } from "@/lib/benefit-table/assemble";
import { keyBenefits, type SummaryRow } from "@/lib/benefit-table/headline";
import { categoryOfRow, categoryRows } from "@/lib/coverage/table-figures";

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

test("an age limit on an ordinary benefit is not a year it is printed for: the row stays the current death figure (Critic MED-8)", () => {
  const PERSON = "Lim Wei Jie";
  const line = "Death or TPD before age 70\tS$200,000";
  const src: SourceDoc = { id: "doc-1", name: "Schedule", readable: true, pages: [{ page: 1, text: `Life Assured: ${PERSON}\nPolicy Number: 55001234\nBenefit\tSum Assured\n${line}\nCurrency: Singapore Dollar` }] };
  const reading = checkReading(src, { document: { kind: "personal_proof", product: "Harbour Term", insurer: "Example Assurance", namedPeople: [PERSON], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: PERSON, product: "Harbour Term", cover: "Harbour Term", plan: null, riderOf: null, policyNumber: "55001234", premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, sumInsured: 200000, quote: line }],
    benefits: [{ section: null, column: "Sum Assured", benefit: "Death or TPD before age 70", pays: "amount", value: 200000, period: null, basis: null, asOf: null, percentOf: null,
      baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: line, atAge: 70 }] });
  const rows = assembleTable([reading], [{ id: "m1", display_name: PERSON }], []).people[0]?.rows ?? [];
  const death = rows.find((r) => /death/i.test(r.benefit));
  assert.ok(death, "the death row is on the table");
  assert.equal(death!.valueAt, undefined);
  assert.equal(death!.figure.kind, "printed");
  const category = categoryOfRow(death as never)!;
  assert.ok(category, "the row has a Home category");
  assert.deepEqual(categoryRows(category, rows as never[]).map((r: { figure: Figure }) => r.figure.kind), ["printed"], "it still reaches Home's card as it does on main");
});

test("a table by year keeps its ages and years whatever the reader called its rows; a lone age limit does not (Critic follow-up)", () => {
  const r = (benefit: string, pays: string, atPolicyYear?: number, column = "Guaranteed") => ({ benefit, column, pays, ...(atPolicyYear != null ? { atPolicyYear } : {}) });
  const out = byYearOnly([r("Death benefit", "amount", 10), r("Death Benefit", "amount", 20), r("Hospital cash up to age 18", "per_day", 18, "Daily"), r("Surrender value", "value", 5)]);
  assert.deepEqual(out.map((x) => (x as { atPolicyYear?: number }).atPolicyYear), [10, 20, undefined, 5]);
  const PERSON = "Lim Wei Jie";
  const lines = ["Policy Year\tAge\tGuaranteed Death Benefit", "10\t45\tS$150,000", "20\t55\tS$250,000"];
  const src: SourceDoc = { id: "doc-2", name: "Illustration", readable: true, pages: [{ page: 1, text: `Life Assured: ${PERSON}\nPolicy Number: 55001234\n${lines.join("\n")}\nCurrency: Singapore Dollar` }] };
  const row = (year: number, age: number, amount: number, line: string) => ({ section: null, column: "Guaranteed Death Benefit", benefit: "Death benefit", pays: "amount", value: amount, period: null, basis: null, asOf: null, percentOf: null,
    baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: line, atPolicyYear: year, atAge: age });
  const reading = checkReading(src, { document: { kind: "personal_proof", product: "Harbour Term", insurer: "Example Assurance", namedPeople: [PERSON], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: PERSON, product: "Harbour Term", cover: "Harbour Term", plan: null, riderOf: null, policyNumber: "55001234", premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, sumInsured: null, quote: lines[1] }],
    benefits: [row(10, 45, 150000, lines[1]), row(20, 55, 250000, lines[2])] });
  const rows = assembleTable([reading], [{ id: "m1", display_name: PERSON }], []).people[0]?.rows ?? [];
  const deaths = rows.filter((x) => /death/i.test(x.benefit));
  assert.ok(deaths.length >= 1);
  assert.ok(deaths.every((x) => x.figure.kind === "value" && !!x.valueAt), "a year-N death benefit is a value as of that year, never a current amount");
  assert.deepEqual(categoryRows("Death", rows as never[]), []);
});

test("a step-down schedule's two ages are age limits, not a table by year: both rows stay current figures (Critic MED-9)", () => {
  const r = (benefit: string, atAge: number, pays = "amount") => ({ benefit, section: null, column: "Sum Assured", pays, atAge });
  const kept = (rows: ReturnType<typeof r>[]) => byYearOnly(rows).map((x) => (x as { atAge?: number }).atAge ?? null);
  assert.deepEqual(kept([r("Death benefit", 65), r("Death benefit", 70)]), [null, null], "before age 65 / from 65 to 70");
  assert.deepEqual(kept([r("Hospital income", 17), r("Hospital income", 18)]), [null, null]);
  assert.deepEqual(kept([r("Death benefit", 45), r("Death benefit", 50), r("Death benefit", 55)]), [45, 50, 55], "three ages: an illustration");
  assert.deepEqual(kept([r("Death benefit", 65), r("TPD benefit", 70), r("CI benefit", 75)]), [null, null, null], "different benefits never pair");
});

test("an age band is never an age a value is printed for, even with three bands (TE F5)", () => {
  const r = (atAge: number, quote: string) => ({ benefit: "Death benefit", section: null, column: "Sum Assured", pays: "amount", atAge, quote });
  const out = byYearOnly([r(40, "Death benefit before age 40 S$80,000"), r(60, "Death benefit from age 60 S$40,000"), r(70, "Death benefit age 60 to 70 S$20,000")]);
  assert.deepEqual(out.map((x) => (x as { atAge?: number }).atAge ?? null), [null, null, null]);
  const ill = byYearOnly([r(45, "10 45 150,000"), r(50, "15 50 180,000"), r(55, "20 55 250,000")]);
  assert.deepEqual(ill.map((x) => (x as { atAge?: number }).atAge ?? null), [45, 50, 55], "an illustration's rows keep their ages");
});

test("a table by year keeps its years whatever words sit beside them; the band test never reads an amount (Critic MED-11)", () => {
  const r = (atPolicyYear: number, atAge: number, quote: string, pays = "amount", benefit = "Guaranteed death benefit (payable up to age 100)") => ({ benefit, section: null, column: "Guaranteed", pays, atPolicyYear, atAge, quote });
  const table = byYearOnly([r(10, 45, "10 45 150,000"), r(20, 55, "20 55 250,000")]);
  assert.deepEqual(table.map((x) => (x as { atPolicyYear?: number }).atPolicyYear ?? null), [10, 20], "case 9's table with 'payable up to age 100' in its name");
  const value = byYearOnly([r(20, 55, "Guaranteed death benefit (payable up to age 100) 20 55 150,000", "value")]);
  assert.equal((value[0] as { atAge?: number }).atAge, 55, "a value row is never band-tested");
  const amounts = byYearOnly([1, 2, 3].map((i) => ({ benefit: "Death benefit", section: null, column: "Total", pays: "amount", atAge: 50 + i * 5, quote: `Death benefit ${10 + i * 5} ${50 + i * 5} Age ${50 + i * 5} - 120,500` })));
  assert.deepEqual(amounts.map((x) => (x as { atAge?: number }).atAge ?? null), [55, 60, 65], "'Age 55 - 120,500' is an age and an amount, not a band");
});

test("policy-year bands are limits, not a table by year: both stay current figures (TE F6)", () => {
  const r = (atPolicyYear: number, quote: string) => ({ benefit: "Death benefit", section: null, column: "Sum Assured", pays: "amount", atPolicyYear, quote });
  const kept = (rows: ReturnType<typeof r>[]) => byYearOnly(rows).map((x) => (x as { atPolicyYear?: number }).atPolicyYear ?? null);
  assert.deepEqual(kept([r(1, "Death benefit during policy year 1: S$20,000"), r(2, "Death benefit from policy year 2: S$40,000")]), [null, null]);
  assert.deepEqual(kept([r(1, "Policy year 1 to 5 S$20,000"), r(6, "Year 6 onwards S$40,000")]), [null, null]);
  assert.deepEqual(kept([r(10, "10 45 150,000"), r(20, "20 55 250,000")]), [10, 20], "a bare table by year keeps its years");
});

if (failures.length) { console.error(failures.join("\n")); console.error(`${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`term-dates: ${passed} passed`);
