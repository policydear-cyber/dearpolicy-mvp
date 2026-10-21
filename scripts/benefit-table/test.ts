/** Scripted tests for the benefit table's server checks and assembly (lib/benefit-table). Synthetic pages only, no
 * household data and no model: each case hands checkReading the JSON a model might write.
 *   npm run benefit-table:test */
import assert from "node:assert/strict";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { assembleTable, figureText, sectionKeyOf, coverKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";

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

console.log(`benefit-table: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
if (failures.length) process.exit(1);
