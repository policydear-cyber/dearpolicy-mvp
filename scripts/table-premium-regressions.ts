/**
 * Home's cost counts a policy with no premium record from the premium its own document prints, as the benefit table has
 * checked it (lib/policies/premium-summary.ts tablePremiumItems), and only when what is paid now is certain. Made-up
 * households in three markets. No database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { premiumsPerYear, tablePremiumItems, type TablePremiumCover, type TablePremiumDocument } from "@/lib/policies/premium-summary";
import { checkReading } from "@/lib/benefit-table/check";
import { printedDay } from "@/lib/benefit-table/dates";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const day = (s: string) => printedDay(s)!;
const TODAY = day("28/10/2026");
const src = (documentId: string, excerpt = "Instalment Premium : 100.00") => ({ documentId, document: documentId + ".pdf", page: 1, excerpt });
const cover = (over: Partial<TablePremiumCover> & { doc?: string }): TablePremiumCover => {
  const { doc = "doc-a", ...rest } = over;
  return { product: "Harbour Critical Illness", cover: "Critical Illness Benefit", plan: null, policyNumber: null, premium: 100, premiumFrequency: "Monthly", currency: "SGD",
    premiumCurrency: "SGD", premiumNote: null, firstYearPremium: null, firstYearFrom: null, startDate: null, endDate: null, documentPeriodFrom: "01/03/2026", documentPeriodTo: "01/03/2046",
    source: src(doc) as never, premiumSource: null, ended: null, ...rest };
};
type Rec = { policy_id: string | null; policy_number: string | null; product_name: string | null; amount: string; insurer: string | null };
const rec = (over: Partial<Rec>): Rec => ({ policy_id: "receipt-1", policy_number: null, product_name: "Travel Insurance", amount: "73.17", insurer: "Gull Travel Insurance", ...over });
const member = { id: "m1" };
const run = (covers: TablePremiumCover[], today = TODAY, records: Rec[] = [], documents = new Map<string, TablePremiumDocument>()) => tablePremiumItems(covers, records, member, today, documents);
const amounts = (covers: TablePremiumCover[], today = TODAY, records: Rec[] = [], documents?: Map<string, TablePremiumDocument>) =>
  run(covers, today, records, documents).items.map((i) => [i.product_name, i.amount, i.currency, Math.round(i.annual * 100) / 100]);

test("a monthly premium in each market's currency is counted yearly, in its own currency", () => {
  assert.deepEqual(amounts([cover({})]), [["Harbour Critical Illness", 100, "SGD", 1200]]);
  assert.deepEqual(amounts([cover({ product: "Pelan Kritikal", currency: "MYR", premiumCurrency: "MYR", premiumFrequency: "Bulanan", premium: 85.5 })]), [["Pelan Kritikal", 85.5, "MYR", 1026]]);
  assert.deepEqual(amounts([cover({ product: "Thames Income Protection", currency: "GBP", premiumCurrency: "GBP", premiumFrequency: "Annually", premium: 640 })]), [["Thames Income Protection", 640, "GBP", 640]]);
  // The premium line's own currency, never the cover's (check.ts premiumCurrency).
  assert.deepEqual(amounts([cover({ currency: "SGD", premiumCurrency: "USD" })]), [["Harbour Critical Illness", 100, "USD", 1200]]);
});

test("only an exact frequency is multiplied; any other wording leaves the premium out (TE pr158 F1)", () => {
  for (const [f, n] of [["Monthly", 12], ["MONTHLY", 12], ["Bulanan", 12], ["Quarterly", 4], ["Half-Yearly", 2], ["Semi-annual", 2], ["Annual", 1], ["Yearly", 1], ["Per annum", 1], ["p.a.", 1], ["Tahunan", 1], ["Fortnightly", 26], ["Weekly", 52]] as const)
    assert.equal(premiumsPerYear(f), n, f);
  for (const f of ["6-monthly", "6 Monthly", "3-monthly", "Every 3 months", "Bi-monthly", "Every 2 months", "Semi-monthly", "Twice monthly", "Biannual", "Bi-annually", "Every two years",
    "Annual (paid by employer)", "Yearly, payable for 5 years", "10 years", "Limited pay 5 years", "Single", "One-off", "", "N.A."]) {
    assert.equal(premiumsPerYear(f), null, f);
    assert.deepEqual(amounts([cover({ premiumFrequency: f })]), [], f);
  }
});

test("a page that prints a first-year premium: that figure in the first policy year, the other from the anniversary", () => {
  const c = cover({ premium: 470.85, firstYearPremium: 376.68, premiumNote: "the page prints a different premium for the first policy year", firstYearFrom: "19/10/2026", documentPeriodFrom: "19/10/2026" });
  const [first] = run([c]).items;
  assert.equal(first.amount, 376.68); assert.equal(Math.round(first.annual * 100) / 100, 4520.16);
  assert.equal(first.detail, "first policy year; S$470.85 monthly from 19 October 2027");
  assert.equal(run([c], day("18/10/2027")).items[0].amount, 376.68, "the day before the anniversary");
  assert.equal(run([c], day("19/10/2027")).items[0].amount, 470.85, "from the anniversary");
  assert.equal(run([c], day("19/10/2027")).items[0].detail, null);
  // Before cover starts, the first premium due is the first-year one.
  assert.equal(run([c], day("01/10/2026")).items[0].amount, 376.68);
  // The cover's own start date wins over the labelled policy start.
  assert.equal(run([{ ...c, startDate: "19/10/2025" }]).items[0].amount, 470.85);
  // A policy that starts on 29 February has its anniversary on 1 March.
  const leap = { ...c, firstYearFrom: "29/02/2028", documentPeriodFrom: "29/02/2028" };
  assert.equal(run([leap], day("28/02/2029")).items[0].amount, 376.68);
  assert.equal(run([leap], day("01/03/2029")).items[0].amount, 470.85);
  // A document's period may start at a renewal or a letter: it never starts the first policy year (Critic R284 M3, TE Y4).
  const renewal = { ...c, firstYearFrom: null, documentPeriodFrom: "01/10/2026" };
  assert.deepEqual(run([renewal]).items, []);
  assert.deepEqual(run([renewal]).leftOut, [{ name: "Harbour Critical Illness", why: "not_current" }]);
});

test("anything unsure is left out, never guessed", () => {
  const none = (c: TablePremiumCover, why: string) => assert.deepEqual(amounts([c]), [], why);
  none(cover({ premiumCurrency: null, currency: null }), "no currency");
  none(cover({ premiumCurrency: undefined, currency: null }), "no currency on the cover either");
  none(cover({ premiumFrequency: null }), "no payment frequency: a trip's premium is not yearly");
  none(cover({ premium: null }), "no premium");
  none(cover({ premium: 0 }), "a zero premium");
  none(cover({ ended: "04/10/2026" }), "a trip that has ended");
  none(cover({ firstYearPremium: 80, firstYearFrom: null }), "a first-year premium with no policy start");
  none(cover({ premiumNote: "the page prints a different premium for the first policy year", firstYearPremium: null }), "a first-year premium the page prints but that could not be read");
  none(cover({ firstYearPremium: 80, firstYearFrom: "sometime in 2026" }), "a start date that is not a date");
});

test("a document that is not current, or says the policy lapsed or ended, gives no figure and is named (Critic R284 H2, M1)", () => {
  const old = cover({ documentPeriodFrom: "01/01/2019", documentPeriodTo: "31/12/2019" });
  assert.deepEqual(run([old]).items, []);
  assert.deepEqual(run([old]).leftOut, [{ name: "Harbour Critical Illness", why: "not_current" }]);
  assert.deepEqual(amounts([cover({ endDate: "01/10/2026" })]), [], "the cover's own printed end is past");
  assert.deepEqual(amounts([cover({ documentPeriodTo: null, documentPeriodFrom: "01/01/2024" })]), [], "no end printed, and it started long ago");
  assert.equal(amounts([cover({ documentPeriodTo: null, documentPeriodFrom: "01/03/2026" })]).length, 1, "no end printed, started this year");
  assert.equal(amounts([cover({ documentPeriodTo: null, documentPeriodFrom: null })]).length, 0, "no period printed at all");
  const lapsed = new Map([["doc-a", { insurer: "Harbour Life", lapsedOrEnded: true }]]);
  assert.deepEqual(amounts([cover({})], TODAY, [], lapsed), []);
  assert.deepEqual(run([cover({})], TODAY, [], lapsed).leftOut, [{ name: "Harbour Critical Illness", why: "not_current" }]);
});

test("a policy a premium record may be is never counted twice (TE pr158 F2, Critic R284 H1)", () => {
  const c = cover({ policyNumber: "LT-00918273", product: "Term Shield" });
  const none = (r: Rec, why: string) => assert.deepEqual(amounts([c], TODAY, [r]), [], why);
  none(rec({ policy_id: "doc-a" }), "a record from the same document");
  none(rec({ policy_number: "lt 00918273", product_name: null }), "the same number in another format");
  none(rec({ policy_number: "LT918273", product_name: null }), "the number without its leading zeros");
  none(rec({ policy_number: "LT-00918273-01", product_name: null }), "the number with a suffix");
  none(rec({ product_name: "Lionrock Life Term Shield" }), "the insurer before the product");
  none(rec({ product_name: "Term Shield Plan" }), "Plan after the product");
  none(rec({ product_name: "TERM-SHIELD (with rider)" }), "with rider after the product");
  none(rec({ product_name: "Lionrock Protect", amount: "100.00" }), "the same amount, other words");
  const harbour = new Map([["doc-a", { insurer: "Harbour Life", lapsedOrEnded: false }]]);
  assert.deepEqual(amounts([cover({ product: "Harbour Protect" })], TODAY, [rec({ product_name: "Lionrock Protect", insurer: "Harbour Life", policy_number: "X-1" })], harbour), [], "the same insurer, the cover and its document print no number");
  assert.deepEqual(amounts([c], TODAY, [rec({ product_name: "Lionrock Protect", insurer: "Harbour Life", policy_number: null })], harbour), [], "the same insurer, the record prints no number");
  // The document's own number tells two policies of one insurer apart when the reading gave the cover none.
  assert.equal(amounts([cover({ product: "Harbour Protect" })], TODAY, [rec({ product_name: "Lionrock Protect", insurer: "Harbour Life", policy_number: "X-1" })],
    new Map([["doc-a", { insurer: "Harbour Life", policyNumber: "HP-778", lapsedOrEnded: false }]])).length, 1);
  // Another policy's record changes nothing.
  assert.equal(amounts([c], TODAY, [rec({ policy_number: "OTHER-1" })], new Map([["doc-a", { insurer: "Harbour Life", lapsedOrEnded: false }]])).length, 1);
  // The same insurer with two different printed numbers are two policies.
  assert.equal(amounts([c], TODAY, [rec({ insurer: "Harbour Life", policy_number: "HL-55" })], new Map([["doc-a", { insurer: "Harbour Life", lapsedOrEnded: false }]])).length, 1);
});

test("a record for the first-year amount covers the cover too", () => {
  const c = cover({ premium: 100, firstYearPremium: 80, firstYearFrom: "01/03/2026" });
  assert.deepEqual(amounts([c], TODAY, [rec({ product_name: "Lionrock Protect", amount: "80.00" })]), []);
});

test("one premium per policy: printed twice counts once; two documents that may be one policy count neither (TE pr158 F3, Critic R284 M2)", () => {
  assert.equal(amounts([cover({}), cover({ cover: "Death Benefit" })]).length, 1, "a benefit and its death benefit print one premium");
  assert.equal(amounts([cover({}), cover({ source: src("doc-a", "Summary: premium 100.00 monthly") as never })]).length, 1, "the same premium on two pages of one document");
  assert.equal(amounts([cover({}), cover({ product: "Harbour CI Plus", source: src("doc-a", "Instalment Premium : 100.00") as never })]).length, 1, "two covers quoting one premium line");
  // A basic plan and its rider, each with its own premium on one schedule, are two premiums.
  const rider = cover({ product: "Harbour Early Rider", premium: 30, source: src("doc-a", "Early Rider\t30.00") as never });
  assert.deepEqual(amounts([cover({}), rider]).map((x) => x[1]), [100, 30]);
  assert.deepEqual(amounts([cover({}), cover({ doc: "doc-b", premium: 120 })]), [], "the same product on two documents");
  assert.deepEqual(amounts([cover({}), cover({ doc: "doc-b", product: "Harbour Critical-Illness Plan", premium: 100 })]), [], "spelled differently, no number");
  assert.deepEqual(amounts([cover({ policyNumber: "00918273" }), cover({ doc: "doc-b", product: "Renamed plan", policyNumber: "918273" })]), [], "one number with and without zeros");
  assert.equal(amounts([cover({}), cover({ doc: "doc-b", product: "Thames Term", policyNumber: "TT-9" })]).length, 2, "two different policies");
});

test("no household, insurer or product is written into the premium code", async () => {
  const { readFile } = await import("node:fs/promises");
  const code = await readFile("lib/policies/premium-summary.ts", "utf8");
  assert.doesNotMatch(code, /Singlife|Desmond|Charmaine|Comprehensive Critical|470\.85|376\.68/i);
});

test("the first policy year starts at the policy start the premium's page labels, never an issue date", () => {
  const read = (text: string) => checkReading({ id: "d1", name: "s.pdf", readable: true, people: ["Lim Ah Kow"], pages: [{ page: 3, text }] },
    { document: { kind: "personal_proof", product: "Harbour CI", namedPeople: ["Lim Ah Kow"] }, covers: [{ page: 3, person: "Lim Ah Kow", product: "Harbour CI", cover: "Critical Illness Benefit", plan: null,
      quote: "Critical Illness Benefit\t300,000.00\t269.05", sumInsured: 300000 }], benefits: [] }).covers[0];
  const page = (dates: string) => `Policy Schedule\n${dates}\nAssured\t: Lim Ah Kow\nFirst Year Instalment Premium * : 376.68\n: Singapore Dollar\nInstalment Premium\t: 470.85\tCurrency\nPayment Frequency\t: Monthly\nCritical Illness Benefit\t300,000.00\t269.05`;
  assert.equal(read(page("Policy Number\t: 1234\tPolicy Issue Date\t: 20/10/2026\nPolicy Effective Date\t: 19/10/2026\tPolicy Expiry Date\t: 19/10/2036")).firstYearFrom, "19/10/2026");
  assert.equal(read(page("POLICY START DATE\t27 JUN 2020")).firstYearFrom, "27 JUN 2020", "a schedule that sets label and value apart by a tab");
  assert.equal(read(page("Commencement Date: 1 March 2026")).firstYearFrom, "1 March 2026");
  assert.equal(read(page("Policy Issue Date\t: 20/10/2026")).firstYearFrom, null, "an issue date is not the start");
  assert.equal(read(page("Policy Effective Date\t: 19/10/2026\nCommencement Date : 01/11/2026")).firstYearFrom, null, "two different starts");
});

test("an unsure drop is always named; numbers that differ are different policies (TE pr158 O1-O4, Y6)", () => {
  // O1: two policies of one product with different printed numbers are both counted.
  assert.deepEqual(amounts([cover({ product: "Term Shield", policyNumber: "LT11112222", premium: 50 }), cover({ doc: "doc-b", product: "Term Shield", policyNumber: "LT33334444", premium: 80 })]).map((x) => x[1]), [50, 80]);
  // Two documents that may be one policy: neither is counted, and both are named.
  const twice = run([cover({}), cover({ doc: "doc-b", premium: 120 })]);
  assert.deepEqual(twice.items, []); assert.deepEqual(twice.leftOut, [{ name: "Harbour Critical Illness", why: "two_documents" }]);
  // O2: a record of the same amount for another insurer's numbered policy, against a numbered cover: different policies.
  assert.equal(amounts([cover({ product: "Harbourline Saver", policyNumber: "HB-1" })], TODAY, [rec({ product_name: "Thamesgate Protect", amount: "100.00", policy_number: "TG-9" })]).length, 1);
  // The same amount with no number to tell them apart: left out and named.
  const same = run([cover({ product: "Harbourline Saver" })], TODAY, [rec({ product_name: "Thamesgate Protect", amount: "100.00" })]);
  assert.deepEqual(same.items, []); assert.deepEqual(same.leftOut, [{ name: "Harbourline Saver", why: "maybe_counted" }]);
  // O3: a record named just "Plan" does not stop "Hospital Plan".
  assert.equal(amounts([cover({ product: "Hospital Plan" })], TODAY, [rec({ product_name: "Plan", amount: "12.00", insurer: null })]).length, 1);
  // O4: a same-insurer record for a numbered policy, against a cover with no number anywhere: left out and named.
  const ins = run([cover({ product: "Harbour Protect" })], TODAY, [rec({ product_name: "Harbour Saver Max", insurer: "Harbour Life", policy_number: "HL-55" })], new Map([["doc-a", { insurer: "Harbour Life", lapsedOrEnded: false }]]));
  assert.deepEqual(ins.leftOut, [{ name: "Harbour Protect", why: "maybe_counted" }]);
  // Y6: a renewal period that started this year counts as current even when the policy started years ago.
  assert.equal(amounts([cover({ startDate: "01/01/2024", documentPeriodFrom: "01/01/2026", documentPeriodTo: null })]).length, 1);
});

