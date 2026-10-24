/** Scripted tests for the benefit table's server checks and assembly (lib/benefit-table). Synthetic pages only, no
 * household data and no model: each case hands checkReading the JSON a model might write.
 *   npm run benefit-table:test */
import assert from "node:assert/strict";
import { checkReading, startDay, type SourceDoc } from "@/lib/benefit-table/check";
import { assembleTable, figureText, qualifierOf, sectionKeyOf, coverKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { mergeReadings, pagesToReread } from "@/lib/benefit-table/completeness";
import { LINKING_SCHEMA, READING_SCHEMA } from "@/lib/benefit-table/reading";
import { sourcesOf } from "./read";
import { backfillSql } from "./backfill-sql";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const family: FamilyMember[] = [{ id: "a", display_name: "Lim Wei Jie" }, { id: "b", display_name: "Tan Mei Ling" }, { id: "c", display_name: "Lim Kai" }];
const cert: SourceDoc = { id: "cert", name: "Certificate.pdf", readable: true, pages: [{ page: 1, text:
  "CERTIFICATE OF INSURANCE\nGROUP TERM LIFE\nLim Wei Jie\tS$500,000\tAs of 01/01/2024\nTan Mei Ling\tS$250,000\tAs of 01/01/2024\n" +
  "GROUP PERSONAL ACCIDENT\nLim Wei Jie\tS$200,000\tAs of 01/01/2024\nTan Mei Ling\tS$100,000\tAs of 01/01/2024" }] };
const terms: SourceDoc = { id: "terms", name: "Scheme terms.pdf", readable: true, pages: [
  { page: 1, text: "BENEFIT 2: GROUP PERSONAL ACCIDENT\nCompensation Schedule (% of Sum Insured)\nArm, Elbow or Wrist (Other Fracture)\t20%\nThis Benefit can only be claimed under the Core Scheme." },
  { page: 2, text: "Simple Fracture Benefit Limit: S$5,000\nCompensation (% of S$5,000)\nArm, Elbow or Wrist#\t25%\n# Fractures of thumb and finger are not covered\nAmbulance Cost\tup to $500 per incident" },
  { page: 3, text: "Daily Hospital Cash Benefit S$30 per day from the 11th day onwards. Max: 30 days\nTravel\tClassic\tBusiness\nTrip cancellation\tS$5,000\tS$10,000" },
] };
const cover = (person: string, coverName: string, sumInsured: number | null, quote: string) => ({ person, product: "Group Scheme", cover: coverName, plan: null, sumInsured, asOf: "01/01/2024", page: 1, quote });
const benefit = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
const doc = (kind: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product: "Group Scheme", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits });

const certReading = checkReading(cert, doc("personal_proof", [
  cover("Lim Wei Jie", "Group Personal Accident", 200000, "Lim Wei Jie S$200,000 As of 01/01/2024"),
  cover("Tan Mei Ling", "Group Personal Accident", 100000, "Tan Mei Ling S$100,000 As of 01/01/2024"),
  cover("Lim Wei Jie", "Group Term Life", 500000, "Lim Wei Jie S$500,000 As of 01/01/2024"),
], []));
const gpa = coverKeyOf({ product: "Group Scheme", cover: "Group Personal Accident", plan: null });
const gtl = coverKeyOf({ product: "Group Scheme", cover: "Group Term Life", plan: null });

test("cover rows printed with the person's name are kept, with the currency the quote prints", () => {
  assert.equal(certReading.covers.length, 3);
  assert.equal(certReading.covers[0].currency, "SGD");
  assert.equal(certReading.covers[0].source.page, 1);
});
test("a cover whose sum insured is not in its quote is dropped", () => {
  const r = checkReading(cert, doc("personal_proof", [cover("Lim Wei Jie", "Group Personal Accident", 300000, "Lim Wei Jie S$200,000 As of 01/01/2024")], []));
  assert.equal(r.covers.length, 0);
  assert.match(r.dropped[0].why, /not printed/);
});
test("a cover whose quote is not on any page is dropped", () => {
  const r = checkReading(cert, doc("personal_proof", [cover("Lim Wei Jie", "Group Personal Accident", 200000, "Lim Wei Jie S$200,000 As of 02/02/2025")], []));
  assert.equal(r.covers.length, 0);
});
test("a cover for a person not named on the page is dropped", () => {
  const r = checkReading(cert, doc("personal_proof", [cover("Lim Kai", "Group Personal Accident", 200000, "S$200,000 As of 01/01/2024")], []));
  assert.equal(r.covers.length, 0);
  assert.match(r.dropped[0].why, /name not printed/);
});

const termsReading = checkReading(terms, doc("scheme_terms", [], [
  benefit({ section: "BENEFIT 2: GROUP PERSONAL ACCIDENT", benefit: "Arm, Elbow or Wrist (Other Fracture)", pays: "percent", value: 20, percentOf: "sum_insured", page: 1,
    quote: "Arm, Elbow or Wrist (Other Fracture) 20%", conditions: ["This Benefit can only be claimed under the Core Scheme.", "Only if the claimant was wearing a helmet"] }),
  benefit({ section: "Simple Fracture", benefit: "Arm, Elbow or Wrist", pays: "percent", value: 25, percentOf: "fixed_amount", baseAmount: 5000, baseQuote: "Compensation (% of S$5,000)", page: 2,
    quote: "Arm, Elbow or Wrist# 25%", conditions: ["# Fractures of thumb and finger are not covered"] }),
  benefit({ section: "Simple Fracture", benefit: "Ambulance Cost", pays: "up_to", value: 500, page: 2, quote: "Ambulance Cost up to $500 per incident" }),
  benefit({ section: "GROUP TERM LIFE", benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 30, fromDay: 11, maxDays: 30, page: 3, quote: "Daily Hospital Cash Benefit S$30 per day from the 11th day onwards. Max: 30 days" }),
  benefit({ section: "Travel", column: "Classic", benefit: "Trip cancellation", pays: "up_to", value: 5000, page: 3, quote: "Trip cancellation S$5,000 S$10,000" }),
  benefit({ section: "Travel", benefit: "Wrong figure", pays: "percent", value: 30, percentOf: "sum_insured", page: 1, quote: "Arm, Elbow or Wrist (Other Fracture) 20%" }),
  benefit({ section: "Simple Fracture", benefit: "Base on another page", pays: "percent", value: 20, percentOf: "fixed_amount", baseAmount: 5000, baseQuote: "Compensation (% of S$5,000)", page: 1, quote: "Arm, Elbow or Wrist (Other Fracture) 20%" }),
]));

test("a figure not printed in the row's quote is dropped", () => {
  assert.ok(termsReading.dropped.some((d) => d.what.includes("Wrong figure") && /figure 30/.test(d.why)));
});
test("a fixed base printed on another page is dropped", () => {
  assert.ok(termsReading.dropped.some((d) => d.what.includes("Base on another page") && /fixed base/.test(d.why)));
});
test("a condition not printed in the document is dropped; one that is printed is kept", () => {
  const row = termsReading.benefits.find((b) => b.benefit.includes("Other Fracture"))!;
  assert.deepEqual(row.conditions, ["This Benefit can only be claimed under the Core Scheme."]);
  assert.deepEqual(row.droppedConditions, ["Only if the claimant was wearing a helmet"]);
});
test("a bare $ is not a currency", () => {
  assert.equal(termsReading.benefits.find((b) => b.benefit === "Ambulance Cost")!.currency, null);
});
test("day counts printed in the quote are kept", () => {
  const row = termsReading.benefits.find((b) => b.pays === "per_day")!;
  assert.equal(row.fromDay, 11); assert.equal(row.maxDays, 30);
});
test("a day count not in the quote is not kept: the quote's own first paid day is (TE #108 B2)", () => {
  const r = checkReading(terms, doc("scheme_terms", [], [benefit({ benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 30, fromDay: 8, maxDays: 30, page: 3, quote: "Daily Hospital Cash Benefit S$30 per day from the 11th day onwards. Max: 30 days" })]));
  assert.equal(r.benefits[0].fromDay, 11);
  const most = checkReading(terms, doc("scheme_terms", [], [benefit({ benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 30, fromDay: 11, maxDays: 40, page: 3, quote: "Daily Hospital Cash Benefit S$30 per day from the 11th day onwards. Max: 30 days" })]));
  assert.equal(most.benefits[0].maxDays, null);
});
test("a first paid day printed as the day before it is kept: \"after the 10th day\" is day 11 (live run B3)", () => {
  const read = (fromDay: number, quote: string) => checkReading(terms, doc("scheme_terms", [], [benefit({ benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 30, fromDay, maxDays: 30, page: 3, quote })])).benefits[0]?.fromDay;
  const T = { ...terms, pages: terms.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text + "\nA Benefit of $30 per day shall be payable after the 10th day of Hospital stay, up to a maximum of thirty (30) days continuously.\nA Benefit of $30 per day after 10 days in hospital, at most 30 days." }) };
  const readT = (fromDay: number, quote: string) => checkReading(T, doc("scheme_terms", [], [benefit({ benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 30, fromDay, maxDays: 30, page: 3, quote })])).benefits[0]?.fromDay;
  assert.equal(readT(11, "A Benefit of $30 per day shall be payable after the 10th day of Hospital stay, up to a maximum of thirty (30) days continuously."), 11);
  assert.equal(readT(11, "A Benefit of $30 per day after 10 days in hospital, at most 30 days."), 11);
  // Whatever day the reading gave, the quote's own day is kept.
  assert.equal(readT(12, "A Benefit of $30 per day shall be payable after the 10th day of Hospital stay, up to a maximum of thirty (30) days continuously."), 11);
  assert.equal(read(11, "Daily Hospital Cash Benefit S$30 per day from the 11th day onwards. Max: 30 days"), 11);
  // The quote's own day wins over the reading's: "after the 10th day" read as 10 is day 11 (TE #108 B2); a printed "from
  // day 1" is day 1, not a later "exceeding 10 days" (TE #108 B4).
  assert.equal(readT(10, "A Benefit of $30 per day shall be payable after the 10th day of Hospital stay, up to a maximum of thirty (30) days continuously."), 11);
  // A waiting period is not the first paid day (Critic R149-1).
  const T5 = { ...terms, pages: terms.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text + "\nHospital Cash Benefit S$50 per day, payable after 30 days of continuous cover. Max: 30 days" }) };
  assert.equal(checkReading(T5, doc("scheme_terms", [], [benefit({ benefit: "Hospital Cash Benefit", pays: "per_day", value: 50, fromDay: null, maxDays: 30, page: 3, quote: "Hospital Cash Benefit S$50 per day, payable after 30 days of continuous cover. Max: 30 days" })])).benefits[0]?.fromDay, null);
  // "Beyond the Nth day" is often a limit, so it never gives a first paid day (TE #108 B6).
  const T6 = { ...terms, pages: terms.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text + "\nHospital Cash S$100 per day. Not payable for any stay beyond the 30th day." }) };
  assert.equal(checkReading(T6, doc("scheme_terms", [], [benefit({ benefit: "Hospital Cash", pays: "per_day", value: 100, fromDay: null, maxDays: null, page: 3, quote: "Hospital Cash S$100 per day. Not payable for any stay beyond the 30th day." })])).benefits[0]?.fromDay, null);
  // A negated "after" or "from" is a limit, not a start, whatever was read (TE #108).
  for (const [i, quote] of ["Hospital Cash S$100 per day. Not payable after the 30th day of any stay.", "Hospital Cash S$100 per day. No benefit is paid from day 31."].entries()) {
    const T7 = { ...terms, pages: terms.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text + "\n" + quote }) };
    assert.equal(checkReading(T7, doc("scheme_terms", [], [benefit({ benefit: "Hospital Cash", pays: "per_day", value: 100, fromDay: i === 0 ? 31 : null, maxDays: null, page: 3, quote })])).benefits[0]?.fromDay, null);
  }
  // A negation in an earlier clause leaves the first paid day as printed.
  assert.equal(startDay("No benefit is payable for the first 10 days, payable from the 11th day."), 11);
  const T4 = { ...terms, pages: terms.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text + "\nDaily Hospital Cash Benefit S$30 per day from day 1; no claim is paid for stays exceeding 10 days abroad." }) };
  assert.equal(checkReading(T4, doc("scheme_terms", [], [benefit({ benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 30, fromDay: 11, maxDays: null, page: 3, quote: "Daily Hospital Cash Benefit S$30 per day from day 1; no claim is paid for stays exceeding 10 days abroad." })])).benefits[0]?.fromDay, 1);
});
test("nothing is read from a document the app could not read", () => {
  const r = checkReading({ ...cert, readable: false }, doc("personal_proof", [cover("Lim Wei Jie", "Group Personal Accident", 200000, "Lim Wei Jie S$200,000 As of 01/01/2024")], []));
  assert.equal(r.covers.length, 0);
});

