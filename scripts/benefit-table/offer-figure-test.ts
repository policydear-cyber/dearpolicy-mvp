/** The most cover a plan offers is no benefit (live 17 Nov: a re-read of a scheme's product summary gave two "Maximum
 * coverage" rows, "up to S$1,000,000" and "up to S$600,000", read from its key-features lines "Be insured up to a maximum
 * coverage of S$1,000,000 at S$1.37 per day"). That is the most anyone may buy, not what a person holds: shown as a row it
 * reads as their cover, whatever they bought. A limit on a claim is kept. Synthetic pages, no model, database or network.
 *   npm run benefit-table:offer-figure-test */
import assert from "node:assert/strict";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const page = [
  "Group Term Life",
  "Key Features",
  "•\tBe insured up to a maximum coverage of S$800,000 at S$1.10 per day",
  "•\tGet covered for up to RM 250,000 with no medical check-up",
  "•\tChoose a sum insured of up to $500,000",
  "•\tMaximum sum assured: S$2,000,000",
  "•\tReceive 100% Advance Payment Benefit up to S$300,000 if diagnosed with Terminal Illness",
  "•\tCoverage up to S$250,000 against 37 critical illnesses",
  "•\tAmbulance cost up to S$500 per accident",
  "•\tDaily hospital cash S$40 per day from the 11th day",
].join("\n");
const src: SourceDoc = { id: "doc-offer", name: "Product summary.pdf", readable: true, pages: [{ page: 3, text: page }] };
const row = (benefit: string, pays: string, value: number, quote: string, extra: Record<string, unknown> = {}) => ({ section: "Group Term Life", column: null, benefit, pays, value, quote, page: 3,
  period: null, basis: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], fromDay: null, maxDays: null, ...extra });
const offers = [
  row("Maximum coverage", "up_to", 800000, "Be insured up to a maximum coverage of S$800,000 at S$1.10 per day"),
  row("Cover without check-up", "up_to", 250000, "Get covered for up to RM 250,000 with no medical check-up"),
  row("Sum insured", "up_to", 500000, "Choose a sum insured of up to $500,000"),
  row("Maximum sum assured", "amount", 2000000, "Maximum sum assured: S$2,000,000"),
];
const limits = [
  row("Advance Payment Benefit", "up_to", 300000, "Receive 100% Advance Payment Benefit up to S$300,000 if diagnosed with Terminal Illness"),
  row("Critical illness cover", "up_to", 250000, "Coverage up to S$250,000 against 37 critical illnesses"),
  row("Ambulance cost", "up_to", 500, "Ambulance cost up to S$500 per accident"),
  row("Daily hospital cash", "per_day", 40, "Daily hospital cash S$40 per day from the 11th day", { fromDay: 11 }),
];
const read = (kind: string, benefits: unknown[]) => checkReading(src, { document: { kind, product: "Group Term Life", insurer: null, namedPeople: [] }, covers: [], benefits });

test("the most cover a plan offers is left out of a summary, wording or illustration, with why", () => {
  for (const kind of ["product_summary", "scheme_terms", "policy_wording", "illustration", "other"]) {
    const r = read(kind, offers);
    assert.deepEqual(r.benefits.map((b) => b.benefit), [], kind);
    assert.equal(r.dropped.filter((d) => /most cover the plan offers/.test(d.why)).length, offers.length, kind);
  }
});
test("a limit on a claim is kept: an advance payment, a cover's own limit, a cost, a daily amount", () => {
  assert.deepEqual(read("product_summary", limits).benefits.map((b) => b.benefit), limits.map((l) => l.benefit));
});
test("on a personal schedule the words name the person's own cover, so the row is kept", () => {
  assert.deepEqual(read("personal_proof", offers.slice(0, 1)).benefits.map((b) => b.benefit), ["Maximum coverage"]);
});
test("one line printing the figure both as an offer and as a limit keeps the row", () => {
  const both: SourceDoc = { ...src, pages: [{ page: 3, text: "Be insured up to S$100,000. Accidental death pays S$100,000 on top of the death benefit" }] };
  const r = checkReading(both, { document: { kind: "product_summary" }, covers: [], benefits: [row("Accidental death", "amount", 100000, "Be insured up to S$100,000. Accidental death pays S$100,000 on top of the death benefit")] });
  assert.equal(r.benefits.length, 1);
});

console.log(`offer figure: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
if (failures.length) process.exit(1);
