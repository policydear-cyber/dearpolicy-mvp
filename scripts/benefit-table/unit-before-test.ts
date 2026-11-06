/** A figure keeps the unit the page prints with it, whether printed after it ("S$100 per day") or before it ("Per day
 * S$100", "Per disability: S$5,000", "Daily S$80"): a figure printed as a rate is never shown as a whole amount or a cap,
 * a daily payment is never one printed per trip or per disability, and a line that prints its units before its figures
 * ("Per day S$100 per day S$200") is still seen as one figure per plan. Made-up English documents only; no model, no
 * network. */
import assert from "node:assert/strict";
import { checkReading } from "../../lib/benefit-table/check";
import { printedUnits } from "../../lib/insurance/printed-unit";
import { termFiguresDifferByPlan } from "../../lib/insurance/scale-limit";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n" + (e as Error).message); }
}

// The helper: each figure's unit, before or after it.
const MONEY = /(?:S\$|RM|£)\s?\d[\d,]*(?:\.\d+)?/g;
const unitsOf = (line: string) => printedUnits(line, [...line.matchAll(MONEY)].map((m) => ({ start: m.index!, end: m.index! + m[0].length })));
const helper: [string, string[]][] = [
  ["S$100 per day", ["day"]], ["Per day S$100", ["day"]], ["Per disability: S$5,000", ["disability"]], ["Daily S$80", ["day"]],
  ["Each trip up to S$500", ["trip"]], ["S$50/night", ["night"]], ["Overall limit S$150,000 per policy year", ["year"]], ["S$600,000", [""]],
  ["S$100 per day S$200 per day", ["day", "day"]], ["Per day S$100 per day S$200", ["day", "day"]],
  ["S$200 per day up to S$8,000", ["day", ""]], ["Per day S$200 up to S$8,000", ["day", ""]], ["S$100 per day S$3,000", ["day", ""]],
  ["Per trip S$300 per year S$1,500", ["trip", "year"]], ["S$300 per trip, S$1,500 per year", ["trip", "year"]],
  ["Per day S$100 per year", ["?"]], ["RM 150 a day", ["day"]], ["Per night: £80 | £120", ["night", "night"]],
  // Critic r376: a run of cells under one unit printed first; a unit and its cap; two units that are no rate.
  ["Per day: S$100 S$200 S$300", ["day", "day", "day"]], ["S$300 per day maximum S$9,000", ["day", ""]],
  ["Room and board per day S$300 per day maximum S$9,000", ["day", ""]], ["Each trip up to S$500 per person", ["trip"]],
  // TE r376: "per (insured) person" before another unit gives way to it.
  ["S$50 per person per day", ["day"]], ["S$200 per insured person per day", ["day"]], ["S$2,000 per insured person per month", ["month"]], ["Per insured person: S$2,000 a month", ["month"]], ["Per person S$50 per day", ["day"]],
  // Words that are no unit stay none.
  ["Hospital cash for day surgery S$100", [""]], ["Payable per the schedule S$500", [""]], ["Daily living S$500", [""]],
];
for (const [line, want] of helper) check(`units of "${line}"`, () => assert.deepEqual(unitsOf(line), want));

