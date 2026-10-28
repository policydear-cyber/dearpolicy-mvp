/**
 * Home's cost counts a policy with no premium record from the premium its own document prints, as the benefit table has
 * checked it (lib/policies/premium-summary.ts tablePremiumItems), and only when what is paid now is certain. Made-up
 * households in three markets. No database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { premiumsPerYear, tablePremiumItems, unreadPremiumCovers, type TablePremiumCover, type TablePremiumDocument } from "@/lib/policies/premium-summary";
import { checkReading, stackedPremiumLines } from "@/lib/benefit-table/check";
import { printedDay } from "@/lib/benefit-table/dates";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const day = (s: string) => printedDay(s)!;
const TODAY = day("28/10/2026");
const src = (documentId: string, excerpt = "Instalment Premium : 100.00") => ({ documentId, document: documentId + ".pdf", page: 1, excerpt });
const cover = (over: Partial<TablePremiumCover> & { doc?: string }): TablePremiumCover => {
  const { doc = "doc-a", ...rest } = over;
  return { product: "Harbour Critical Illness", cover: "Critical Illness Benefit", plan: null, policyNumber: null, premium: 100, premiumFrequency: "Monthly", currency: "SGD",
    premiumCurrency: "SGD", premiumNote: null, firstYearPremium: null, firstYearFrom: null, startDate: null, endDate: null, documentPeriodFrom: "01/03/2026", documentPeriodTo: "01/03/2046", documentKind: "personal_proof",
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

test("only a personal schedule or certificate gives a current premium; a page that says the policy ended gives none (Critic R293 H1, M1)", async () => {
  const { ENDED_WORDS } = await import("@/lib/policies/premium-summary");
  for (const kind of ["letter", "policy_wording", "bill_or_receipt", "other", undefined] as const) {
    const r = run([cover({ documentKind: kind })]);
    assert.deepEqual(r.items, [], String(kind)); assert.deepEqual(r.leftOut, [{ name: "Harbour Critical Illness", why: "not_current" }], String(kind));
  }
  for (const t of ["Your policy was terminated with effect from 1 October 2026", "We have cancelled your policy on 3 Sept 2026", "The policy was surrendered on 2 May 2026",
    "This policy is void from inception", "Your policy is no longer in force", "Your policy has lapsed", "The plan lapsed on 1 Oct 2026"]) assert.match(t, ENDED_WORDS, t);
  // Words about what may happen, or a schedule's footnote, do not end a policy.
  for (const t of ["THE SUM INSURED DOES NOT REPRESENT THE AMOUNT TO BE PAID OUT FOR CLAIMS OR SURRENDER", "The policy will lapse if premiums are unpaid", "You may cancel within the free-look period",
    "Termination of policy: see clause 9", "Instalment Premium : 470.85"]) assert.doesNotMatch(t, ENDED_WORDS, t);
  const ended = run([cover({})], TODAY, [], new Map([["doc-a", { insurer: null, lapsedOrEnded: false, endedPages: [1] }]]));
  assert.deepEqual(ended.items, []); assert.deepEqual(ended.leftOut, [{ name: "Harbour Critical Illness", why: "not_current" }]);
  assert.equal(run([cover({})], TODAY, [], new Map([["doc-a", { insurer: null, lapsedOrEnded: false, endedPages: [7] }]])).items.length, 1, "another page of the document");
  // A cover with no product name is named by its insurer, or as one policy (never an empty name in the note).
  assert.deepEqual(run([cover({ product: "", documentKind: "letter" })], TODAY, [], new Map([["doc-a", { insurer: "Harbour Life", lapsedOrEnded: false }]])).leftOut, [{ name: "Harbour Life policy", why: "not_current" }]);
  assert.deepEqual(run([cover({ product: "", documentKind: "letter" })]).leftOut, [{ name: "one policy", why: "not_current" }]);
});

test("a record with another number but the same amount and insurer may be this policy (Critic R294 H1); an unclear premium is named", () => {
  const harbour = new Map([["doc-a", { insurer: "Harbour Life", policyNumber: "84339090", lapsedOrEnded: false }]]);
  const receipt = run([cover({ premium: 470.85 })], TODAY, [rec({ product_name: "Premium receipt", policy_number: "C98765", amount: "470.85", insurer: "Harbour Life Ltd" })], harbour);
  assert.deepEqual(receipt.items, []); assert.deepEqual(receipt.leftOut, [{ name: "Harbour Critical Illness", why: "maybe_counted" }]);
  // Another insurer, or another amount, with a different number: a different policy.
  assert.equal(run([cover({ premium: 470.85 })], TODAY, [rec({ policy_number: "C98765", amount: "470.85", insurer: "Gull Travel" })], harbour).items.length, 1);
  assert.equal(run([cover({ premium: 470.85 })], TODAY, [rec({ policy_number: "C98765", amount: "120.00", insurer: "Harbour Life" })], harbour).items.length, 1);
  assert.deepEqual(run([cover({ premiumFrequency: "6-monthly" })]).leftOut, [{ name: "Harbour Critical Illness", why: "unclear" }]);
  assert.deepEqual(run([cover({ premiumCurrency: null, currency: null })]).leftOut, [{ name: "Harbour Critical Illness", why: "unclear" }]);
});

// ---------------------------------------------------------------- the premium check reads a value set over its label

const schedule = (premiumLines: string, currency = "CURRENCY\tSINGAPORE DOLLARS", person = "LEE SIEW MEI", extra = "", sign = "S$") =>
  `SCHEDULE PAGE\nPOLICY NUMBER\nLIFE INSURED\t${person}\nPOLICY START DATE\t27 JUN 2020\nPLAN NAME\tHARBOUR SAVER 10\n${currency}\n${premiumLines}\nBASIC/CORE BENEFIT\tSUM INSURED\tBENEFIT START\nHARBOUR SAVER 10\t${sign}49,000.00\t27 JUN 2020\t27 JUN 2112${extra}`;
const readOne = (text: string, cover: Record<string, unknown> = {}, people = ["LEE SIEW MEI"], sign = "S$") =>
  checkReading({ id: "d1", name: "schedule.pdf", readable: true, people, pages: [{ page: 3, text }] },
    { document: { kind: "personal_proof", product: "HARBOUR SAVER 10", namedPeople: [people[0]] }, covers: [{ page: 3, person: people[0], product: "HARBOUR SAVER 10", cover: "HARBOUR SAVER 10", plan: null,
      quote: `HARBOUR SAVER 10\t${sign}49,000.00\t27 JUN 2020\t27 JUN 2112`, sumInsured: 49000, ...cover }], benefits: [] }).covers[0];

test("a premium figure set over (or under) its plain label is the policy's premium, in every market", () => {
  const sg = readOne(schedule("S$399.24 (MONTHLY)\nPREMIUM"));
  assert.deepEqual([sg.premium, sg.premiumCurrency, sg.premiumFrequency, sg.premiumLabel], [399.24, "SGD", "MONTHLY", "PREMIUM"]);
  // The reading gave it, quoting the figure line: kept, labelled by the line under it.
  const given = readOne(schedule("S$399.24 (MONTHLY)\nPREMIUM"), { premium: 399.24, premiumQuote: "S$399.24 (MONTHLY)", premiumFrequency: "monthly" });
  assert.deepEqual([given.premium, given.premiumLabel, given.premiumFrequency], [399.24, "PREMIUM", "monthly"]);
  const my = readOne(schedule("RM 150.00 (MONTHLY)\nPREMIUM", "MATA WANG\tRM", undefined, "", "RM"), {}, undefined, "RM");
  assert.deepEqual([my.premium, my.premiumCurrency, my.premiumFrequency], [150, "MYR", "MONTHLY"]);
  const uk = readOne(schedule("£45.00 Monthly\nTotal Premium", "CURRENCY\tGBP", undefined, "", "£"), {}, undefined, "£");
  // Blank lines between rows (PDF text) are not read.
  const gaps = readOne(schedule("\nS$399.24 (MONTHLY)\n\nPREMIUM\n"));
  assert.deepEqual([gaps.premium, gaps.premiumFrequency], [399.24, "MONTHLY"]);
  // A premium in another currency than the cover's own line is not this cover's (check.ts).
  assert.equal(readOne(schedule("RM 150.00 (MONTHLY)\nPREMIUM", "MATA WANG\tRM")).premium, null);
  assert.deepEqual([uk.premium, uk.premiumCurrency, uk.premiumFrequency], [45, "GBP", "Monthly"]);
  assert.deepEqual(stackedPremiumLines("CURRENCY\tSGD\nS$399.24 (MONTHLY)\nPREMIUM").map((x) => [x.amount, x.label, x.frequency]), [[399.24, "PREMIUM", "MONTHLY"]]);
  // At the page's top the figure's own label may be on the page before, so none.
  assert.deepEqual(stackedPremiumLines("S$399.24 (MONTHLY)\nPREMIUM"), []);
});

test("a stacked figure that is not plainly the one premium is never used", () => {
  const none = (text: string, why: string, cover: Record<string, unknown> = {}, people?: string[]) => assert.equal(readOne(text, cover, people).premium, null, why);
  none(schedule("PREMIUM\nS$399.24 (MONTHLY)\nPREMIUM"), "a label above and below: which one is not known");
  none(schedule("S$399.24 (MONTHLY)\nPREMIUM\nS$120.00 (MONTHLY)\nINSTALMENT PREMIUM"), "two premiums on the page, a label between them");
  none(schedule("S$399.24 (MONTHLY)\nPREMIUM\nPOLICY TERM\nS$120.00 (MONTHLY)\nINSTALMENT PREMIUM"), "two premiums on the page, apart");
  none(schedule("S$399.24 (MONTHLY)\nPREMIUM", undefined, undefined, "\nInstalment Premium\t: 120.00"), "a stacked and a same-line premium");
  none(schedule("S$399.24 (MONTHLY)\nRIDER PREMIUM"), "a label that qualifies the premium");
  none(schedule("S$399.24 (MONTHLY)\nSUM ASSURED"), "a label that is not a premium");
  none(schedule("S$399 (MONTHLY)\nPREMIUM"), "a whole figure is not read as a premium");
  none(schedule("S$399.24\t27 JUN 2030\nPREMIUM"), "a line with other cells is a table row, not a figure on its own");
  none(schedule("S$399.24 (MONTHLY)\nPREMIUM") + "\nLIFE INSURED 2\tTAN AH KOW", "another life on the page", {}, ["LEE SIEW MEI", "TAN AH KOW"]);
  // A reading's figure that is not the printed one is dropped; the page's own one premium line is used, as for a same-line one.
  assert.equal(readOne(schedule("S$399.24 (MONTHLY)\nPREMIUM"), { premium: 399.42, premiumQuote: "S$399.24 (MONTHLY)" }).premium, 399.24);
});

test("a stacked figure that another field could own is never the premium, in every market (TE pr161)", () => {
  const none = (text: string, why: string, cover: Record<string, unknown> = {}, sign = "S$") => assert.equal(readOne(text, cover, undefined, sign).premium, null, why);
  const markets: [string, string][] = [["S$", "CURRENCY\tSINGAPORE DOLLARS"], ["RM ", "MATA WANG\tRM"], ["£", "CURRENCY\tGBP"]];
  for (const [sign, currency] of markets) {
    const s = (lines: string) => schedule(lines, currency, undefined, "", sign.trim());
    const f = (n: string) => `${sign}${n}`;
    none(s(`SUM ASSURED\n${f("49,000.00")}\nPREMIUM\n${f("212.40")} per month`), `${sign} label above each value: the figure above PREMIUM is the sum assured`, {}, sign.trim());
    none(s(`POLICY FEE\n${f("12.00")}\nPREMIUM\nWaived`), `${sign} the figure above PREMIUM is the policy fee`, {}, sign.trim());
    none(s(`CASH VALUE AT YEAR 10\n${f("3,450.00")}\nPREMIUM`), `${sign} the figure above PREMIUM is another field's`, {}, sign.trim());
    none(s(`PREMIUM\n${f("212.40")}\n${f("37.60")}\n${f("250.00")}`), `${sign} a column of figures under one label`, {}, sign.trim());
    none(s(`${f("212.40")} (MONTHLY)\n${f("250.00")} (MONTHLY)\nPREMIUM`), `${sign} two figures over one label`, {}, sign.trim());
    none(s(`${f("212.40")} (MONTHLY)\nBASIC PREMIUM\n${f("37.60")} (MONTHLY)\nPREMIUM`), `${sign} a qualified label above the figure`, {}, sign.trim());
    // The mirror layout: a label above each value, the next line another field's label. Unsure, so none.
    none(s(`PREMIUM\n${f("212.40")} (MONTHLY)\nSUM ASSURED\n${f("49,000.00")}`), `${sign} the figure under PREMIUM sits over another field's label`, {}, sign.trim());
  }
  // A figure equal to the cover's sum insured is never its premium, from the reading or from the page.
  none(schedule("SUM ASSURED\tTERM (S$)\nS$49,000.00\nPREMIUM"), "the sum insured set over the premium label");
  none(schedule("S$49,000.00\nSUM ASSURED\nPREMIUM\nWaived"), "the reading gives the sum insured as the premium", { premium: 49000, premiumQuote: "S$49,000.00" });
  none(schedule("S$49,000.00\nPREMIUM"), "the reading quotes a stacked sum insured over PREMIUM", { premium: 49000, premiumQuote: "S$49,000.00" });
  none(schedule("S$49,000.00\nPREMIUM"), "the page's stacked sum insured over PREMIUM, the reading giving none");
  // Blank lines are not read, so a figure two lines from a label is beside it (Critic R297 H1).
  none(schedule("RIDER PREMIUM\n\nS$50.00\nPREMIUM\n\nS$399.24 (MONTHLY)"), "a rider's figure under its label, blank-separated");
  none(schedule("FIRST YEAR PREMIUM\n\nS$376.68\nPREMIUM\n\nS$470.85 per month"), "a first-year figure under its label, blank-separated");
  // A header row of field names over a lone figure may own it (Critic R297 H2); only the currency row is harmless there.
  none(schedule("RIDER\tSUM ASSURED\nS$50,000.00\nPREMIUM\n\nS$399.24 per month"), "a two-cell header over the figure");
  none(schedule("PLAN\tSUM ASSURED\tTERM\nS$50,000.00\nPREMIUM"), "a three-cell header over the figure");
  // Label above its figure, with the cover table's header under the figure: that header could own it, so none (a known gap).
  none(schedule("Total Premium\nS$45.00 Monthly"), "label above the figure, a header row under it");
  // The label's other side: a value of its own ("POLICY TERM\t10 YEARS" holds a figure) gives none.
  none(schedule("S$399.24 (MONTHLY)\nPREMIUM\nPOLICY TERM\t10 YEARS"), "the line under the label holds a figure");
  none(schedule("S$399.24 (MONTHLY)\nPREMIUM\nWAIVED\tFROM\tYEAR 2"), "three cells under the label, one with a figure");
  none(schedule("S$399.24 (MONTHLY)\nPREMIUM\nWaived"), "a value under the label");
  none(schedule("S$399.24 (MONTHLY)\nPREMIUM\nWaived\tYearly"), "a two-cell value under the label");
  // Only a currency row is harmless over the figure: a key with any other value is not one.
  none(schedule("S$399.24 (MONTHLY)\nPREMIUM", "CURRENCY\tSEE BELOW"), "a currency key with no currency");
});

// ---------------------------------------------------------------- a policy with no premium read is named, never silent

test("a current schedule's policy with no premium read and nothing counted for it is named, once per document, in every market", () => {
  const docs = new Map<string, TablePremiumDocument>([["doc-a", { insurer: "Harbour Life", lapsedOrEnded: false }], ["doc-b", { insurer: "Selat Takaful", lapsedOrEnded: false }],
    ["doc-c", { insurer: "Thames Mutual", lapsedOrEnded: false }]]);
  const none = { premium: null, premiumFrequency: null, premiumCurrency: null };
  const covers = [cover({ ...none, product: "Harbour Protector" }), cover({ ...none, product: "Harbour Protector", cover: "Total and Permanent Disability" }),
    cover({ ...none, doc: "doc-b", product: "Pelan Lindung", currency: "MYR" }), cover({ ...none, doc: "doc-c", product: "", currency: "GBP" })];
  assert.deepEqual(unreadPremiumCovers(covers, [], docs, new Set(), TODAY), [{ name: "Harbour Protector", why: "unread" }, { name: "Pelan Lindung", why: "unread" }, { name: "Thames Mutual policy", why: "unread" }]);
});

test("a policy is not named as unread when its premium is counted, read, already named, or not a current personal schedule", () => {
  const docs = new Map<string, TablePremiumDocument>([["doc-a", { insurer: "Harbour Life", policyNumber: "HL-0042", lapsedOrEnded: false }], ["doc-e", { insurer: "Harbour Life", lapsedOrEnded: true }]]);
  const bare = cover({ premium: null, premiumFrequency: null, premiumCurrency: null, product: "Harbour Protector" });
  const item = (over: Record<string, unknown>) => ({ policy_id: null, policy_number: null, product_name: "Other Plan", amount: 50, insurer: "Gull Insurance", ...over });
  const unread = (covers: TablePremiumCover[], counted: ReturnType<typeof item>[] = [], named = new Set<string>()) => unreadPremiumCovers(covers, counted as never, docs, named, TODAY);
  assert.deepEqual(unread([bare], [item({ policy_id: "doc-a" })]), [], "a premium counted from this document");
  assert.deepEqual(unread([bare], [item({ policy_number: "HL 42" })]), [], "a record with this policy's number");
  assert.deepEqual(unread([bare], [], new Set(["doc-a"])), [], "already named as missing by the inventory");
  // Another cover of the same document gave a premium: tablePremiumItems counts it or names it, so not named again here.
  assert.deepEqual(unread([bare, cover({ product: "Harbour Protector Rider" })]), []);
  assert.deepEqual(unread([{ ...bare, documentKind: "reference" as never }]), [], "a wording proves nobody's premium");
  assert.deepEqual(unread([{ ...bare, ended: "the cover ended" as never }]), [], "an ended cover is no current cost");
  assert.deepEqual(unread([{ ...bare, source: src("doc-e") as never }]), [], "a document whose pages say the policy ended");
  assert.deepEqual(unread([{ ...bare, source: src("doc-gone") as never }]), [], "a deleted or superseded document (not in the current documents)");
  // A period that ran out, an old start with no end (whole life), or an ending word on the page may still be a held policy:
  // named, its document perhaps out of date; no dates printed is plainly unread (TE pr163 N6-N8, Critic R301 H3).
  const old = [{ name: "Harbour Protector", why: "unread_old" }];
  assert.deepEqual(unread([{ ...bare, documentPeriodFrom: "01/03/2023", documentPeriodTo: "28/02/2024" }]), old, "a period that ran out");
  assert.deepEqual(unread([{ ...bare, documentPeriodFrom: "05/01/2019", documentPeriodTo: null }]), old, "an old start, no end");
  assert.deepEqual(unread([{ ...bare, documentPeriodFrom: null, documentPeriodTo: null }]), [{ name: "Harbour Protector", why: "unread" }], "no dates printed");
  const endedDocs = new Map([...docs, ["doc-t", { insurer: "Harbour Life", lapsedOrEnded: false, endedPages: [1] }]]);
  assert.deepEqual(unreadPremiumCovers([{ ...bare, source: src("doc-t") as never }], [], endedDocs, new Set(), TODAY), old, "a page with an ending word");
  // The cover's own number matches a record's (TE U11); an ended rider's premium does not mark its document as read (TE U12).
  assert.deepEqual(unread([{ ...bare, policyNumber: "HL-0099" }], [item({ policy_number: "HL 99", insurer: "Gull Insurance" })]), []);
  assert.deepEqual(unread([bare, cover({ product: "Harbour Protector Rider", ended: "the rider ended" as never })]), [{ name: "Harbour Protector", why: "unread" }]);
  // The same insurer alone, another product: plainly unread (Critic R300 M1). A product that may be it: maybe counted.
  assert.deepEqual(unread([bare], [item({ insurer: "Harbour Life" })]), [{ name: "Harbour Protector", why: "unread" }]);
  assert.deepEqual(unread([bare], [item({ insurer: "Harbour Life", product_name: "Harbour Protector" })]), [{ name: "Harbour Protector", why: "maybe_counted" }]);
  // Plainly another policy: named as unread.
  assert.deepEqual(unread([bare], [item({ policy_number: "GI-77", product_name: "Gull Travel" })]), [{ name: "Harbour Protector", why: "unread" }]);
});

test("a combined schedule's second policy is named; a rider of a named plan is not; insurer alone is no 'maybe' (Critic R300)", () => {
  const docs = new Map<string, TablePremiumDocument>([["doc-a", { insurer: "Harbour Life", lapsedOrEnded: false }]]);
  const none = { premium: null, premiumFrequency: null, premiumCurrency: null };
  const a = cover({ ...none, product: "Harbour Protector", policyNumber: "HL-1001" }), b = cover({ ...none, product: "Harbour Health Saver", policyNumber: "HL-2002" });
  const names = (covers: TablePremiumCover[], counted: unknown[] = [], named: { policy_number: string | null; product_name: string | null; insurer: string | null }[] = []) =>
    unreadPremiumCovers(covers, counted as never, docs, new Set(), TODAY, named);
  assert.deepEqual(names([a, b]), [{ name: "Harbour Protector", why: "unread" }, { name: "Harbour Health Saver", why: "unread" }]);
  // One policy's premium read on the combined schedule: the other is still named.
  assert.deepEqual(names([{ ...a, premium: 50, premiumFrequency: "Monthly", premiumCurrency: "SGD" }, b]), [{ name: "Harbour Health Saver", why: "unread" }]);
  // A counted premium from this document with the other policy's number does not hide it.
  assert.deepEqual(names([b], [{ policy_id: "doc-a", policy_number: "HL-1001", product_name: "Harbour Protector", amount: 50, insurer: "Harbour Life" }]), [{ name: "Harbour Health Saver", why: "unread" }]);
  // No number printed anywhere: a plan and its riders are one entry for the document (TE pr163 R1b).
  const docsBare = new Map<string, TablePremiumDocument>([["doc-a", { insurer: "Harbour Life", lapsedOrEnded: false }]]);
  assert.deepEqual(unreadPremiumCovers([cover({ ...none, product: "Harbour Protector" }), cover({ ...none, product: "Harbour Protector Rider: Waiver of Premium" }), cover({ ...none, product: "Early CI Rider" })],
    [], docsBare, new Set(), TODAY), [{ name: "Harbour Protector", why: "unread" }]);
  // No number, a rider's premium read: the plan's is not, so the plan is named (TE pr163 R3); counted, it may be the plan's.
  const riderRead = cover({ product: "Early CI Rider", premium: 12.5, premiumFrequency: "Monthly", premiumCurrency: "SGD" }), plan = cover({ ...none, product: "Harbour Protector" });
  assert.deepEqual(unreadPremiumCovers([plan, riderRead], [], docsBare, new Set(), TODAY), [{ name: "Harbour Protector", why: "unread" }]);
  assert.deepEqual(unreadPremiumCovers([plan, riderRead], [{ policy_id: "doc-a", policy_number: null, product_name: "Early CI Rider", amount: 12.5, insurer: "Harbour Life" }] as never, docsBare, new Set(), TODAY),
    [{ name: "Harbour Protector", why: "maybe_counted" }]);
  // The plan's own premium read: not named, nor a rider named after it.
  assert.deepEqual(unreadPremiumCovers([{ ...plan, premium: 80, premiumFrequency: "Monthly", premiumCurrency: "SGD" }, cover({ ...none, product: "Harbour Protector Rider: Waiver of Premium" })], [], docsBare, new Set(), TODAY), []);
  // A rider whose term ran out listed first: the current plan names the policy (TE pr163 R5).
  assert.deepEqual(unreadPremiumCovers([cover({ ...none, product: "Term Rider 5", endDate: "28/02/2026" }), plan], [], new Map([["doc-a", { insurer: "Harbour Life", policyNumber: "HL-1001", lapsedOrEnded: false }]]), new Set(), TODAY), [{ name: "Harbour Protector", why: "unread" }]);
  // A rider printed with no number of its own is the plan's: named once.
  const docsNo = new Map<string, TablePremiumDocument>([["doc-a", { insurer: "Harbour Life", policyNumber: "HL-1001", lapsedOrEnded: false }]]);
  assert.deepEqual(unreadPremiumCovers([{ ...a, policyNumber: null }, cover({ ...none, product: "Harbour Protector", cover: "Waiver of Premium" })], [], docsNo, new Set(), TODAY), [{ name: "Harbour Protector", why: "unread" }]);
  // The same insurer, another product, no numbers: plainly unread, not "may be counted" (M1).
  const plain = cover({ ...none, product: "Harbour Protector" });
  assert.deepEqual(names([plain], [{ policy_id: null, policy_number: null, product_name: "Harbour Travel Basic", amount: 20, insurer: "Harbour Life" }]), [{ name: "Harbour Protector", why: "unread" }]);
  // A product name that may be the counted one stays "may be counted".
  assert.deepEqual(names([plain], [{ policy_id: null, policy_number: null, product_name: "Harbour Protector", amount: 20, insurer: "Harbour Life" }]), [{ name: "Harbour Protector", why: "maybe_counted" }]);
  // A policy the inventory already names as missing, on another document, is not named twice (L1).
  assert.deepEqual(names([a], [], [{ policy_number: "HL 1001", product_name: "Harbour Protector", insurer: "Harbour Life" }]), []);
  assert.deepEqual(names([plain], [], [{ policy_number: null, product_name: "Harbour Protector", insurer: "Harbour Life" }]), []);
  assert.deepEqual(names([plain], [], [{ policy_number: null, product_name: "Selat Shield", insurer: "Harbour Life" }]), [{ name: "Harbour Protector", why: "unread" }]);
});
