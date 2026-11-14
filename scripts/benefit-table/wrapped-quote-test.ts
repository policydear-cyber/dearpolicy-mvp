/** A table row whose cells wrap over two or more printed lines, quoted in reading order (TE R3 H2-A t2, made-up documents
 * here). The page prints "Angioplasty and other invasive treatment for\t10% of the Sum Covered, up to a maximum of" over
 * "coronary artery\tRM 25,000"; the reader quoted each column's parts together, column by column, which is not the page's
 * order, so the row was dropped with "quote not found in this document" and its RM 20,000 (10% of RM 200,000, under the
 * RM 25,000 cap) was never shown.
 *
 * What this pins down (check.ts wrappedRowsAt):
 * - a quote that is exactly every cell of two to four consecutive printed lines of one row, column by column, is found:
 *   two- and three-line wraps, both columns wrapping or only the label, any currency, a plan table's columns;
 * - the row's cap is found when its words are one run of that reading ("up to a maximum of" over "RM 25,000"), and the
 *   amount is then worked out as for any capped share;
 * - never: parts from two rows, a part from another table, parts reordered so a figure moves to another benefit or plan,
 *   an extra figure, a repeated part, a part of the row left out, a quote with an ellipsis, or a row printed twice;
 * - a quote main already finds is found as before, from the same place.
 * No model, database or network.
 *   npm run benefit-table:wrapped-quote-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, wrappedRowsAt, type SourceDoc } from "@/lib/benefit-table/check";
import { dropQuotePointers } from "@/lib/benefit-table/chat";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const DOC = "eeeeeeee-0000-4000-8000-0000000000bb";
const PERSON = "Mira Halden";
const PRODUCT = "HEART CARE PLUS";
const schedule = (currency: string, sign: string, sum: string) => `Kestrel Mutual\n${PRODUCT} - POLICY SCHEDULE\nPerson covered: ${PERSON}\tCurrency: ${currency}\n`
  + `Benefit\tAmount\nSum covered (critical illness)\t${sign} ${sum}\n`;
const TABLE = (sign: string) => "BENEFIT PROVISIONS\nBenefit\tWhat is paid\n"
  + "Late-stage critical illness\t100% of the Sum Covered, less any\nearly-stage amount already paid\n"
  + `Angioplasty and other invasive treatment for\t10% of the Sum Covered, up to a maximum of\ncoronary artery\t${sign} 25,000\n`
  + `Hospital income (ICU)\t${sign} 300 per day of admission to an intensive\ncare unit, up to 30 days per year\n`
  + "Waiting period: no critical illness benefit is payable within 90 days of the cover start date.";
const ANGIO = (sign: string) => `Angioplasty and other invasive treatment for\tcoronary artery\t10% of the Sum Covered, up to a maximum of\n${sign} 25,000`;

const doc = (pages: string[]): SourceDoc => ({ id: DOC, name: "schedule.pdf", readable: true, pages: pages.map((text, i) => ({ page: i + 1, text })) });
const base = { column: null, period: null, basis: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [] as string[] };
function read(pages: string[], benefits: Record<string, unknown>[], sum = 200000, sign = "RM") {
  return checkReading(doc(pages), { document: { kind: "personal_proof", product: PRODUCT, insurer: "Kestrel Mutual", namedPeople: [PERSON], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: PERSON, product: PRODUCT, cover: "Critical illness", plan: null, policyNumber: null, sumInsured: sum, premium: null, premiumFrequency: null, asOf: null, startDate: null,
      endDate: null, page: 1, quote: `Sum covered (critical illness)\t${sign} ${sum.toLocaleString("en-US")}` }],
    benefits: benefits.map((b) => ({ ...base, section: "BENEFIT PROVISIONS", page: 2, ...b })) });
}
const angio = (sign = "RM", extra: Record<string, unknown> = {}) => ({ benefit: "Angioplasty and other invasive treatment for coronary artery", pays: "percent", value: 10, percentOf: "sum_insured",
  cap: 25000, capQuote: `up to a maximum of\n${sign} 25,000`, quote: ANGIO(sign), ...extra });
const rowOf = (r: ReturnType<typeof read>, name: RegExp) => r.benefits.find((b) => name.test(b.benefit));
const droppedFor = (r: ReturnType<typeof read>, name: RegExp) => r.dropped.filter((d) => name.test(d.what)).map((d) => d.why);
const family: FamilyMember[] = [{ id: "p1", display_name: PERSON }];
const tableOf = (r: ReturnType<typeof read>) => assembleTable([r], family,
  [...new Set(r.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: coverKeyOf({ product: PRODUCT, cover: "Critical illness", plan: null, riderOf: null }), why: "the schedule's benefits" })),
  [], new Date("2026-11-14T04:00:00Z"));

test("the wrapped two-column row is found, with its cap, from the row's own printed lines", () => {
  const r = read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), TABLE("RM")], [angio()]);
  const row = rowOf(r, /Angioplasty/);
  assert.ok(row, `kept: ${JSON.stringify(r.dropped)}`);
  assert.equal(row!.value, 10);
  assert.equal(row!.cap, 25000);
  assert.equal(row!.capUnread, false);
  assert.equal(row!.page, 2);
  // The page's own lines, as stored: the evidence shown is what the page prints, in its order.
  assert.equal(row!.source.excerpt, "Angioplasty and other invasive treatment for 10% of the Sum Covered, up to a maximum of\ncoronary artery RM 25,000");
  assert.deepEqual(droppedFor(r, /Angioplasty/), []);
});

test("its amount is worked out as 10% of RM 200,000, under the RM 25,000 cap: RM 20,000, for her", () => {
  const t = tableOf(read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), TABLE("RM")], [angio()]));
  const p = t.people.find((x) => x.name === PERSON);
  const row = p?.rows.find((x) => /Angioplasty/.test(x.benefit));
  assert.ok(row, JSON.stringify(t.people.map((x) => x.rows.map((y) => y.benefit))));
  assert.equal(row!.figure.kind, "worked_out", JSON.stringify(row!.figure));
  assert.equal((row!.figure as { amount: number }).amount, 20000);
  assert.equal((row!.figure as { currency: string }).currency, "MYR");
  // Over the cap, the cap is paid.
  const big = tableOf(read([schedule("Ringgit Malaysia (RM)", "RM", "400,000"), TABLE("RM")], [angio()], 400000)).people[0].rows.find((x) => /Angioplasty/.test(x.benefit));
  assert.equal((big!.figure as { amount: number }).amount, 25000);
});

test("other currencies: S$, GBP, € and USD wrap the same way", () => {
  for (const [sign, currency] of [["S$", "Singapore dollars (SGD)"], ["GBP", "Pounds sterling (GBP)"], ["€", "Euro (EUR)"], ["USD", "US dollars (USD)"]]) {
    const r = read([schedule(currency, sign, "200,000"), TABLE(sign)], [angio(sign)], 200000, sign);
    const row = rowOf(r, /Angioplasty/);
    assert.ok(row && row.cap === 25000 && !row.capUnread, `${sign}: ${JSON.stringify(r.dropped)}`);
  }
});

test("a three-line wrap of both columns, and of the label alone", () => {
  const page = "Benefit\tWhat is paid\nKidney dialysis and organ\t20% of the Sum Insured, subject to a\ntransplant surgery for the\tmaximum of S$40,000 per\ninsured person\tlifetime\n"
    + "Hospital cash\tS$100 per day\nEmergency medical evacuation and\tUS$ 50,000\nrepatriation of the\nbody\nDental treatment\tS$500";
  const r = read([schedule("Singapore dollars (SGD)", "S$", "200,000"), page], [
    { benefit: "Kidney dialysis and organ transplant surgery for the insured person", pays: "percent", value: 20, percentOf: "sum_insured", cap: 40000, capQuote: "subject to a maximum of S$40,000",
      quote: "Kidney dialysis and organ transplant surgery for the insured person\t20% of the Sum Insured, subject to a maximum of S$40,000 per lifetime" },
    { benefit: "Emergency medical evacuation and repatriation of the body", pays: "up_to", value: 50000, quote: "Emergency medical evacuation and repatriation of the body\tUS$ 50,000" },
  ], 200000, "S$");
  const kidney = rowOf(r, /Kidney/), evac = rowOf(r, /evacuation/);
  assert.ok(kidney, JSON.stringify(r.dropped));
  assert.equal(kidney!.cap, 40000);
  assert.equal(kidney!.capUnread, false);
  assert.ok(evac, JSON.stringify(r.dropped));
  assert.equal(evac!.value, 50000);
  assert.equal(evac!.currency, "USD");
});

test("a plan table: the label wraps under two plan columns, each figure stays with its plan", () => {
  const page = "Benefit\tPlan A\tPlan B\nAccidental loss of sight in\t£10,000\t£20,000\nboth eyes\nBroken bones\t£500\t£1,000";
  const q = (a: string, b: string) => `Accidental loss of sight in both eyes\t${a}\t${b}`;
  const r = read([schedule("Pounds sterling (GBP)", "£", "200,000"), page], [
    { benefit: "Accidental loss of sight in both eyes", column: "Plan A", pays: "amount", value: 10000, quote: q("£10,000", "£20,000") },
    { benefit: "Accidental loss of sight in both eyes", column: "Plan B", pays: "amount", value: 20000, quote: q("£10,000", "£20,000") },
  ], 200000, "£");
  assert.equal(r.benefits.filter((b) => /sight/.test(b.benefit)).length, 2, JSON.stringify(r.dropped));
  // Reordered so Plan A's figure is read as Plan B's: not the page's columns, never found.
  const swapped = read([schedule("Pounds sterling (GBP)", "£", "200,000"), page], [
    { benefit: "Accidental loss of sight in both eyes", column: "Plan B", pays: "amount", value: 10000, quote: q("£20,000", "£10,000") }], 200000, "£");
  assert.equal(rowOf(swapped, /sight/), undefined);
  assert.deepEqual(droppedFor(swapped, /sight/), ["quote not found in this document"]);
});

test("never: parts reordered so the figure and the cap swap places", () => {
  const r = read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), TABLE("RM")], [angio("RM", {
    quote: "Angioplasty and other invasive treatment for\tcoronary artery\tRM 25,000\t10% of the Sum Covered, up to a maximum of" })]);
  assert.equal(rowOf(r, /Angioplasty/), undefined);
  // The label's parts in another order are no reading of the page either.
  const r2 = read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), TABLE("RM")], [angio("RM", {
    quote: "coronary artery\tAngioplasty and other invasive treatment for\t10% of the Sum Covered, up to a maximum of\nRM 25,000" })]);
  assert.equal(rowOf(r2, /Angioplasty/), undefined);
});

test("never: an extra figure, a repeated part, or a part of the row left out", () => {
  for (const quote of [
    `${ANGIO("RM")} or RM 30,000`,
    "Angioplasty and other invasive treatment for\tcoronary artery\t15% of the Sum Covered, up to a maximum of\nRM 25,000",
    "Angioplasty and other invasive treatment for\tcoronary artery\tcoronary artery\t10% of the Sum Covered, up to a maximum of\nRM 25,000",
    "Angioplasty and other invasive treatment for\tcoronary artery\tRM 25,000",
    "Angioplasty and other invasive treatment for\tcoronary artery\t10% of the Sum Covered",
    "Angioplasty and other invasive treatment for\tcoronary artery\t10% of the Sum Covered ... RM 25,000",
  ]) {
    const r = read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), TABLE("RM")], [angio("RM", { quote })]);
    assert.equal(rowOf(r, /Angioplasty/), undefined, quote);
  }
  // The row runs on to a third line the quote leaves out ("once per lifetime"): the quote is not the whole row.
  const longer = TABLE("RM").replace("coronary artery\tRM 25,000\n", "coronary artery\tRM 25,000 per\nlifetime\n");
  assert.equal(rowOf(read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), longer], [angio()]), /Angioplasty/), undefined);
});

test("never: parts from two rows", () => {
  const page = "Benefit\tAmount\nHospital cash\tS$100 per day\nSurgical fees\tS$5,000\nOutpatient physiotherapy for\tS$80 per session\ninjuries\tS$50 per visit";
  for (const [benefit, value, quote] of [
    ["Hospital cash", 100, "Hospital cash\tSurgical fees\tS$100 per day\tS$5,000"],
    ["Hospital cash Surgical fees", 5000, "Hospital cash Surgical fees\tS$100 per day S$5,000"],
    // A next line whose figure does not carry on the cell above is another row's, even when its label is in lower case.
    ["Outpatient physiotherapy for injuries", 50, "Outpatient physiotherapy for injuries\tS$80 per session\tS$50 per visit"],
  ] as const) {
    const r = read([schedule("Singapore dollars (SGD)", "S$", "200,000"), page], [{ benefit, pays: "amount", value, quote }], 200000, "S$");
    assert.equal(r.benefits.filter((b) => b.benefit === benefit).length, 0, quote);
  }
  assert.deepEqual(wrappedRowsAt(page, "Outpatient physiotherapy for injuries\tS$80 per session\tS$50 per visit"), []);
});

test("never: a part from another table, or the line before carrying on into the quote's first line", () => {
  const page = "TABLE 1\nBenefit\tAmount\nAngioplasty and other invasive treatment for\t10% of the Sum Covered, up to a maximum of\nTABLE 2\nBenefit\tAmount\ncoronary artery\tRM 25,000";
  assert.equal(rowOf(read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), page], [angio()]), /Angioplasty/), undefined);
  // A quote that starts mid-row: its first line carries on the line above ("... treatment for" over "coronary artery").
  const mid = "Benefit\tAmount\nAngioplasty and other invasive treatment for\t10% of the Sum Covered, up to a maximum of\ncoronary artery and\tRM 25,000, or\nvalve surgery\tRM 30,000";
  assert.deepEqual(wrappedRowsAt(mid, "coronary artery and valve surgery\tRM 25,000, or RM 30,000"), []);
});

test("a row printed twice: the model's page decides; with no page, none", () => {
  const pages = [schedule("Ringgit Malaysia (RM)", "RM", "200,000"), TABLE("RM"), TABLE("RM")];
  const onPage3 = read(pages, [angio("RM", { page: 3 })]);
  assert.equal(rowOf(onPage3, /Angioplasty/)?.page, 3);
  const noPage = read(pages, [angio("RM", { page: null })]);
  assert.equal(rowOf(noPage, /Angioplasty/), undefined);
});

test("a cap whose words are not one run of the row's reading is not tied: no amount is worked out", () => {
  const r = read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), TABLE("RM")], [angio("RM", { capQuote: "up to a maximum of RM 25,000 per claim" })]);
  const row = rowOf(r, /Angioplasty/);
  assert.ok(row);
  assert.equal(row!.cap, null);
  assert.equal(row!.capUnread, true);
  // A cap figure the row does not print is never tied.
  const r2 = read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), TABLE("RM")], [angio("RM", { cap: 30000, capQuote: "up to a maximum of RM 30,000" })]);
  assert.equal(rowOf(r2, /Angioplasty/)?.cap, null);
  // The same cap words printed whole in another row: the wrapped row's own cap is still its own.
  const other = TABLE("RM").replace("Hospital income (ICU)", "Valve repair\t10% of the Sum Covered, up to a maximum of RM 25,000\nHospital income (ICU)");
  const r3 = read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), other], [angio("RM", { capQuote: "up to a maximum of RM 25,000" })]);
  assert.equal(rowOf(r3, /Angioplasty/)?.cap, 25000, JSON.stringify(r3.dropped));
  assert.equal(rowOf(r3, /Angioplasty/)?.capUnread, false);
});

test("quotes main finds are found as before, from the same place", () => {
  const r = read([schedule("Ringgit Malaysia (RM)", "RM", "200,000"), TABLE("RM")], [
    { benefit: "Late-stage critical illness", pays: "percent", value: 100, percentOf: "sum_insured", quote: "Late-stage critical illness\t100% of the Sum Covered, less any\nearly-stage amount already paid" },
    { benefit: "Hospital income (ICU)", pays: "per_day", value: 300, quote: "Hospital income (ICU)\tRM 300 per day of admission to an intensive\ncare unit, up to 30 days per year" },
    // The page's own order, read across the wrap: found by locateQuote, as on main.
    angio("RM", { quote: "Angioplasty and other invasive treatment for\t10% of the Sum Covered, up to a maximum of\ncoronary artery\tRM 25,000", capQuote: "up to a maximum of" }),
  ]);
  assert.equal(rowOf(r, /Late-stage/)?.source.excerpt, "Late-stage critical illness 100% of the Sum Covered, less any\nearly-stage amount already paid");
  assert.equal(rowOf(r, /Hospital income/)?.value, 300);
  assert.ok(rowOf(r, /Angioplasty/));
});

/** Gate round 3 probes (wq3, wq3b): "<words> is/are quoted below and REST" in an answer with no quote of it. With a listed
 * verb, or a listed adverb then a listed verb, the words keep REST ("The terms say RM 20,000", "The wording therefore pays
 * RM 20,000"); with a listed participle they keep "is"/"are" ("The wording is signed by the insurer"); else REST stands on
 * its own, capitalised, word for word ("Bed charges are paid up to RM 500 a day"). No figure or word of REST ever changes. */
