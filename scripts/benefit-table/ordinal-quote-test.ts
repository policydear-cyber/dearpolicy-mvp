/** A quote that copies an ordinal the page's text layer lifted out as a superscript (live 17 Nov: the page stored "th" on a
 * line of its own and "S$30 per day from the 11\tday onwards." below it; the reading quoted "from the 11th day onwards." and
 * the hospital cash row was dropped as "quote not found"). Synthetic pages, no model, database or network.
 *   npm run benefit-table:ordinal-quote-test */
import assert from "node:assert/strict";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { locateQuote } from "@/lib/simple-chat/verify";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const lifted = "Benefits\n•\tDeath\t100% of Sum Insured\nth\n•\tDaily Hospital Cash Benefit\tS$40 per day from the 8\tday onwards.\nMax: 60 days of continuous hospitalisation";
const inline = "Notes\n2. S$40 per day Hospital Cash Benefit is payable from 8th to 67th day of the hospital stay.";
const src: SourceDoc = { id: "doc-ord", name: "Summary.pdf", readable: true, pages: [{ page: 4, text: lifted }, { page: 6, text: inline }] };
const household = { documents: [{ name: "Summary.pdf", pages: src.pages, processingStatus: "ready" }] } as unknown as Parameters<typeof locateQuote>[0];
const cash = (quote: string, page = 4) => ({ section: "1. Term Life", column: null, benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 40, fromDay: 8, maxDays: 60, quote, page,
  period: null, basis: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [] });
const read = (quote: string, page?: number) => checkReading(src, { document: { kind: "product_summary" }, covers: [], benefits: [cash(quote, page)] });

test("a quote with the ordinal's letters finds the line whose letters the page lifted out", () => {
  const r = read("Daily Hospital Cash Benefit\tS$40 per day from the 8th day onwards.\nMax: 60 days of continuous hospitalisation");
  assert.equal(r.benefits.length, 1, JSON.stringify(r.dropped));
  assert.equal(r.benefits[0].source.page, 4);
  assert.match(r.benefits[0].source.excerpt, /S\$40 per day from the 8 day onwards/);
});
test("a quote without the letters still finds a page that prints them, and one that does not", () => {
  assert.equal(read("S$40 per day Hospital Cash Benefit is payable from 8 to 67 day", 6).benefits.length, 1);
  assert.equal(read("S$40 per day Hospital Cash Benefit is payable from 8th to 67th day", 6).benefits.length, 1);
  assert.equal(read("Daily Hospital Cash Benefit S$40 per day from the 8 day onwards.").benefits.length, 1);
});
test("only an ordinal's letters after a number are ignored: other words and figures still have to match", () => {
  assert.equal(read("Daily Hospital Cash Benefit\tS$40 per day from the 9th day onwards.").benefits.length, 0, "another day");
  assert.equal(read("Daily Hospital Cash Benefit\tS$40 per day from the 8the day onwards.").benefits.length, 0, "a word, not an ordinal");
  assert.equal(locateQuote(household, "from the 8 day onwards", 0)?.page, 4);
  assert.equal(locateQuote(household, "the 8 thousandth day", 0), null, "a word after a space is not an ordinal's letters");
  // The numbers either side of an ordinal never run together (Critic #528 round 2).
  const joined = { documents: [{ name: "x.pdf", pages: [{ page: 1, text: "Paid for the 1st 30 days of a stay" }], processingStatus: "ready" }] } as unknown as Parameters<typeof locateQuote>[0];
  assert.equal(locateQuote(joined, "for the 130 days", 0), null);
  assert.equal(locateQuote(joined, "for the 1st 30 days", 0)?.page, 1);
  assert.equal(locateQuote(household, "payable from 8th to 67th day", 0)?.page, 6);
});

console.log(`ordinal quote: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
if (failures.length) process.exit(1);