// Whole readings: the row's figure is shown only with the unit printed with it.
const PERSON = "Jordan Lee", PRODUCT = "Kestrel Hospital Care";
const row = (o: Record<string, unknown>) => ({ section: "BENEFITS", column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
  cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
const read = (text: string, benefits: Record<string, unknown>[]) => checkReading({ id: "bbbbbbbb-0000-0000-0000-000000000002", name: "care.pdf", readable: true, pages: [{ page: 1, text }] }, {
  document: { kind: "personal_proof", product: PRODUCT, insurer: null, namedPeople: [PERSON], plan: null, periodFrom: null, periodTo: null },
  covers: [{ person: PERSON, product: PRODUCT, cover: "Hospital", plan: null, riderOf: null, policyNumber: null, sumInsured: null, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: `Insured\t${PERSON}` }],
  benefits: benefits.map(row) } as never);
const header = `POLICY SCHEDULE\n${PRODUCT}\nInsured\t${PERSON}\nCurrency: Singapore Dollars\n`;
const value = (line: string, b: Record<string, unknown>) => read(header + line, [{ benefit: "Benefit", quote: line, ...b }]).benefits[0]?.value ?? null;

const kept: [string, string, Record<string, unknown>, number][] = [
  ["a daily rate printed after", "Hospital cash S$100 per day", { pays: "per_day", value: 100 }, 100],
  ["a daily rate printed before", "Hospital cash per day S$100", { pays: "per_day", value: 100 }, 100],
  ["a nightly rate before, with a colon", "Hotel stay - per night: S$80", { pays: "per_day", value: 80 }, 80],
  ["'Daily' before the figure", "Daily hospital income: Daily S$150", { pays: "per_day", value: 150 }, 150],
  ["a lump sum with no unit", "Accidental death S$100,000", { pays: "amount", value: 100000 }, 100000],
  ["a lump sum per disability", "Permanent disablement per disability S$50,000", { pays: "amount", value: 50000 }, 50000],
  ["a cap per trip", "Baggage delay - each trip up to S$500", { pays: "up_to", value: 500 }, 500],
  ["a cap per policy year", "Outpatient limit S$2,000 per policy year", { pays: "up_to", value: 2000 }, 2000],
  ["a yearly payment printed per year", "Annual income S$12,000 per year", { pays: "per_period", period: "year", value: 12000 }, 12000],
  ["a monthly payment printed before", "Disability income per month S$2,500", { pays: "per_period", period: "month", value: 2500 }, 2500],
  ["a rate and its cap, units after", "Room and board S$300 per day up to S$9,000", { pays: "per_day", value: 300 }, 300],
  ["the cap of a rate, read as a cap", "Room and board S$300 per day up to S$9,000", { pays: "up_to", value: 9000 }, 9000],
  ["a rate and its cap, unit before", "Room and board per day S$300 up to S$9,000", { pays: "per_day", value: 300 }, 300],
];
for (const [name, line, b, want] of kept) check(`kept: ${name}`, () => assert.equal(value(line, b), want));

const none: [string, string, Record<string, unknown>][] = [
  // A rate shown as a whole amount or a cap would lose its unit.
  ["a daily rate after, read as an amount", "Hospital cash S$100 per day", { pays: "amount", value: 100 }],
  ["a daily rate before, read as an amount", "Hospital cash per day S$100", { pays: "amount", value: 100 }],
  ["'Daily' before, read as a cap", "Daily S$150 hospital income", { pays: "up_to", value: 150 }],
  ["a nightly rate before, read as a cap", "Hotel stay - per night: S$80", { pays: "up_to", value: 80 }],
  ["a monthly rate read as an amount", "Disability income per month S$2,500", { pays: "amount", value: 2500 }],
  ["'up to' a daily rate read as a cap", "ICU up to S$600 per day", { pays: "up_to", value: 600 }],
  // A daily payment would pick up a unit the page does not print.
  ["a per-trip figure read as daily", "Travel delay per trip S$500", { pays: "per_day", value: 500 }],
  ["a per-disability figure read as daily", "Per disability: S$5,000", { pays: "per_day", value: 5000 }],
  ["a per-admission figure read as daily", "Hospital cash S$1,000 per admission", { pays: "per_day", value: 1000 }],
  ["a yearly figure read as monthly", "Income benefit S$12,000 per year", { pays: "per_period", period: "month", value: 12000 }],
  ["a daily figure read as yearly", "Per day S$100", { pays: "per_period", period: "year", value: 100 }],
  // Two units for one figure: no one unit is its own.
  ["a unit before and another after", "Benefit per day S$100 per year", { pays: "per_day", value: 100 }],
];
for (const [name, line, b] of none) check(`no figure: ${name}`, () => assert.equal(value(line, b), null));

// Plans: a line that prints its units before its figures is still one figure per plan, and a figure read with no plan
// column shows none (as the same line with units after does on main).
const plans: [string, string, number][] = [
  ["units after (unchanged)", "Hospital cash S$100 per day S$200 per day S$300 per day", 100],
  ["units before each figure", "Hospital cash per day S$100 per day S$200 per day S$300", 100],
  ["units before, second plan", "Hospital cash per day S$100 per day S$200 per day S$300", 200],
  ["units before, pipes", "Hotel stay per night S$80 | per night S$120", 80],
];
// Critic r376 P1-P4: a unit printed once before a run of plan cells covers the whole run.
plans.push(["one unit before the run", "Hospital cash Per day: S$100 S$200 S$300", 100], ["one unit, pipes", "Hotel Per night: S$80 | S$120", 80],
  ["'Daily' before the run", "Hospital income Daily S$100 S$200", 100]);
for (const [name, line, v] of plans) check(`plans, no column: ${name}`, () => assert.equal(value(line, { pays: "per_day", value: v }), null));
// TE r376 (merge seam with #374): a later cell with no unit of its own is in the run under the unit printed first, so
// cells that name their plan, their people or a setting are plans' cells, as with units after.
for (const u of ["Per day", "Daily", "Per night:"]) for (const v of [100, 200]) for (const tail of ["S$100 for Plan A, S$200 for Plan B", "S$100 | S$200 for each insured person",
  "S$100 and S$200 when admitted", "S$100 on Basic; S$200 on Premier"]) check(`plans, no column: "${u} ${tail}" (${v})`, () => assert.equal(value(`Hospital cash ${u} ${tail}`, { pays: "per_day", value: v }), null));
check("kept: a rate and its cap with the unit first, no plan", () => assert.equal(value("Hospital cash per day S$100 up to S$3,000", { pays: "up_to", value: 3000 }), 3000));
check("kept: a rate and its ICU rate, unit first", () => assert.equal(value("Hospital cash per day S$100 and S$200 per day in ICU", { pays: "per_day", value: 100 }), 100));
// TE r376 r5: a figure with its own unit after it keeps that unit; only a figure with no unit on either side takes the run's.
for (const [line, b, want] of [["Hospital cash per day S$100 or S$3,000 per year", { pays: "up_to", value: 3000 }, 3000], ["Hospital cash per day S$100 or S$3,000 per year", { pays: "per_day", value: 100 }, 100],
  ["Hospital cash per person S$100 per day, S$3,000 per year", { pays: "up_to", value: 3000 }, 3000], ["Hospital cash Per day S$100, S$3,000 per year", { pays: "up_to", value: 3000 }, 3000],
  ["Hospital cash Per day S$100, S$3,000 per year", { pays: "per_day", value: 100 }, 100]] as [string, Record<string, unknown>, number][])
  check(`kept: "${line}" (${b.value})`, () => assert.equal(value(line, b), want));
// Critic r376 R8: a unit phrase before the next figure is that figure's, so it does not part a cell from its run.
check("plans, no column: two runs, each with its unit first (R8)", () => assert.equal(value("Delay Per trip: S$500 S$1,000, per day S$50 S$100", { pays: "up_to", value: 500 }), null));
check("plans, no column: the second run (R8)", () => assert.equal(value("Delay Per trip: S$500 S$1,000, per day S$50 S$100", { pays: "per_day", value: 50 }), null));
check("kept: a rate, then its yearly cap with the unit after (Critic p376c)", () => assert.equal(value("Hospital cash Per day S$100 per day and S$3,000 per year", { pays: "per_day", value: 100 }), 100));
// Critic LOW r376: a cap word covers the bare cells after its figure, so side-by-side caps are plans' caps and a row read
// with no plan column shows none of them, units first or after. A cell with its own unit or another term after it, or
// set off in brackets, keeps its own reading.
for (const [line, b] of [["Hospital cash Per day: S$100 S$200 up to S$3,000 S$6,000", { pays: "up_to", value: 3000 }], ["Hospital cash Per day: S$100 S$200 up to S$3,000 S$6,000", { pays: "up_to", value: 6000 }],
  ["Room and board S$300 per day S$500 per day up to S$9,000 S$15,000", { pays: "up_to", value: 9000 }], ["Baggage up to S$500 S$1,000", { pays: "up_to", value: 500 }],
  ["Per trip up to S$5,000 | S$10,000 | S$15,000", { pays: "up_to", value: 10000 }], ["Medical expenses up to S$200,000 S$400,000 for each insured person", { pays: "up_to", value: 200000 }],
  ["Trip curtailment up to S$2,000, S$4,000", { pays: "up_to", value: 4000 }]] as [string, Record<string, unknown>][])
  check(`plans, no column: side-by-side caps "${line}" (${b.value})`, () => assert.equal(value(line, b), null));
for (const [line, b, want] of [["Baggage up to S$500 S$100 excess", { pays: "up_to", value: 500 }, 500], ["Medical up to S$200,000 (S$50,000 for age 70 and above)", { pays: "up_to", value: 200000 }, 200000],
  ["Room and board S$300 per day up to S$9,000", { pays: "up_to", value: 9000 }, 9000], ["Hospital cash per day S$100 up to S$3,000", { pays: "up_to", value: 3000 }, 3000],
  ["Overseas medical up to S$250,000 S$5,000 per day for ICU", { pays: "up_to", value: 250000 }, 250000]] as [string, Record<string, unknown>, number][])
  check(`kept: one cap "${line}" (${b.value})`, () => assert.equal(value(line, b), want));
check("per person before a run of lump sums is still plans (Critic r376 P4)", () => assert.equal(value("Accidental death per person S$100,000 S$200,000", { pays: "amount", value: 100000 }), null));
// Critic r376 P5-P7: real rows kept.
check("kept: per insured person before, a month after (TE r376 Q9)", () => assert.equal(value("Disability income per insured person: S$2,000 a month", { pays: "per_period", period: "month", value: 2000 }), 2000));
check("kept: per trip and per person on one cap", () => assert.equal(value("Baggage delay each trip up to S$500 per person", { pays: "up_to", value: 500 }), 500));
check("kept: a cap after a rate's unit and a cap word", () => assert.equal(value("Room and board per day S$300 per day maximum S$9,000", { pays: "up_to", value: 9000 }), 9000));
check("kept: the row's own line, not another line printing the same figure", () => {
  const text = header + "Hospital cash S$100 per day\nExcess S$100 per claim";
  const got = read(text, [{ benefit: "Hospital cash", pays: "per_day", value: 100, quote: "Hospital cash S$100 per day\nExcess S$100 per claim" }]);
  assert.equal(got.benefits[0]?.value, 100, JSON.stringify(got.dropped));
});
check("a rate and its cap stay one plan's figures with the unit before", () => assert.equal(value("ICU per day S$600 up to S$18,000", { pays: "per_day", value: 600 }), 600));

// Schedule terms: units before each figure.
const terms: [string, boolean][] = [
  ["Per trip S$300 per trip S$500", true], ["S$300 per trip S$500 per trip", true], ["Per trip S$300 per year S$1,500", true /* as on main: held */],
  ["S$300 per trip, S$1,500 per year", false], ["Per claim S$100", false], ["Per disability S$5,000 per disability S$10,000", true],
];
for (const [quote, want] of terms) check(`term "${quote}" ${want ? "differs by plan" : "is one plan's"}`, () => assert.equal(termFiguresDifferByPlan(quote), want));

console.log(`unit-before: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