const PROMISE_AND: [string, string][] = [
  ["The wording is quoted below and angioplasty pays RM 20,000.", "Angioplasty pays RM 20,000."],
  ["The terms are quoted below and Hafiz is not named in them.", "Hafiz is not named in them."],
  ["The terms are quoted below and are the same for Hafiz.", "The terms are the same for Hafiz."],
  ["The terms are quoted below and does not mention day surgery.", "The terms does not mention day surgery."],
  ["The terms are quoted below and were changed in 2023.", "The terms were changed in 2023."],
  ["The wording is quoted below and bed charges are paid up to RM 500 a day.", "Bed charges are paid up to RM 500 a day."],
  ["The wording is quoted below and bed and board is paid at RM 300 a day.", "Bed and board is paid at RM 300 a day."],
  ["The wording is quoted below and red tape applies.", "Red tape applies."],
  ["The wording is quoted below and shed fees are not covered.", "Shed fees are not covered."],
  ["The wording is quoted below and Ted is not named in it.", "Ted is not named in it."],
  ["The wording is quoted below and Ted pays nothing.", "Ted pays nothing."],
  ["The wording is quoted below and Fred is covered up to RM 10,000.", "Fred is covered up to RM 10,000."],
  ["The wording is quoted below and Ahmed is covered up to RM 10,000.", "Ahmed is covered up to RM 10,000."],
  ["The wording is quoted below and Mohamed is named in it.", "Mohamed is named in it."],
  ["The wording is quoted below and hundred ringgit is the excess.", "Hundred ringgit is the excess."],
  ["The wording is quoted below and seed money is excluded.", "Seed money is excluded."],
  ["The wording is quoted below and in Malay.", "In Malay."],
  ["The wording is quoted below and in Malay it says RM 20,000.", "In Malay it says RM 20,000."],
  ["The wording is quoted below, and in Malay the limit is RM 20,000.", "In Malay the limit is RM 20,000."],
  ["The wording is quoted below and not all claims are paid.", "Not all claims are paid."],
  ["The wording is quoted below and not every claim pays RM 20,000.", "Not every claim pays RM 20,000."],
  ["The wording is quoted below and all claims are paid within 30 days.", "All claims are paid within 30 days."],
  ["The wording is quoted below and only angioplasty pays RM 20,000.", "Only angioplasty pays RM 20,000."],
  ["The wording is quoted below and both plans pay RM 20,000.", "Both plans pay RM 20,000."],
  ["The wording is quoted below and still pays RM 20,000.", "The wording still pays RM 20,000."],
  ["The wording is quoted below and also covers angioplasty at RM 20,000.", "The wording also covers angioplasty at RM 20,000."],
  ["The wording is quoted below and covered claims pay RM 20,000.", "Covered claims pay RM 20,000."],
  ["The wording is quoted below and insured persons are paid RM 20,000.", "Insured persons are paid RM 20,000."],
  ["The wording is quoted below and limited cover is RM 20,000.", "Limited cover is RM 20,000."],
  ["The wording is quoted below and approved hospital stays pay RM 200 a day.", "Approved hospital stays pay RM 200 a day."],
  ["The wording is quoted below and hospitalised patients get RM 200 a day.", "Hospitalised patients get RM 200 a day."],
  ["The wording is quoted below and day surgery is paid in full.", "Day surgery is paid in full."],
  ["The wording is quoted below and up to RM 20,000 is paid.", "Up to RM 20,000 is paid."],
  ["The wording is quoted below and RM 20,000 is the limit.", "RM 20,000 is the limit."],
  ["The wording is quoted below and 10% of the Sum Covered is paid.", "10% of the Sum Covered is paid."],
  ["The wording is quoted below and for angioplasty the limit is RM 25,000.", "For angioplasty the limit is RM 25,000."],
  ["The wording is quoted below and under Plan A it pays RM 25,000.", "Under Plan A it pays RM 25,000."],
  ["The wording is quoted below and from day 91 cover starts.", "From day 91 cover starts."],
  ["The wording is quoted below and after 90 days it pays RM 25,000.", "After 90 days it pays RM 25,000."],
  ["The wording is quoted below and when diagnosed it pays RM 25,000.", "When diagnosed it pays RM 25,000."],
  ["The wording is quoted below and if diagnosed early it pays 25%.", "If diagnosed early it pays 25%."],
  ["The wording is quoted below and so is the exclusion.", "So is the exclusion."],
  ["The wording is quoted below and Hafiz and Aisyah are both named.", "Hafiz and Aisyah are both named."],
  ["The wording is quoted below and Hafiz's plan pays RM 20,000.", "Hafiz's plan pays RM 20,000."],
  ["The wording is quoted below and Hafiz’s plan pays RM 20,000.", "Hafiz’s plan pays RM 20,000."],
  ["The wording is quoted below and early-stage cover pays 25%.", "Early-stage cover pays 25%."],
  ["The wording is quoted below and late stage cover pays 100% of the sum.", "Late stage cover pays 100% of the sum."],
  ["The wording is quoted below and ICU pays RM 400 a day.", "ICU pays RM 400 a day."],
  ["The wording is quoted below and claims for ICU stays pay RM 400 a day.", "Claims for ICU stays pay RM 400 a day."],
  ["The wording is quoted below and claims made within the first year are limited to RM 5,000.", "Claims made within the first year are limited to RM 5,000."],
  ["The wording is quoted below and pays RM 20,000.", "The wording pays RM 20,000."],
  ["The wording is quoted below and states RM 20,000.", "The wording states RM 20,000."],
  ["The wording is quoted below and is clear.", "The wording is clear."],
  ["The wording is quoted below and needed for the claim.", "The wording is needed for the claim."],
  ["The wording is quoted below and signed by the insurer.", "The wording is signed by the insurer."],
  ["The wording is quoted below and dated 1 March 2024.", "The wording is dated 1 March 2024."],
  ["The wording is quoted below and limited to angioplasty.", "The wording is limited to angioplasty."],
  ["The wording is quoted below and used for every claim.", "The wording is used for every claim."],
  ["The wording is quoted below and paid claims are listed.", "Paid claims are listed."],
  ["The wording is quoted below and listed claims are paid.", "Listed claims are paid."],
  ["The wording is quoted below and need not be signed.", "The wording need not be signed."],
  ["The wording is quoted below but angioplasty pays RM 20,000.", "Angioplasty pays RM 20,000."],
  ["The wording is quoted below, but Hafiz is not named.", "Hafiz is not named."],
  ["The wording is quoted below so angioplasty pays RM 20,000.", "Angioplasty pays RM 20,000."],
  ["The clause is quoted below and the RM 20,000 limit applies.", "The RM 20,000 limit applies."],
  ["The clause is quoted below and its limit is RM 20,000.", "Its limit is RM 20,000."],
  ["The terms are quoted below and pay RM 20,000 for angioplasty.", "The terms pay RM 20,000 for angioplasty."],
  ["The terms are quoted below and say RM 20,000.", "The terms say RM 20,000."],
  ["The terms are quoted below and Plan B pays RM 30,000.", "Plan B pays RM 30,000."],
  ["The terms are quoted below and Section 4 sets the limit at RM 20,000.", "Section 4 sets the limit at RM 20,000."],
  ["The terms are quoted below and clause 4.2 limits it to RM 20,000.", "Clause 4.2 limits it to RM 20,000."],
  ["The terms are quoted below and coronary artery treatment is paid at 10%.", "Coronary artery treatment is paid at 10%."],
  ["The terms are quoted below and coronary artery bypass grafting is paid at 10%.", "Coronary artery bypass grafting is paid at 10%."],
  ["The terms are quoted below and invasive treatment for coronary artery pays 10%.", "Invasive treatment for coronary artery pays 10%."],
  ["The terms are quoted below and the amount is shown on the card.", "The amount is shown on the card."],
  ["The terms are quoted below and they say nothing about day surgery.", "They say nothing about day surgery."],
  ["The terms are quoted below and nothing is paid for day surgery.", "Nothing is paid for day surgery."],
  ["The terms are quoted below and none of it applies to Hafiz.", "None of it applies to Hafiz."],
  ["The terms are quoted below and neither plan pays for day surgery.", "Neither plan pays for day surgery."],
  ["The terms are quoted below and Dr Lim must certify the claim.", "Dr Lim must certify the claim."],
  ["The terms are quoted below and Mr Ahmad Bin Hassan Ali is named.", "Mr Ahmad Bin Hassan Ali is named."],
  ["The terms are quoted below and Tan Mei Ling Rachel is named in them.", "Tan Mei Ling Rachel is named in them."],
  ["The terms are quoted below and AIA Bhd pays RM 20,000.", "AIA Bhd pays RM 20,000."],
  ["The terms are quoted below and per claim RM 20,000 is paid.", "Per claim RM 20,000 is paid."],
  ["The terms are quoted below and each claim pays RM 20,000.", "Each claim pays RM 20,000."],
  ["The terms are quoted below and RM 20,000 per claim applies.", "RM 20,000 per claim applies."],
  ["The terms are quoted below and Medisave covers the rest.", "Medisave covers the rest."],
  ["The terms are quoted below and Medishield Life covers the rest.", "Medishield Life covers the rest."],
  ["The terms are quoted below and 30 days must pass before a claim.", "30 days must pass before a claim."],
  ["The terms are quoted below and pre-existing conditions are excluded.", "Pre-existing conditions are excluded."],
  ["The terms are quoted below and well-documented claims are paid.", "Well-documented claims are paid."],
  ["The terms are quoted below and red-flag symptoms need a doctor.", "Red-flag symptoms need a doctor."],
  ["The terms are quoted below and the bed charge is RM 500.", "The bed charge is RM 500."],
  ["The terms are quoted below and bed is RM 500 a night.", "Bed is RM 500 a night."],
  ["The terms are quoted below and booked rooms are paid.", "Booked rooms are paid."],
  ["The wording is quoted below and therefore pays RM 20,000.", "The wording therefore pays RM 20,000."],
  ["The wording is quoted below and in turn pays RM 20,000.", "The wording in turn pays RM 20,000."],
  ["The wording is quoted below and clearly states RM 20,000.", "The wording clearly states RM 20,000."],
  ["The wording is quoted below and in full says RM 20,000.", "The wording in full says RM 20,000."],
  ["The wording is quoted below and on page 4 states RM 20,000.", "The wording on page 4 states RM 20,000."],
  ["The wording is quoted below and at clause 4.2 limits it to RM 20,000.", "At clause 4.2 limits it to RM 20,000."],
  ["The wording is quoted below and expressly excludes day surgery.", "The wording expressly excludes day surgery."],
  ["The terms are quoted below and together pay RM 20,000.", "The terms together pay RM 20,000."],
  ["The terms are quoted below and between them cover RM 20,000.", "The terms between them cover RM 20,000."],
  ["The clause is quoted below and only pays RM 20,000.", "The clause only pays RM 20,000."],
  ["The clause is quoted below and never pays more than RM 20,000.", "The clause never pays more than RM 20,000."],
  ["The clause is quoted below and still pays RM 20,000.", "The clause still pays RM 20,000."],
  ["The terms are quoted below and need not be signed.", "The terms need not be signed."],
  ["The clause is quoted below and does not mention day surgery.", "The clause does not mention day surgery."],
  ["The wording is quoted below and mentioned RM 20,000.", "Mentioned RM 20,000."],
  ["The wording is quoted below and updated in 2024 pays RM 20,000.", "Updated in 2024 pays RM 20,000."],
  ["The wording is quoted below and Ted.", "Ted."]
];
test("a promise of quoted words before 'and': the closed lists decide, and no word or figure after it changes (gate round 3)", () => {
  const ROWS = ["Angioplasty and other invasive treatment for coronary artery", "Early-stage critical illness", "Hospital income (ICU)", "Late-stage critical illness", "Hospital cash", "Hospital expenses"];
  for (const [input, want] of PROMISE_AND) {
    const a = { summary: input, bottomLine: input as string | null, citations: [], statements: [] as { text: string }[] };
    dropQuotePointers(a, [], ["Hafiz", "Aisyah"], ROWS);
    assert.equal(a.bottomLine, want, input);
    // Every figure of the sentence is still there.
    for (const f of input.match(/\d[\d,.]*%?/g) ?? []) assert.ok(a.bottomLine!.includes(f.replace(/\.$/, "")), `${input}: ${f}`);
  }
});

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`FAIL ${f}`);
if (failures.length) process.exit(1);
