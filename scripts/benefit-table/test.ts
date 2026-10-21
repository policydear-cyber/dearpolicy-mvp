/** Scripted tests for the benefit table's server checks and assembly (lib/benefit-table). Synthetic pages only, no
 * household data and no model: each case hands checkReading the JSON a model might write.
 *   npm run benefit-table:test */
import assert from "node:assert/strict";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { assembleTable, figureText, sectionKeyOf, coverKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { mergeReadings, pagesToReread } from "@/lib/benefit-table/completeness";

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
  { page: 2, text: "Simple Fracture Benefit Limit: S$5,000\nCompensation (% of S$5,000)\nArm, Elbow or Wrist#\t25%\n# Fractures of thumb and finger are not covered\nAmbulance Cost up to $500 per incident" },
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
test("a day count not in the quote is not kept", () => {
  const r = checkReading(terms, doc("scheme_terms", [], [benefit({ benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 30, fromDay: 8, maxDays: 30, page: 3, quote: "Daily Hospital Cash Benefit S$30 per day from the 11th day onwards. Max: 30 days" })]));
  assert.equal(r.benefits[0].fromDay, null);
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
/** One person's plan cover and one benefit row in a column, linked: the rows the person gets. */
function planCase(plan: string | null, column: string, otherPlans: string[] = []) {
  const people = ["Lim Wei Jie", "Tan Mei Ling", "Lim Kai"];
  const lines = [plan, ...otherPlans].map((p, i) => `${people[i]}\tPlan: ${p ?? "none"}`);
  const proof: SourceDoc = { id: "pc", name: "Schedule.pdf", readable: true, pages: [{ page: 1, text: lines.join("\n") }] };
  const pr = checkReading(proof, { document: { kind: "personal_proof", product: "Shield", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
    covers: [plan, ...otherPlans].map((p, i) => ({ person: people[i], product: "Shield", cover: "Shield", plan: p, sumInsured: null, asOf: null, page: 1, quote: lines[i] })), benefits: [] });
  const table: SourceDoc = { id: "pt", name: "Table.pdf", readable: true, pages: [{ page: 1, text: `Benefits\t${column}\nWard\tS$1,000` }] };
  const tr = checkReading(table, doc("scheme_terms", [], [benefit({ section: "Benefits", column, benefit: "Ward", pays: "up_to", value: 1000, quote: "Ward S$1,000" })]));
  const t = assembleTable([pr, tr], family, [{ section: sectionKeyOf("pt", { section: "Benefits", column }), cover: coverKeyOf({ product: "Shield", cover: "Shield", plan }), why: "x" }]);
  return { rows: t.people[0].rows, refused: t.refusedLinks };
}
test("R85-1: plan A is not plan B, though one name is inside the other", () => {
  assert.equal(planCase("A", "Plan B").rows.length, 0);
  assert.equal(planCase("A", "Plan A").rows.length, 1);
  assert.equal(planCase("Plan A", "A").rows.length, 1);
  assert.equal(planCase("Gold", "Gold Plus").rows.length, 0);
  assert.equal(planCase("Gold Plus", "Gold").rows.length, 0);
});
test("R85-1: a plan column is refused for a cover that prints no plan", () => {
  const c = planCase(null, "Plan B");
  assert.equal(c.rows.length, 0);
  assert.match(c.refused[0].why, /prints no plan/);
  assert.equal(planCase(null, "Business").rows.length, 0);
  assert.equal(planCase(null, "Healthy Choice", ["Healthy Choice"]).rows.length, 0, "a plan another member holds");
});
test("R85-1: a column that names no plan (Adult, Child, Per Visit) is neutral", () => {
  for (const col of ["Adult", "Child", "Per Visit", "Insured Person"]) {
    assert.equal(planCase("A", col).rows.length, 1, col);
    assert.equal(planCase(null, col).rows.length, 1, col);
  }
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

console.log(`benefit-table: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
if (failures.length) process.exit(1);