const key = (section: string, column: string | null = null) => sectionKeyOf("terms", { section, column });
const links = [
  { section: key("BENEFIT 2: GROUP PERSONAL ACCIDENT"), cover: gpa, why: "accident section" },
  { section: key("Simple Fracture"), cover: gpa, why: "accident benefits" },
  { section: key("GROUP TERM LIFE"), cover: gtl, why: "life cover" },
];
const table = assembleTable([certReading, termsReading], family, links);
const rowsOf = (id: string) => table.people.find((p) => p.id === id)!.rows;

test("a percentage of the sum insured is worked out on each person's own sum insured for the linked cover", () => {
  const mine = rowsOf("a").find((r) => r.benefit.includes("Other Fracture"))!;
  const hers = rowsOf("b").find((r) => r.benefit.includes("Other Fracture"))!;
  assert.equal(mine.figure.kind === "worked_out" && mine.figure.amount, 40000);
  assert.equal(hers.figure.kind === "worked_out" && hers.figure.amount, 20000);
  assert.match(figureText(mine.figure), /20% of S\$200,000 \(Group Personal Accident, Certificate\.pdf p1/);
  assert.equal(mine.baseSource?.document, "Certificate.pdf");
});
test("never the sum insured of another cover (the life cover's S$500,000 is not an accident base)", () => {
  assert.ok(!rowsOf("a").some((r) => r.figure.kind === "worked_out" && r.figure.amount === 100000 && r.benefit.includes("Other Fracture")));
});
test("a percentage of a printed fixed amount uses that amount", () => {
  const row = rowsOf("a").find((r) => r.benefit === "Arm, Elbow or Wrist")!;
  assert.equal(row.figure.kind === "worked_out" && row.figure.amount, 1250);
});
test("two documents' rows for one injury stay separate alternatives, never a total", () => {
  const wrist = rowsOf("a").filter((r) => /wrist/i.test(r.benefit));
  assert.equal(wrist.length, 2);
  assert.ok(!rowsOf("a").some((r) => r.figure.kind !== "none" && "amount" in r.figure && r.figure.amount === 41250));
});
test("a bare-$ amount shows that its currency is not stated", () => {
  assert.match(figureText(rowsOf("a").find((r) => r.benefit === "Ambulance Cost")!.figure), /currency not stated/);
});
test("a cover only one person holds reaches only that person", () => {
  assert.ok(rowsOf("a").some((r) => r.cover === "Group Term Life"));
  assert.ok(!rowsOf("b").some((r) => r.cover === "Group Term Life"));
});
test("a person with no cover of their own has an empty table", () => {
  assert.equal(rowsOf("c").length, 0);
  assert.equal(table.people.find((p) => p.id === "c")!.covers.length, 0);
});
test("an unlinked section is listed, not dropped and not given to anyone", () => {
  assert.ok(table.unlinkedSections.some((u) => u.section.section === "Travel"));
  assert.ok(!table.people.some((p) => p.rows.some((r) => r.benefit === "Trip cancellation")));
});
test("a link to a cover nobody holds is refused", () => {
  const t = assembleTable([certReading, termsReading], family, [{ section: key("Travel", "Classic"), cover: "nope", why: "" }]);
  assert.equal(t.refusedLinks[0].why, "no such cover");
});
test("a plan column that is not the person's plan is refused", () => {
  const travelCert: SourceDoc = { id: "tc", name: "Travel summary.pdf", readable: true, pages: [{ page: 1, text: "Your travel insurance summary\nYour name: Lim Wei Jie\nPlan: Business" }] };
  const tr = checkReading(travelCert, { document: { kind: "personal_proof", product: "Travel", insurer: null, namedPeople: [], plan: "Business", periodFrom: null, periodTo: null },
    covers: [{ person: "Lim Wei Jie", product: "Travel", cover: "Travel insurance", plan: "Business", sumInsured: null, asOf: null, page: 1, quote: "Your name: Lim Wei Jie" }], benefits: [] });
  const travel = coverKeyOf({ product: "Travel", cover: "Travel insurance", plan: "Business" });
  const t = assembleTable([tr, termsReading], family, [{ section: key("Travel", "Classic"), cover: travel, why: "travel" }]);
  assert.match(t.refusedLinks[0]?.why ?? "", /not the plan/);
  assert.ok(!t.people[0].rows.some((r) => r.benefit === "Trip cancellation"));
});
test("a cover printed for someone outside the family is listed, not linked", () => {
  const other = checkReading({ ...cert, pages: [{ page: 1, text: "GROUP PERSONAL ACCIDENT\nNg Ah Kow\tS$90,000" }] },
    doc("personal_proof", [cover("Ng Ah Kow", "Group Personal Accident", 90000, "Ng Ah Kow S$90,000")], []));
  const t = assembleTable([other], family, []);
  assert.equal(t.unmatchedCovers.length, 1);
  assert.ok(t.people.every((p) => p.covers.length === 0));
});

// ------------------------------------------------------------------ other kinds of policy: investment-linked with a rider,
// endowment, annuity. Same reader schema, same checks: nothing below is specific to one product.
const ilp: SourceDoc = { id: "ilp", name: "ILP schedule.pdf", readable: true, pages: [
  { page: 1, text: "POLICY SCHEDULE\nPolicy Number: IL-778812\nLife Assured: Tan Mei Ling\nBasic Plan: GrowthLink Investment Plan\tSum Assured S$100,000\tPremium S$300 monthly\tCommencement 01/03/2020\n" +
    "Rider: Early Critical Illness Accelerator (attached to GrowthLink Investment Plan)\tSum Assured S$50,000\tPremium S$45 monthly\tExpiry 01/03/2045\n" +
    "Life Assured: Lim Wei Jie\nBasic Plan: GrowthLink Investment Plan\tSum Assured S$80,000\tPremium S$250 monthly\tCommencement 01/03/2020" },
  { page: 2, text: "ANNUAL STATEMENT\nFund value as at 31/12/2025: S$12,345.67\nSurrender value as at 31/12/2025: S$11,900.00" },
  { page: 3, text: "Projected fund value at age 65 at an assumed return of 4% p.a.: S$95,000 (non-guaranteed)\nEarly Critical Illness Accelerator pays 100% of the rider Sum Assured on early-stage diagnosis" },
] };
const ilpReading = checkReading(ilp, { document: { kind: "personal_proof", product: "GrowthLink Investment Plan", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
  covers: [
    { person: "Tan Mei Ling", product: "GrowthLink Investment Plan", cover: "GrowthLink Investment Plan", plan: null, riderOf: null, policyNumber: "IL-778812", sumInsured: 100000, premium: 300, premiumFrequency: "monthly",
      asOf: null, startDate: "01/03/2020", endDate: null, page: 1, quote: "Basic Plan: GrowthLink Investment Plan Sum Assured S$100,000 Premium S$300 monthly Commencement 01/03/2020" },
    { person: "Tan Mei Ling", product: "GrowthLink Investment Plan", cover: "Early Critical Illness Accelerator", plan: null, riderOf: "GrowthLink Investment Plan", policyNumber: "IL-778812", sumInsured: 50000, premium: 45, premiumFrequency: "monthly",
      asOf: null, startDate: null, endDate: "01/03/2046", page: 1, quote: "Rider: Early Critical Illness Accelerator (attached to GrowthLink Investment Plan) Sum Assured S$50,000 Premium S$45 monthly" },
    { person: "Lim Wei Jie", product: "GrowthLink Investment Plan", cover: "GrowthLink Investment Plan", plan: null, riderOf: null, policyNumber: "IL-999999", sumInsured: 80000, premium: 999, premiumFrequency: "monthly",
      asOf: null, startDate: "01/03/2020", endDate: null, page: 1, quote: "Basic Plan: GrowthLink Investment Plan Sum Assured S$80,000 Premium S$250 monthly Commencement 01/03/2020" },
  ],
  benefits: [
    benefit({ section: "Fund", benefit: "Fund value", pays: "value", value: 12345.67, asOf: "31/12/2025", page: 2, quote: "Fund value as at 31/12/2025: S$12,345.67" }),
    benefit({ section: "Fund", benefit: "Projected fund value at age 65", pays: "value", value: 95000, basis: "non_guaranteed", page: 3, quote: "Projected fund value at age 65 at an assumed return of 4% p.a.: S$95,000 (non-guaranteed)" }),
    benefit({ section: "Early Critical Illness Accelerator", benefit: "Early-stage diagnosis", pays: "percent", value: 100, percentOf: "sum_insured", page: 3, quote: "Early Critical Illness Accelerator pays 100% of the rider Sum Assured on early-stage diagnosis" }),
  ] });
const ilpKey = coverKeyOf({ product: "GrowthLink Investment Plan", cover: "GrowthLink Investment Plan", plan: null });
const riderKey = coverKeyOf({ product: "GrowthLink Investment Plan", cover: "Early Critical Illness Accelerator", plan: null, riderOf: "GrowthLink Investment Plan" });
const ilpTable = assembleTable([ilpReading], family, [
  { section: sectionKeyOf("ilp", { section: "Fund", column: null }), cover: ilpKey, why: "the plan's fund" },
  { section: sectionKeyOf("ilp", { section: "Early Critical Illness Accelerator", column: null }), cover: riderKey, why: "the rider" },
]);
const ilpRows = (id: string) => ilpTable.people.find((p) => p.id === id)!;

test("a rider is its own cover, attached to its basic plan, with its own premium and printed end date only", () => {
  const rider = ilpRows("b").covers.find((c) => c.riderOf)!;
  assert.equal(rider.riderOf, "GrowthLink Investment Plan");
  assert.equal(rider.premium, 45);
  assert.equal(rider.endDate, null); // 01/03/2046 is not printed; 2045 is
  assert.equal(ilpRows("b").covers.find((c) => !c.riderOf)!.startDate, "01/03/2020");
});
test("a rider's benefit reaches only the person holding the rider, on the rider's own sum assured", () => {
  const row = ilpRows("b").rows.find((r) => r.cover === "Early Critical Illness Accelerator")!;
  assert.equal(row.figure.kind === "worked_out" && row.figure.amount, 50000);
  assert.ok(!ilpRows("a").rows.some((r) => r.cover === "Early Critical Illness Accelerator"));
});
test("a premium or policy number not printed for that cover is not kept", () => {
  const his = ilpRows("a").covers[0];
  assert.equal(his.premium, null);
  assert.equal(his.policyNumber, null);
  assert.equal(his.sumInsured, 80000);
});
test("a fund value is shown with the date it is printed for", () => {
  const row = ilpRows("b").rows.find((r) => r.benefit === "Fund value")!;
  assert.equal(figureText(row.figure), "S$12,345.67 value as of 31/12/2025");
});
test("a rider with the same name on two different basic plans stays two covers", () => {
  const twoPlans: SourceDoc = { id: "tp", name: "Two plans.pdf", readable: true, pages: [{ page: 1, text:
    "Life Assured: Lim Wei Jie\nRider: Payer Benefit (attached to SecureLife Term)\nLife Assured: Tan Mei Ling\nRider: Payer Benefit (attached to GrowthLink Investment Plan)\nPayer Benefit waives premiums on diagnosis" }] };
  const r = checkReading(twoPlans, { document: { kind: "personal_proof", product: null, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
    covers: [
      { person: "Lim Wei Jie", product: "Insurer", cover: "Payer Benefit", plan: null, riderOf: "SecureLife Term", sumInsured: null, page: 1, quote: "Rider: Payer Benefit (attached to SecureLife Term)" },
      { person: "Tan Mei Ling", product: "Insurer", cover: "Payer Benefit", plan: null, riderOf: "GrowthLink Investment Plan", sumInsured: null, page: 1, quote: "Rider: Payer Benefit (attached to GrowthLink Investment Plan)" },
    ],
    benefits: [benefit({ section: "Payer Benefit", benefit: "Premium waiver", pays: "words", page: 1, quote: "Payer Benefit waives premiums on diagnosis" })] });
  const onTerm = coverKeyOf({ product: "Insurer", cover: "Payer Benefit", plan: null, riderOf: "SecureLife Term" });
  const t = assembleTable([r], family, [{ section: sectionKeyOf("tp", { section: "Payer Benefit", column: null }), cover: onTerm, why: "rider on the term plan" }]);
  assert.equal(t.people.find((p) => p.id === "a")!.rows.length, 1);
  assert.equal(t.people.find((p) => p.id === "b")!.rows.length, 0);
});
test("a non-guaranteed projection is never shown as an amount held or payable", () => {
  const row = ilpRows("b").rows.find((r) => r.benefit.startsWith("Projected"))!;
  assert.equal(row.figure.kind, "projected");
  assert.match(figureText(row.figure), /not guaranteed: not an amount held or payable/);
});

const endowment: SourceDoc = { id: "end", name: "Endowment schedule.pdf", readable: true, pages: [{ page: 1, text:
  "Policy Schedule\nLife Assured: Lim Wei Jie\nSmartSave 20 Endowment\tSum Assured S$20,000\tMaturity Date 01/06/2040\n" +
  "Guaranteed Maturity Benefit S$20,000 payable on 01/06/2040\nNon-guaranteed reversionary bonus to date S$3,000\nDeath benefit: Sum Assured plus bonuses" }] };
const endReading = checkReading(endowment, { document: { kind: "personal_proof", product: "SmartSave 20 Endowment", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
  covers: [{ person: "Lim Wei Jie", product: "SmartSave 20 Endowment", cover: "SmartSave 20 Endowment", plan: null, riderOf: null, policyNumber: null, sumInsured: 20000, premium: null, premiumFrequency: null,
    asOf: null, startDate: null, endDate: "01/06/2040", page: 1, quote: "SmartSave 20 Endowment Sum Assured S$20,000 Maturity Date 01/06/2040" }],
  benefits: [
    benefit({ benefit: "Guaranteed Maturity Benefit", pays: "amount", value: 20000, basis: "guaranteed", page: 1, quote: "Guaranteed Maturity Benefit S$20,000 payable on 01/06/2040" }),
    benefit({ benefit: "Reversionary bonus to date", pays: "value", value: 3000, basis: "non_guaranteed", page: 1, quote: "Non-guaranteed reversionary bonus to date S$3,000" }),
    benefit({ benefit: "Death benefit", pays: "words", page: 1, quote: "Death benefit: Sum Assured plus bonuses" }),
  ] });
const endKey = coverKeyOf({ product: "SmartSave 20 Endowment", cover: "SmartSave 20 Endowment", plan: null });
const endTable = assembleTable([endReading], family, [{ section: sectionKeyOf("end", { section: null, column: null }), cover: endKey, why: "the endowment" }]);
const endRows = endTable.people.find((p) => p.id === "a")!;

test("an endowment keeps its maturity date, a guaranteed amount, a non-guaranteed bonus as a projection, and plain words", () => {
  assert.equal(endRows.covers[0].endDate, "01/06/2040");
  assert.equal(figureText(endRows.rows.find((r) => r.benefit === "Guaranteed Maturity Benefit")!.figure), "S$20,000");
  assert.equal(endRows.rows.find((r) => r.benefit.startsWith("Reversionary"))!.figure.kind, "projected");
  const words = endRows.rows.find((r) => r.benefit === "Death benefit")!;
  assert.equal(words.figure.kind, "none");
  assert.equal(words.source.page, 1);
});

const annuity: SourceDoc = { id: "ann", name: "Annuity contract.pdf", readable: true, pages: [{ page: 1, text:
  "Annuity Policy Schedule\nAnnuitant: Tan Mei Ling\nIncomeForLife Annuity\tSingle premium S$150,000\nMonthly annuity income: S$720 per month from age 65 for life" }] };
const annReading = checkReading(annuity, { document: { kind: "personal_proof", product: "IncomeForLife Annuity", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
  covers: [{ person: "Tan Mei Ling", product: "IncomeForLife Annuity", cover: "IncomeForLife Annuity", plan: null, riderOf: null, policyNumber: null, sumInsured: null, premium: 150000, premiumFrequency: "single",
    asOf: null, startDate: null, endDate: null, page: 1, quote: "IncomeForLife Annuity Single premium S$150,000" }],
  benefits: [
    benefit({ benefit: "Monthly annuity income", pays: "per_period", period: "month", value: 720, page: 1, quote: "Monthly annuity income: S$720 per month from age 65 for life", conditions: ["from age 65 for life"] }),
    benefit({ benefit: "Payment with no period", pays: "per_period", value: 720, page: 1, quote: "Monthly annuity income: S$720 per month from age 65 for life" }),
  ] });
const annKey = coverKeyOf({ product: "IncomeForLife Annuity", cover: "IncomeForLife Annuity", plan: null });
const annTable = assembleTable([annReading], family, [{ section: sectionKeyOf("ann", { section: null, column: null }), cover: annKey, why: "the annuity" }]);

test("an annuity's payout is a payment per period, and a payment with no period is dropped", () => {
  const row = annTable.people.find((p) => p.id === "b")!.rows[0];
  assert.equal(figureText(row.figure), "S$720 a month");
  assert.deepEqual(row.conditions, ["from age 65 for life"]);
  assert.ok(annReading.dropped.some((d) => /no period/.test(d.why)));
  assert.equal(annTable.people.find((p) => p.id === "b")!.covers[0].premium, 150000);
});
test("a cover read from an illustration (a quotation) is not proof that anyone holds it", () => {
  const quote = checkReading({ ...annuity, id: "q" }, { ...(annReading as unknown as Record<string, unknown>), document: { kind: "illustration", product: null, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: "Tan Mei Ling", product: "IncomeForLife Annuity", cover: "IncomeForLife Annuity", plan: null, sumInsured: null, page: 1, quote: "IncomeForLife Annuity Single premium S$150,000" }], benefits: [] });
  const t = assembleTable([quote], family, []);
  assert.equal(t.illustrationCovers.length, 1);
  assert.ok(t.people.every((p) => p.covers.length === 0));
});
const shield: SourceDoc = { id: "hs", name: "Hospital plan schedule.pdf", readable: true, pages: [{ page: 1, text:
  "Certificate of Insurance\nInsured: Lim Kai\nShieldCare Plan A (Private hospitals)\tPolicy year limit S$1,500,000\n" +
  "Deductible per policy year: S$3,500\nCo-insurance: 10% of the claimable amount after the deductible\nWard entitlement: private hospital, standard room" }] };
const shieldReading = checkReading(shield, { document: { kind: "personal_proof", product: "ShieldCare", insurer: null, namedPeople: [], plan: "A", periodFrom: null, periodTo: null },
  covers: [{ person: "Lim Kai", product: "ShieldCare", cover: "ShieldCare Plan A", plan: "Plan A", riderOf: null, policyNumber: null, sumInsured: null, premium: null, premiumFrequency: null,
    asOf: null, startDate: null, endDate: null, page: 1, quote: "ShieldCare Plan A (Private hospitals)" }],
  benefits: [
    benefit({ benefit: "Policy year limit", pays: "up_to", value: 1500000, page: 1, quote: "Policy year limit S$1,500,000" }),
    benefit({ benefit: "Deductible per policy year", pays: "amount", value: 3500, page: 1, quote: "Deductible per policy year: S$3,500" }),
    benefit({ benefit: "Co-insurance", pays: "percent", value: 10, percentOf: "other", page: 1, quote: "Co-insurance: 10% of the claimable amount after the deductible" }),
    benefit({ benefit: "Ward entitlement", pays: "words", page: 1, quote: "Ward entitlement: private hospital, standard room" }),
  ] });
const shieldKey = coverKeyOf({ product: "ShieldCare", cover: "ShieldCare Plan A", plan: "Plan A" });
const shieldTable = assembleTable([shieldReading], family, [{ section: sectionKeyOf("hs", { section: null, column: null }), cover: shieldKey, why: "the hospital plan" }]);

test("a hospital plan keeps its limit, its deductible, a co-insurance percentage with no amount, and its ward wording", () => {
  const rows = shieldTable.people.find((p) => p.id === "c")!.rows;
  assert.equal(figureText(rows.find((r) => r.benefit === "Policy year limit")!.figure), "up to S$1,500,000");
  assert.equal(rows.find((r) => r.benefit === "Co-insurance")!.figure.kind, "none");
  assert.equal(rows.find((r) => r.benefit === "Ward entitlement")!.figure.kind, "none");
  assert.equal(rows.length, 4);
});
test("a page whose table was skipped is flagged for a re-read; a page read row by row is not", () => {
  const scale: SourceDoc = { id: "sc", name: "Scale.pdf", readable: true, pages: [
    { page: 1, text: "Schedule (% of Sum Insured)\nHip\t75%\nKnee\t50%\nWrist\t20%\nToe\t5%\nSkull\t100%" },
    { page: 2, text: "Ambulance up to S$500\nRecuperation S$250\nFuneral S$2,000\nEducation S$5,000" },
    { page: 3, text: "Definitions only, with 1 figure: 30 days" },
  ] };
  const read = checkReading(scale, doc("scheme_terms", [], [
    benefit({ benefit: "Hip", pays: "percent", value: 75, percentOf: "sum_insured", page: 1, quote: "Hip 75%" }),
    benefit({ benefit: "Ambulance", pays: "up_to", value: 500, page: 2, quote: "Ambulance up to S$500" }),
    benefit({ benefit: "Recuperation", pays: "amount", value: 250, page: 2, quote: "Recuperation S$250" }),
  ]));
  assert.deepEqual(pagesToReread(scale, read).map((p) => p.page), [1]);
  const again = checkReading(scale, doc("scheme_terms", [], [
    benefit({ benefit: "Hip", pays: "percent", value: 75, percentOf: "sum_insured", page: 1, quote: "Hip 75%" }),
    benefit({ benefit: "Knee", pays: "percent", value: 50, percentOf: "sum_insured", page: 1, quote: "Knee 50%" }),
  ]));
  const merged = mergeReadings(read, again);
  assert.equal(merged.benefits.filter((b) => b.benefit === "Hip").length, 1);
  assert.ok(merged.benefits.some((b) => b.benefit === "Knee"));
  assert.equal(pagesToReread({ ...scale, readable: false }, read).length, 0);
});
test("a reading recorded before riders and values were added still checks", () => {
  assert.equal(certReading.covers[0].riderOf, null);
  assert.equal(termsReading.benefits[0].basis, null);
});

// ------------------------------------------------------------------ Critic R85: plan columns, projections, duplicate covers
/** One person's cover with `plan`, a benefit table whose columns are `column` plus `siblings`, and the `column` section
 * linked to the person's cover: whether the person is shown the row. `others` are plans other family members hold. */
function planCase(plan: string | null, column: string, siblings: string[] = [], others: string[] = []) {
  const people = ["Lim Wei Jie", "Tan Mei Ling", "Lim Kai"];
  const lines = [plan, ...others].map((p, i) => `${people[i]}\tPlan: ${p ?? "none"}`);
  const proof: SourceDoc = { id: "pc", name: "Schedule.pdf", readable: true, pages: [{ page: 1, text: lines.join("\n") }] };
  const pr = checkReading(proof, { document: { kind: "personal_proof", product: "Shield", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
    covers: [plan, ...others].map((p, i) => ({ person: people[i], product: "Shield", cover: "Shield", plan: p, sumInsured: null, asOf: null, page: 1, quote: lines[i] })), benefits: [] });
  const cols = [column, ...siblings];
  const table: SourceDoc = { id: "pt", name: "Table.pdf", readable: true, pages: [{ page: 1, text: cols.map((c, i) => `${c}\nWard ${i}\tS$${i + 1},000`).join("\n") }] };
  const tr = checkReading(table, doc("scheme_terms", [], cols.map((c, i) => benefit({ section: "Benefits", column: c, benefit: "Ward", pays: "up_to", value: (i + 1) * 1000, quote: `Ward ${i} S$${i + 1},000` }))));
  const t = assembleTable([pr, tr], family, [{ section: sectionKeyOf("pt", { section: "Benefits", column }), cover: coverKeyOf({ product: "Shield", cover: "Shield", plan }), why: "x" }]);
  return { rows: t.people[0].rows, refused: t.refusedLinks };
}
/** Every plan-column case raised in Critic rounds R85 to R88: [person's plan, column linked, other columns in the document,
 * plans other members hold, shown?]. "Refused" means no figure, never another plan's figure. */
const PLAN_COLUMN_CASES: [string | null, string, string[], string[], boolean, string][] = [
  ["A", "Plan A", [], [], true, "R85-1 same plan"],
  ["A", "Plan B", [], [], false, "R85-1 Plan B for a Plan A cover (substring)"],
  ["Plan A", "A", [], [], true, "R85-1 the word Plan is not the name"],
  ["Gold", "Gold Plus", [], [], false, "R85-1 longer plan name"],
  ["Gold Plus", "Gold", [], [], false, "R85-1 shorter plan name"],
  [null, "Plan B", [], [], false, "R85-1 plan column, cover prints no plan"],
  [null, "Business", ["Classic"], [], false, "R85-1 one of a document's plans, cover prints no plan"],
  [null, "Healthy Choice", [], ["Healthy Choice"], false, "R85-1 a plan another member holds"],
  ["A", "Adult", [], [], true, "R85-1 Adult is neutral"],
  ["A", "Child", [], [], true, "R85-1 Child is neutral"],
  ["A", "Per Visit", [], [], true, "R85-1 Per Visit is neutral"],
  [null, "Adult", ["Child"], [], true, "R85-1 Adult and Child columns are not plans"],
  ["A", "Insured Person", [], [], false, "R85-1 any other heading is refused for a cover that prints a plan"],
  [null, "Insured Person", [], [], true, "R85-1 neutral heading, cover prints no plan"],
  ["Business", "Classic", [], [], false, "a lone column of another plan (Classic figures for a Business holder)"],
  ["A", "Plan A (S$)", [], [], true, "R86-1 currency in brackets"],
  ["A", "Plan A Per Visit", [], [], true, "R86-1 unit"],
  ["A", "Plan A - SGD", [], [], true, "R86-1 currency"],
  ["A", "Plan A [SGD] per policy year", [], [], true, "R86-1 currency and unit"],
  ["A", "Plan A (Adult)", [], [], true, "R86-1 adult in brackets"],
  ["B", "Plan A (S$)", [], [], false, "R86-1 other plan with currency"],
  ["B", "Plan A Per Visit", ["Plan B Per Visit"], [], false, "R86-1 other plan with unit"],
  ["Max", "Max", [], [], true, "R86-1 a plan named Max"],
  ["Gold", "Annual Gold", ["Single Trip Gold"], [], false, "R87-1 annual variant"],
  ["Annual Gold", "Gold", [], [], false, "R87-1 plain column for a variant plan"],
  ["Annual Gold", "Annual Gold", ["Single Trip Gold"], [], true, "R87-1 same variant"],
  ["Annual Gold", "Annual Gold (S$)", [], [], true, "R87-1 same variant with currency"],
  ["Plan A", "Plan A Annual", [], [], false, "R87-1 Plan A Annual is not Plan A"],
  ["Single Trip Classic", "Annual Classic", ["Single Trip Classic"], [], false, "R87-2 trip type"],
  ["Lifetime Shield", "Shield", [], [], false, "R87 part of the plan's name"],
  [null, "Single Trip Gold", ["Single Trip Platinum"], [], false, "R87-2 variant column, cover prints no plan"],
  ["Healthy", "Annual Healthy", [], [], false, "R87 own plan inside a longer column"],
  ["Healthy", "Annual Healthy", [], ["Annual Healthy"], false, "R87 another member's plan"],
  ["Gold (Single Trip)", "Gold (Annual)", ["Gold (Single Trip)"], [], false, "R88-1 bracketed trip type is kept"],
  ["Platinum", "Single Trip (Gold)", ["Single Trip (Platinum)"], [], false, "R88-1 Gold limits for a Platinum holder"],
  ["Single Trip Platinum", "Single Trip (Platinum)", ["Single Trip (Gold)"], [], true, "R88-1 brackets do not change the words"],
  ["Platinum", "Max Limit", [], [], false, "R88-2 refused for a plan holder: cannot be told from a plan name"],
  [null, "Max Limit (S$)", [], [], true, "R88-2 Max Limit with currency is neutral"],
  [null, "Core Benefits", [], [], true, "R88-2 Core Benefits is neutral"],
  [null, "Gold", ["Platinum"], [], false, "a document's plans side by side, cover prints no plan"],
  [null, "Gold", [], ["Gold"], false, "a plan another member holds, cover prints no plan"],
  [null, "Shield", [], ["Lifetime Shield"], false, "part of a plan another member holds, cover prints no plan"],
  [null, "Max Limit", [], [], true, "R88-2 neutral for a cover with no plan"],
];
test("plan columns (R85 to R88): one rule, every case", () => {
  const wrong = PLAN_COLUMN_CASES.filter(([plan, column, siblings, others, shown]) => (planCase(plan, column, siblings, others).rows.length > 0) !== shown)
    .map(([plan, column, , , shown, why]) => `${why}: plan ${plan} / column "${column}" should be ${shown ? "shown" : "refused"}`);
  assert.deepEqual(wrong, []);
  const c = planCase(null, "Plan B");
  assert.match(c.refused[0].why, /prints no plan/);
});
test("R85-2: a figure whose own words say non-guaranteed or projected is shown as a projection, whatever the model said", () => {
  const ilpPage: SourceDoc = { id: "pj", name: "Policy summary.pdf", readable: true, pages: [{ page: 1, text:
    "Lim Wei Jie\tSum assured S$100,000\nNon-Guaranteed Surrender Value S$12,400\nTotal Maturity Value at 4.25% p.a. S$58,000\nGuaranteed Death Benefit S$100,000" }] };
  const r = checkReading(ilpPage, { document: { kind: "personal_proof", product: "SaveMore", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: "Lim Wei Jie", product: "SaveMore", cover: "SaveMore", plan: null, sumInsured: 100000, asOf: null, page: 1, quote: "Lim Wei Jie Sum assured S$100,000" }],
    benefits: [benefit({ benefit: "Surrender value", pays: "value", value: 12400, quote: "Non-Guaranteed Surrender Value S$12,400" }),
      benefit({ benefit: "Maturity value", pays: "amount", value: 58000, quote: "Total Maturity Value at 4.25% p.a. S$58,000" }),
      benefit({ benefit: "Death", pays: "amount", value: 100000, quote: "Guaranteed Death Benefit S$100,000" })] });
  const t = assembleTable([r], family, [{ section: sectionKeyOf("pj", { section: null, column: null }), cover: coverKeyOf({ product: "SaveMore", cover: "SaveMore", plan: null }), why: "x" }]);
  const kind = (name: string) => t.people[0].rows.find((x) => x.benefit === name)!.figure.kind;
  assert.equal(kind("Surrender value"), "projected");
  assert.equal(kind("Maturity value"), "projected");
  assert.equal(kind("Death"), "printed");
});
test("R85-6: a correction applies to every copy of the person's cover", () => {
  const two = checkReading({ ...cert, pages: [{ page: 1, text: "GROUP PERSONAL ACCIDENT\nLim Wei Jie\tS$200,000\nLim Wei Jie\tS$250,000" }] },
    doc("personal_proof", [cover("Lim Wei Jie", "Group Personal Accident", 200000, "Lim Wei Jie S$200,000"), cover("Lim Wei Jie", "Group Personal Accident", 250000, "Lim Wei Jie S$250,000")], []));
  const t = assembleTable([two], family, [], [{ personId: "a", coverKey: gpa, status: "corrected", sumInsured: 300000 }]);
  const covers = t.people[0].covers;
  assert.equal(covers.length, 2);
  assert.ok(covers.every((c) => c.sumInsured === 300000 && c.confirmation?.status === "corrected"));
  assert.deepEqual(covers.map((c) => c.confirmation!.printed).sort(), [200000, 250000]);
});

test("R89-1: a column's child, adult or per-family words travel with the row as its qualifier", () => {
  assert.equal(qualifierOf("Gold Child"), "child");
  assert.equal(qualifierOf("Gold Per Family"), "per family");
  assert.equal(qualifierOf("Plan A (Adult) per person"), "adult, per person");
  assert.equal(qualifierOf("Gold"), null);
  assert.equal(qualifierOf(null), null);
  const rows = planCase("Gold", "Gold Child").rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qualifier, "child");
  assert.equal(planCase("Gold", "Gold").rows[0].qualifier, null);
});

// A percentage with a printed cap: the amount is never more than the cap (run-02 showed S$1,000,000 for "100% Sum
// Insured (up to S$400,000)").
const capped: SourceDoc = { id: "capped", name: "Product summary.pdf", readable: true, pages: [
  { page: 5, text: "GROUP TERM LIFE\nAdvance Payment Benefit 100% Sum Insured (up to S$400,000)\nTerminal Illness 100% of Sum Insured" },
  { page: 6, text: "GROUP PERSONAL ACCIDENT\nComatose State Lump Sum Benefit 15% of Sum Insured or\nup to S$50,000, whichever is lesser\nBurns 10% of Sum Insured, maximum $5,000\n\n\n" +
    "x".repeat(600) + "\nAnother benefit up to S$1,000" },
  { page: 7, text: "GROUP PERSONAL ACCIDENT\nIntensive Care Benefit: an additional 20% of the Sum Insured\nsubject to a maximum amount of S$25,000 per life.\n• Next item 10% of Sum Insured" },
] };
const capRead = (o: Record<string, unknown>) => checkReading(capped, doc("product_summary", [], [benefit({ pays: "percent", percentOf: "sum_insured", ...o })]));
const capLinks = (r: ReturnType<typeof capRead>) => [...new Set(r.benefits.map((b) => b.section))].map((sec) => ({ section: sectionKeyOf("capped", { section: sec, column: null }), cover: sec === "GROUP TERM LIFE" ? gtl : gpa, why: "x" }));
const capRows = (r: ReturnType<typeof capRead>, id = "a") => assembleTable([certReading, r], family, capLinks(r)).people.find((p) => p.id === id)!.rows;
// Critic R169-1: a cap printed for some insured persons only is never the row's.
test("caps: a cap the row prints for a child or an age group only, unread, gives no amount", () => {
  const groups: SourceDoc = { id: "capped", name: "Product summary.pdf", readable: true, pages: [
    { page: 6, text: "GROUP PERSONAL ACCIDENT\nAccidental Death 100% of Sum Insured (Child: limited to S$50,000)\nDisappearance 100% of Sum Insured, maximum S$200,000 for insured persons above age 70" },
  ] };
  for (const [benefitName, quote] of [["Accidental Death", "Accidental Death 100% of Sum Insured (Child: limited to S$50,000)"], ["Disappearance", "Disappearance 100% of Sum Insured, maximum S$200,000 for insured persons above age 70"]]) {
    const r = checkReading(groups, doc("product_summary", [], [benefit({ pays: "percent", percentOf: "sum_insured", section: "GROUP PERSONAL ACCIDENT", benefit: benefitName, value: 100, page: 6, quote })]));
    const f = capRows(r)[0].figure;
    assert.equal(f.kind, "none", `${benefitName}: ${figureText(f)}`);
  }
});
test("caps: a percentage over its printed cap shows the cap, with the cap's own words", () => {
  const r = capRead({ section: "GROUP TERM LIFE", benefit: "Advance Payment Benefit", value: 100, page: 5, quote: "Advance Payment Benefit 100% Sum Insured (up to S$400,000)", cap: 400000, capQuote: "(up to S$400,000)" });
  assert.equal(r.benefits[0].cap, 400000);
  const row = capRows(r)[0];
  assert.equal(row.figure.kind === "worked_out" && row.figure.amount, 400000, figureText(row.figure));
  assert.ok(row.figure.kind === "worked_out" && row.figure.capped);
  assert.match(figureText(row.figure), /100% of S\$500,000 .* is more than the most it pays, so up to S\$400,000/);
  assert.equal(row.capSource?.page, 5);
});
test("caps: a percentage under its cap is worked out as usual, and says the limit", () => {
  const r = capRead({ section: "GROUP PERSONAL ACCIDENT", benefit: "Comatose State Lump Sum Benefit", value: 15, page: 6, quote: "Comatose State Lump Sum Benefit 15% of Sum Insured or up to S$50,000, whichever is lesser", cap: 50000, capQuote: "up to S$50,000, whichever is lesser" });
  const lim = capRows(r)[0], tan = capRows(r, "b")[0];
  assert.equal(lim.figure.kind === "worked_out" && lim.figure.amount, 30000, figureText(lim.figure));
  assert.match(figureText(lim.figure), /within its limit of S\$50,000/);
  assert.equal(tan.figure.kind === "worked_out" && tan.figure.amount, 15000);
});
// Overnight run 23 Oct (N016, N083): a cap the reading did not give, but the row's own words print as its one money figure
// right after a cap word, is the row's cap. Never the uncapped figure.
test("caps: words that say capped with no cap read give the one cap the row prints, never the uncapped figure", () => {
  const r = capRead({ benefit: "Advance Payment Benefit", section: "GROUP TERM LIFE", value: 100, page: 5, quote: "Advance Payment Benefit 100% Sum Insured (up to S$400,000)" });
  const row = capRows(r)[0];
  assert.equal(row.figure.kind === "worked_out" && row.figure.amount, 400000, figureText(row.figure));
  // Another limit near the row ("Another benefit up to S$1,000" a few lines below) may be this row's too: no amount (TE pr113 A8).
  const burns = capRead({ benefit: "Burns", section: "GROUP PERSONAL ACCIDENT", value: 10, page: 6, quote: "Burns 10% of Sum Insured, maximum $5,000" });
  assert.equal(burns.benefits[0].capUnread, true);
  assert.equal(capRows(burns)[0].figure.kind, "none", figureText(capRows(burns)[0].figure));
});
test("caps: a cap whose words are not next to the row, not on its page, or not the claimed figure is refused, and no amount is shown", () => {
  const base = { section: "GROUP PERSONAL ACCIDENT", benefit: "Comatose State Lump Sum Benefit", value: 15, page: 6, quote: "Comatose State Lump Sum Benefit 15% of Sum Insured or up to S$50,000, whichever is lesser" };
  for (const bad of [{ cap: 1000, capQuote: "Another benefit up to S$1,000" }, { cap: 400000, capQuote: "(up to S$400,000)" }, { cap: 60000, capQuote: "up to S$50,000, whichever is lesser" }, { cap: 50000, capQuote: null }]) {
    const r = capRead({ ...base, ...bad });
    assert.equal(r.benefits[0].cap, null, JSON.stringify(bad));
    assert.match(r.dropped.map((d) => d.why).join(";"), /not printed in the row/);
    assert.equal(capRows(r)[0].figure.kind, "none");
  }
  // The row above's limit is never this row's, even on the next line: the claimed cap is refused and no amount is shown.
  const ti = capRead({ section: "GROUP TERM LIFE", benefit: "Terminal Illness", value: 100, page: 5, quote: "Terminal Illness 100% of Sum Insured", cap: 400000, capQuote: "(up to S$400,000)" });
  assert.equal(ti.benefits[0].cap, null);
  assert.equal(capRows(ti)[0].figure.kind, "none");
});
test("caps: a limit printed on the lines that continue the row is read as a cap too", () => {
  const r = capRead({ section: "GROUP PERSONAL ACCIDENT", benefit: "Intensive Care Benefit", value: 20, page: 7, quote: "Intensive Care Benefit: an additional 20% of the Sum Insured" });
  const unread = capRows(r)[0].figure;
  assert.equal(unread.kind === "worked_out" && unread.amount, 25000, figureText(unread));
  const ok = capRead({ section: "GROUP PERSONAL ACCIDENT", benefit: "Intensive Care Benefit", value: 20, page: 7, quote: "Intensive Care Benefit: an additional 20% of the Sum Insured", cap: 25000, capQuote: "subject to a maximum amount of S$25,000 per life" });
  const f = capRows(ok)[0].figure;
  assert.equal(f.kind === "worked_out" && f.amount, 25000, figureText(f));
  const next = capRead({ section: "GROUP PERSONAL ACCIDENT", benefit: "Next item", value: 10, page: 7, quote: "Next item 10% of Sum Insured" });
  assert.equal(capRows(next)[0].figure.kind, "worked_out", "the row above's limit is not this row's");
});
// Critic R95 probes, in tab and space layouts: the row is read from where its quote is printed, a continuation line
// must go on with the row (lower-case or a connective), and a quote that runs into the next row is refused.
for (const [layout, sep] of [["tab", "\t"], ["space", " "]] as const) {
  const probe: SourceDoc = { id: `probe-${layout}`, name: "Probe.pdf", readable: true, pages: [
    { page: 1, text: `GROUP PERSONAL ACCIDENT\nHip${sep}75% of Sum Insured\nor up to S$50,000, whichever is lesser\nKnee${sep}10% of Sum Insured` },
    { page: 2, text: `GROUP PERSONAL ACCIDENT\nHip${sep}75%\nWrist${sep}20% up to S$5,000\nAnkle${sep}10%` },
    { page: 3, text: `GROUP PERSONAL ACCIDENT\nHip${sep}75%${sep}Wrist${sep}20% up to S$5,000` },
  ] };
  const read1 = (o: Record<string, unknown>) => checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", ...o })]));
  const rowOf = (r: ReturnType<typeof read1>) => assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0];
  test(`R95 N5 (${layout}): a cap on the next line, not read, is that cap, never 75% uncapped`, () => {
    const r = read1({ benefit: "Hip", value: 75, page: 1, quote: "Hip 75% of Sum Insured" });
    const f = rowOf(r).figure;
    assert.equal(f.kind === "worked_out" && f.amount, 50000, figureText(f));
  });
  test(`R95 N4 (${layout}): the same cap read is kept and applied`, () => {
    const r = read1({ benefit: "Hip", value: 75, page: 1, quote: "Hip 75% of Sum Insured", cap: 50000, capQuote: "or up to S$50,000, whichever is lesser" });
    assert.equal(r.benefits[0].cap, 50000, JSON.stringify(r.dropped));
    const f = rowOf(r).figure;
    assert.equal(f.kind === "worked_out" && f.amount, 50000, figureText(f));
    const knee = rowOf(read1({ benefit: "Knee", value: 10, page: 1, quote: "Knee 10% of Sum Insured" })).figure;
    assert.equal(knee.kind === "worked_out" && knee.amount, 20000, "the row after a capped row is not capped");
  });
  test(`R95 N1 (${layout}): the next row's limit is never this row's`, () => {
    const r = read1({ benefit: "Hip", value: 75, page: 2, quote: "Hip 75%", cap: 5000, capQuote: "up to S$5,000" });
    assert.equal(r.benefits[0].cap, null);
    assert.equal(rowOf(r).figure.kind, "none");
    const plain = rowOf(read1({ benefit: "Hip", value: 75, page: 2, quote: "Hip 75%" })).figure;
    assert.equal(plain.kind === "worked_out" && plain.amount, 150000, figureText(plain));
    const wrist = read1({ benefit: "Wrist", value: 20, page: 2, quote: "Wrist 20% up to S$5,000", cap: 5000, capQuote: "up to S$5,000" });
    const wf = rowOf(wrist).figure;
    assert.equal(wf.kind === "worked_out" && wf.amount, 5000, figureText(wf));
    const sameLine = read1({ benefit: "Hip", value: 75, page: 3, quote: "Hip 75%", cap: 5000, capQuote: "up to S$5,000" });
    assert.equal(sameLine.benefits[0].cap, null, "the next row on the same line is not this row's");
  });
  test(`R95 N3 (${layout}): a quote that runs into the next row is refused`, () => {
    const r = read1({ benefit: "Hip", value: 75, page: 2, quote: "Hip 75% Wrist 20% up to S$5,000", cap: 5000, capQuote: "up to S$5,000" });
    assert.equal(r.benefits.length, 0);
    assert.match(r.dropped[0].why, /more than one row/);
  });
}
// Critic R96-1: a lettered, numbered or lower-case row below is its own row, never a continuation of the one above.
for (const [layout, hip, wrist] of [
  ["(a)/(b)", "(a) Hip 75%", "(b) Wrist 20% up to S$5,000"],
  ["a)/b)", "a) Hip 75%", "b) Wrist 20% up to S$5,000"],
  ["(i)/(ii)", "(i) Hip 75%", "(ii) Wrist 20% up to S$5,000"],
  ["lower-case", "hip fracture 75%", "wrist fracture 20% up to S$5,000"],
  ["1./2.", "1. Hip 75%", "2. Wrist 20% up to S$5,000"],
] as const) {
  const probe: SourceDoc = { id: "probe-r96", name: "Probe.pdf", readable: true, pages: [
    { page: 1, text: `GROUP PERSONAL ACCIDENT\n${hip}\n${wrist}\nAnkle 10%` },
    { page: 2, text: `GROUP PERSONAL ACCIDENT\n${hip}\n(up to S$50,000, whichever is lesser)\n${wrist}` },
  ] };
  const read1 = (o: Record<string, unknown>) => checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", ...o })]));
  const rowOf = (r: ReturnType<typeof read1>) => assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0];
  test(`R96-1 (${layout}): the next row's cap is never this row's`, () => {
    const claimed = read1({ benefit: "Hip", value: 75, page: 1, quote: hip, cap: 5000, capQuote: "up to S$5,000" });
    assert.equal(claimed.benefits[0].cap, null, JSON.stringify(claimed.benefits[0]));
    assert.equal(rowOf(claimed).figure.kind, "none", "a claimed cap that is not this row's gives no amount");
    const plain = rowOf(read1({ benefit: "Hip", value: 75, page: 1, quote: hip })).figure;
    assert.equal(plain.kind === "worked_out" && plain.amount, 150000, figureText(plain));
    const own = rowOf(read1({ benefit: "Wrist", value: 20, page: 1, quote: wrist, cap: 5000, capQuote: "up to S$5,000" })).figure;
    assert.equal(own.kind === "worked_out" && own.amount, 5000, figureText(own));
  });
  test(`R96-1 (${layout}): a bracketed limit under the row is still its own`, () => {
    const r = read1({ benefit: "Hip", value: 75, page: 2, quote: hip, cap: 50000, capQuote: "up to S$50,000, whichever is lesser" });
    assert.equal(r.benefits[0].cap, 50000, JSON.stringify(r.dropped));
    const unread = rowOf(read1({ benefit: "Hip", value: 75, page: 2, quote: hip })).figure;
    assert.equal(unread.kind === "worked_out" && unread.amount, 50000, "an unread limit under the row is that limit");
  });
}
// Critic R97: a row's own cap line that starts with a cap word or connective is never cut off, even when it looks like
// an item marker ("max. ") or has its own percentage ("or 200% of premiums paid").
for (const [name, rowText, capLine, benefitName, value] of [
  ["max.", "Hip\t75% of Sum Insured", "max. S$50,000", "Hip", 75],
  ["Max.", "Hip\t75% of Sum Insured", "Max. S$50,000", "Hip", 75],
  ["or 200% of premiums", "Death\t100% of Sum Insured", "or 200% of premiums paid, whichever is lower", "Death", 100],
] as const) {
  const probe: SourceDoc = { id: "probe-r97", name: "Probe.pdf", readable: true, pages: [
    { page: 1, text: `GROUP PERSONAL ACCIDENT\n${rowText}\n${capLine}\nKnee\t10% of Sum Insured` },
    { page: 2, text: `GROUP PERSONAL ACCIDENT\n${rowText}\nPayable once per life.\n${capLine}` },
  ] };
  const read1 = (o: Record<string, unknown>) => checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", ...o })]));
  const rowOf = (r: ReturnType<typeof read1>) => assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0];
  const quote = rowText.replace("\t", " ");
  test(`R97 (${name}): the row's own cap line, unread, is that cap or no amount, never the uncapped figure`, () => {
    const r = read1({ benefit: benefitName, value, page: 1, quote });
    const f = rowOf(r).figure;
    // "or 200% of premiums paid" is a second limit, not a money cap: no amount.
    if (name === "or 200% of premiums") assert.equal(f.kind, "none", figureText(f));
    else assert.equal(f.kind === "worked_out" && f.amount, 50000, figureText(f));
  });
  if (name !== "or 200% of premiums") test(`R97 (${name}): the cap line read is kept and applied`, () => {
    const r = read1({ benefit: benefitName, value, page: 1, quote, cap: 50000, capQuote: capLine });
    const f = rowOf(r).figure;
    assert.equal(f.kind === "worked_out" && f.amount, 50000, figureText(f) + JSON.stringify(r.dropped));
  });
  test(`R97 (${name}) backstop: a cap line below a line that is not joined still marks the row capped`, () => {
    const r = read1({ benefit: benefitName, value, page: 2, quote });
    assert.equal(rowOf(r).figure.kind, "none", figureText(rowOf(r).figure));
  });
}
// Critic R98-1 (D1): a tab-laid row whose label starts with a cap word is its own row, not the row above's cap line.
test("R98-1 (D1): 'Maximum Disablement' on the next tab row never caps Hip, and Hip withholds its amount", () => {
  const probe: SourceDoc = { id: "probe-r98", name: "Probe.pdf", readable: true, pages: [
    { page: 1, text: "GROUP PERSONAL ACCIDENT\nHip\t75%\nMaximum Disablement\t20% up to S$5,000" },
  ] };
  const read1 = (o: Record<string, unknown>) => checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", ...o })]));
  const rowOf = (r: ReturnType<typeof read1>) => assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0];
  const claimed = read1({ benefit: "Hip", value: 75, page: 1, quote: "Hip 75%", cap: 5000, capQuote: "up to S$5,000" });
  assert.equal(claimed.benefits[0].cap, null);
  assert.equal(rowOf(claimed).figure.kind, "none");
  // A line below that starts with a cap word may be Hip's limit, so Hip withholds its amount (coordinator's fail-safe rule).
  assert.equal(rowOf(read1({ benefit: "Hip", value: 75, page: 1, quote: "Hip 75%" })).figure.kind, "none");
  const own = rowOf(read1({ benefit: "Maximum Disablement", value: 20, page: 1, quote: "Maximum Disablement 20% up to S$5,000", cap: 5000, capQuote: "up to S$5,000" })).figure;
  assert.equal(own.kind === "worked_out" && own.amount, 5000, figureText(own));
});
// Test engineer L12-L14: only a line starting with a connective or cap word joins the row. A lower-case neighbour with a
// limit is never joined, and since it may be this row's limit the row shows no amount rather than either figure.
for (const [layout, below] of [
  ["L12", "wrist fracture: up to S$5,000"],
  ["L13", "wrist fracture (max S$5,000)"],
  ["L14", "wrist fracture, max S$5,000"],
] as const) test(`TE ${layout}: "${below}" under Hip is never Hip's cap, and Hip shows no amount`, () => {
  const probe: SourceDoc = { id: "probe-l12", name: "Probe.pdf", readable: true, pages: [{ page: 1, text: `GROUP PERSONAL ACCIDENT\nHip 75%\n${below}` }] };
  const read1 = (o: Record<string, unknown>) => checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", ...o })]));
  const rowOf = (r: ReturnType<typeof read1>) => assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0];
  const claimed = read1({ benefit: "Hip", value: 75, page: 1, quote: "Hip 75%", cap: 5000, capQuote: below.replace(/^wrist fracture[:,]? ?\(?|\)$/g, "") });
  assert.equal(claimed.benefits[0].cap, null);
  assert.equal(rowOf(claimed).figure.kind, "none", figureText(rowOf(claimed).figure));
  const plain = read1({ benefit: "Hip", value: 75, page: 1, quote: "Hip 75%" });
  assert.equal(rowOf(plain).figure.kind, "none", figureText(rowOf(plain).figure));
});
// Test engineer L19-L21: two-column extractions put the neighbour on Hip's own line. The rest of the line joins only when
// it starts with a connective or cap word, so the neighbour's cap is never Hip's and Hip shows no amount.
for (const [layout, line, capQuote] of [
  ["L19", "Hip\t75%\twrist fracture: up to S$5,000", "up to S$5,000"],
  ["L20", "Hip 75%    Wrist fracture (max S$5,000)", "max S$5,000"],
  ["L21", "Hip\t75%\tWrist fracture, max S$5,000", "max S$5,000"],
] as const) test(`TE ${layout}: a neighbour on the row's own line is never its cap, and the row shows no amount`, () => {
  const probe: SourceDoc = { id: "probe-l19", name: "Probe.pdf", readable: true, pages: [{ page: 1, text: `GROUP PERSONAL ACCIDENT\n${line}` }] };
  const read1 = (o: Record<string, unknown>) => checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", ...o })]));
  const rowOf = (r: ReturnType<typeof read1>) => assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0];
  const claimed = read1({ benefit: "Hip", value: 75, page: 1, quote: "Hip 75%", cap: 5000, capQuote });
  assert.equal(claimed.benefits[0].cap, null);
  assert.equal(rowOf(claimed).figure.kind, "none", figureText(rowOf(claimed).figure));
  const plain = read1({ benefit: "Hip", value: 75, page: 1, quote: "Hip 75%" });
  assert.equal(rowOf(plain).figure.kind, "none", figureText(rowOf(plain).figure));
});
test("the row's own line keeps its own cap when the rest of the line starts with one", () => {
  const probe: SourceDoc = { id: "probe-own", name: "Probe.pdf", readable: true, pages: [{ page: 1, text: "GROUP PERSONAL ACCIDENT\nHip 75% (up to S$50,000)" }] };
  const r = checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", benefit: "Hip", value: 75, page: 1, quote: "Hip 75%", cap: 50000, capQuote: "up to S$50,000" })]));
  assert.equal(r.benefits[0].cap, 50000, JSON.stringify(r.dropped));
});
// Critic R99: E1, a lower-case line below with a limit may be the row's own, so the row withholds its amount; E8, a joined
// line with its own percentage never gives this row a cap, on the next line or the same line.
for (const [name, text, capQuote] of [
  ["E1", "Hip\t75% of Sum Insured\nwhich is payable up to S$50,000", "up to S$50,000"],
  ["E8", "Hip 75%\nMaximum Disablement 20% up to S$5,000", "up to S$5,000"],
  ["E8 same line", "Hip 75% Maximum Disablement 20% up to S$5,000", "up to S$5,000"],
] as const) test(`R99 ${name}: no cap from a line that may be another row's, and the row shows no amount`, () => {
  const probe: SourceDoc = { id: "probe-r99", name: "Probe.pdf", readable: true, pages: [{ page: 1, text: `GROUP PERSONAL ACCIDENT\n${text}` }] };
  const read1 = (o: Record<string, unknown>) => checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", ...o })]));
  const rowOf = (r: ReturnType<typeof read1>) => assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0];
  const quote = name === "E1" ? "Hip 75% of Sum Insured" : "Hip 75%";
  const plain = read1({ benefit: "Hip", value: 75, page: 1, quote });
  assert.equal(rowOf(plain).figure.kind, "none", figureText(rowOf(plain).figure));
  if (name !== "E1") {
    const claimed = read1({ benefit: "Hip", value: 75, page: 1, quote, cap: 5000, capQuote });
    assert.equal(claimed.benefits[0].cap, null);
    assert.equal(rowOf(claimed).figure.kind, "none");
  }
});
// TE L22-L23: a two-column line whose rest holds Hip's own cap and then the next row. A claimed cap in the part before
// the next row is Hip's; with none claimed, Hip withholds its amount, never S$450,000 uncapped.
for (const [layout, line, quote] of [
  ["L22", "Hip\t75% up to S$50,000\tWrist\t20% up to S$5,000", "Hip 75%"],
  ["L23", "Hip 75% up to S$50,000    Wrist 20% up to S$5,000", "Hip 75%"],
] as const) test(`TE ${layout}: the rest of the row's line is never ignored`, () => {
  const probe: SourceDoc = { id: "probe-l22", name: "Probe.pdf", readable: true, pages: [{ page: 1, text: `GROUP PERSONAL ACCIDENT\n${line}` }] };
  const read1 = (o: Record<string, unknown>) => checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", ...o })]));
  const rowOf = (r: ReturnType<typeof read1>) => assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0];
  // With none claimed, the part of the line before the next row prints Hip's one cap: that cap, never S$450,000.
  const unread = rowOf(read1({ benefit: "Hip", value: 75, page: 1, quote })).figure;
  assert.ok(unread.kind === "none" || (unread.kind === "worked_out" && unread.amount === 50000), figureText(unread));
  const own = rowOf(read1({ benefit: "Hip", value: 75, page: 1, quote, cap: 50000, capQuote: "up to S$50,000" })).figure;
  assert.equal(own.kind === "worked_out" && own.amount, 50000, figureText(own));
  const wrong = read1({ benefit: "Hip", value: 75, page: 1, quote, cap: 5000, capQuote: "up to S$5,000" });
  assert.equal(wrong.benefits[0].cap, null, "Wrist's cap is never Hip's");
  assert.equal(rowOf(wrong).figure.kind, "none");
});
// Critic R100 F1-F3: an upper-case line under the row that carries a cap word may go on with the row's own cap.
for (const [name, line] of [
  ["F1", "Payable up to S$50,000 per accident"],
  ["F2", "Which is payable up to S$50,000"],
  ["F3", "Per accident limit S$50,000"],
] as const) test(`R100 ${name}: "${line}" under the row withholds the uncapped amount`, () => {
  const probe: SourceDoc = { id: "probe-r100", name: "Probe.pdf", readable: true, pages: [{ page: 1, text: `GROUP PERSONAL ACCIDENT\nHip\t75% of Sum Insured\n${line}` }] };
  const r = checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", benefit: "Hip", value: 75, page: 1, quote: "Hip 75% of Sum Insured" })]));
  assert.equal(r.benefits[0].capUnread, true);
  const row = assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0];
  assert.equal(row.figure.kind, "none", figureText(row.figure));
});
// Critic R101: E3, a limit three lines below still withholds; G1/G2, a second percentage limit with the cap withholds
// even when the cap is read; a cap column ("Hip\t75%\tup to S$50,000") is read.
for (const [name, text, quote, claim, expect] of [
  ["E3", "Hip\t75% of Sum Insured\nPayable once per life.\nSee the notes.\nup to S$50,000", "Hip 75% of Sum Insured", null, "none"],
  ["G1", "Hip 75% of Sum Insured up to S$50,000 or 10% of annual salary, whichever is lower", "Hip 75% of Sum Insured", "up to S$50,000", "none"],
  ["G2", "Hip 75% of Sum Insured\nup to S$50,000 or 10% of annual salary, whichever is lower", "Hip 75% of Sum Insured", "up to S$50,000", "none"],
  ["cap column", "Hip\t75%\tup to S$50,000\nKnee\t10%\tup to S$5,000", "Hip 75%", "up to S$50,000", 50000],
  ["G3", "Hip 75% of Sum Insured up to S$50,000 or 10% of annual salary, whichever is lower", "Hip 75% of Sum Insured up to S$50,000", "up to S$50,000", "none"],
  ["H2", "Hip 75% of Sum Insured up to S$50,000 Or 10% of annual salary, whichever is lower", "Hip 75% of Sum Insured", "up to S$50,000", "none"],
  ["H3", "Hip 75% of Sum Insured up to S$50,000 or S$500 per day, whichever is lower", "Hip 75% of Sum Insured", "up to S$50,000", "none"],
  ["H3 in the quote", "Hip 75% of Sum Insured up to S$50,000 or S$500 per day, whichever is lower", "Hip 75% of Sum Insured up to S$50,000 or S$500 per day, whichever is lower", "up to S$50,000", "none"],
  ["I2", "Hip\t75% of Sum Insured up to S$50,000\nper accident, or S$500 per day, whichever is lower", "Hip 75% of Sum Insured", "up to S$50,000", "none"],
  ["I4", "Hip 75% of Sum Insured up to S$50,000 or 500 per day, whichever is lower", "Hip 75% of Sum Insured", "up to S$50,000", "none"],
  ["I4 in the quote", "Hip 75% of Sum Insured up to S$50,000 or 500 per day, whichever is lower", "Hip 75% of Sum Insured up to S$50,000 or 500 per day, whichever is lower", "up to S$50,000", "none"],
  ["next row in the same line's cells", "Hip\t75%\tWrist\t20% up to S$5,000", "Hip 75%", null, 150000],
  ["next row in cells, label starts with a cap word", "Hip\t75%\tMaximum Disablement\t20% up to S$5,000", "Hip 75%", null, "none"],
  ["K5", "Hip\t75% of Sum Insured\tPayable up to\t50% of S$100,000", "Hip 75% of Sum Insured", null, "none"],
  ["Or in its own cell", "Hip\t75% of Sum Insured\tOr\t10% of annual salary, whichever is lower", "Hip 75% of Sum Insured", null, "none"],
  ["next row stops the look-down", "Hip 75%\nKnee 10%\nElbow 10%\nAmbulance up to S$500", "Hip 75%", null, 150000],
] as const) test(`R101 ${name}`, () => {
  const probe: SourceDoc = { id: "probe-r101", name: "Probe.pdf", readable: true, pages: [{ page: 1, text: `GROUP PERSONAL ACCIDENT\n${text}` }] };
  const r = checkReading(probe, doc("product_summary", [], [benefit({ section: "GROUP PERSONAL ACCIDENT", pays: "percent", percentOf: "sum_insured", benefit: "Hip", value: 75, page: 1, quote, ...(claim ? { cap: 50000, capQuote: claim } : {}) })]));
  const f = assembleTable([certReading, r], family, [{ section: sectionKeyOf(probe.id, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "x" }]).people.find((p) => p.id === "a")!.rows[0].figure;
  if (expect === "none") assert.equal(f.kind, "none", figureText(f));
  else assert.equal(f.kind === "worked_out" && f.amount, expect, figureText(f) + JSON.stringify(r.dropped));
});
test("caps: a reading recorded before caps were read still never shows an uncapped figure", () => {
  const r = capRead({ section: "GROUP TERM LIFE", benefit: "Advance Payment Benefit", value: 100, page: 5, quote: "Advance Payment Benefit 100% Sum Insured (up to S$400,000)" });
  const old = { ...r, benefits: r.benefits.map(({ cap: _c, capQuote: _q, capSource: _s, capUnread: _u, ...b }) => b) } as unknown as typeof r;
  assert.equal(capRows(old)[0].figure.kind, "none");
  const plain = capRead({ section: "GROUP TERM LIFE", benefit: "Terminal Illness", value: 100, page: 5, quote: "Terminal Illness 100% of Sum Insured" });
  const f = capRows(plain)[0].figure;
  assert.equal(f.kind === "worked_out" && f.amount, 500000);
});

test("the reading schema stays within the API's limit of 16 nullable fields, and an optional field is never required", () => {
  const unions = (x: unknown): number => {
    if (!x || typeof x !== "object") return 0;
    const o = x as Record<string, unknown>;
    return (Array.isArray(o.type) || Array.isArray(o.anyOf) ? 1 : 0) + Object.values(o).reduce((n: number, v) => n + (Array.isArray(v) ? v.reduce((m: number, y) => m + unions(y), 0) : unions(v)), 0);
  };
  assert.ok(unions(READING_SCHEMA) <= 16, `${unions(READING_SCHEMA)} nullable fields`);
  assert.ok(unions(LINKING_SCHEMA) <= 16);
  const benefits = (READING_SCHEMA as unknown as { properties: { benefits: { items: { required: string[]; properties: Record<string, unknown> } } } }).properties.benefits.items;
  assert.ok(!benefits.required.includes("fromDay") && "fromDay" in benefits.properties && !JSON.stringify(benefits).includes('"optional"'));
  for (const k of ["value", "percentOf", "baseAmount", "baseQuote", "cap", "capQuote", "quote", "page"]) assert.ok(benefits.required.includes(k), k);
});
test("the reading CLI passes the household's names to the checks, so a page naming another member gives no premium (TE #97)", () => {
  const snap = { accountId: "a", members: [{ name: "Lim Wei Jie (self)", relationship: "self" }, { name: "Tan Mei Ling", relationship: "spouse" }],
    documents: [{ policyId: "p1", name: "s.pdf", processingStatus: "ready", pages: [{ page: 1, text: "x" }] }] } as unknown as Parameters<typeof sourcesOf>[0];
  assert.deepEqual(sourcesOf(snap)[0].people, ["Lim Wei Jie", "Tan Mei Ling"]);
});
test("backfill SQL: inserts only for the account's current policy, never over a stored reading or link, and no text can end its quote", () => {
  const acct = "11111111-2222-4333-8444-555555555555", pol = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const nasty = "x'); DROP TABLE policies; -- $bt0$ $$ \\ end";
  const sql = backfillSql({ accountId: acct, label: "import test", links: [{ section: `${pol}|life|`, cover: null, why: nasty }],
    readings: [{ policyId: pol, model: "m", stored: { document: { note: nasty }, pages: [{ page: 2, json: { note: nasty } }] } }] });
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM policies WHERE id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'::uuid AND account_id='11111111-2222-4333-8444-555555555555'::uuid AND lifecycle_state='active' AND superseded_at IS NULL\)/);
  assert.equal((sql.match(/ON CONFLICT \(policy_id\) DO NOTHING;/g) ?? []).length, 1);
  assert.equal((sql.match(/ON CONFLICT \(account_id, section_key\) DO NOTHING;/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /DO UPDATE|^DELETE|^DROP/m);
  // Every dollar-quoted value opens and closes with the same tag, and the text never contains it.
  for (const m of sql.matchAll(/(\$bt[0-9a-f]{12}\$)([\s\S]*?)\1/g)) assert.ok(!m[2].includes(m[1]));
  const json = /(\$bt[0-9a-f]{12}\$)([\s\S]*?)\1::jsonb/.exec(sql)!;
  assert.deepEqual(JSON.parse(json[2]), { document: { note: nasty }, pages: [{ page: 2, json: { note: nasty } }] });
  assert.throws(() => backfillSql({ accountId: "acct'; --", label: "x", links: [], readings: [] }));
  assert.throws(() => backfillSql({ accountId: acct, label: "x", links: [], readings: [{ policyId: "p'1", model: "m", stored: { document: {}, pages: [] } }] }));
});
console.log(`benefit-table: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
if (failures.length) process.exit(1);
