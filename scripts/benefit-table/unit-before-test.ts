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
  ["Per day S$100 per year", ["?"]], ["RM 150 a day", ["day"]], ["Per night: £80 | £120", ["night", ""]],
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
for (const [name, line, v] of plans) check(`plans, no column: ${name}`, () => assert.equal(value(line, { pays: "per_day", value: v }), null));
check("a rate and its cap stay one plan's figures with the unit before", () => assert.equal(value("ICU per day S$600 up to S$18,000", { pays: "per_day", value: 600 }), 600));

// Schedule terms: units before each figure.
const terms: [string, boolean][] = [
  ["Per trip S$300 per trip S$500", true], ["S$300 per trip S$500 per trip", true], ["Per trip S$300 per year S$1,500", true /* as on main: held */],
  ["S$300 per trip, S$1,500 per year", false], ["Per claim S$100", false], ["Per disability S$5,000 per disability S$10,000", true],
];
for (const [quote, want] of terms) check(`term "${quote}" ${want ? "differs by plan" : "is one plan's"}`, () => assert.equal(termFiguresDifferByPlan(quote), want));

console.log(`unit-before: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
