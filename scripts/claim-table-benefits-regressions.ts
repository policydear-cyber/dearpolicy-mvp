/** Claim estimates from the person's benefit table (lib/claims/table-benefits.ts), for made-up households in three
 * markets. Every amount comes from a row's printed figure, first paid day and most days; anything else is shown as
 * printed with no amount.
 *   npm run claims:table-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessClaim } from "@/lib/claims/rules";
import { enforceMonetarySafety } from "@/lib/claims/monetary-gate";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimFacts } from "@/lib/claims/types";
import { withTableBenefits } from "@/lib/claims/table-benefits";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { claimTable, personCover, printed, tableRow } from "./fixtures/claim-table";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const cover = (o: Partial<OwnedCoverage>): OwnedCoverage => ({ id: "c1", policyId: "p", familyMemberId: "m", category: "Personal Accident", amount: null, currency: "MYR",
  productName: "Harbour Accident Shield", sourcePage: 1, evidenceText: "Sum insured RM 100,000", insurer: "Harbour Assurance", policyName: "Harbour Accident Shield",
  policyNumber: "HA-1", groupPolicyNumber: null, documentRole: "schedule", effectiveDate: "2023-01-01", renewalOrExpiryDate: null, currencyVerified: true, ...o });
const facts = (o: Partial<ClaimFacts>): ClaimFacts => ({ ...EMPTY_CLAIM_FACTS, eventDate: "2026-09-01", uncertainFacts: [], ...o } as ClaimFacts);
const run = (f: ClaimFacts, coverages: OwnedCoverage[], rows: ReturnType<typeof tableRow>[], covers = [personCover("k", "Harbour Accident Shield")]) =>
  enforceMonetarySafety(assessClaim(f, coverages, [], [], null, [], [], undefined, undefined, undefined, claimTable(rows, covers)), f, coverages);

test("a fracture row for the reported body part gives its printed amount, in its own currency (Malaysia)", () => {
  const rows = [tableRow("k", "Harbour Accident Shield", "Wrist", printed(2500, "lump_sum", "MYR"), { section: "Fractures" }),
    tableRow("k", "Harbour Accident Shield", "Hip", printed(9000, "lump_sum", "MYR"), { section: "Fractures" })];
  const items = run(facts({ eventType: "accident", injured: true, injuries: ["fracture"], fractureBodyPart: "left wrist" }), [cover({})], rows);
  const f = items.find((i) => i.id.startsWith("table-fracture"));
  assert.equal(f?.calculatedAmount, 2500); assert.equal(f?.currency, "MYR"); assert.match(f?.amountText ?? "", /2,500/);
  assert.equal(items.filter((i) => i.id.startsWith("table-fracture")).length, 1, "the hip row is not this fracture");
});

test("two different printed figures for the same fracture give no amount, and say both", () => {
  const rows = [tableRow("k", "Harbour Accident Shield", "Wrist (simple)", printed(2500, "lump_sum", "MYR"), { section: "Fractures" }),
    tableRow("k", "Harbour Accident Shield", "Wrist (compound)", printed(5000, "lump_sum", "MYR"), { section: "Fractures" })];
  const f = run(facts({ eventType: "accident", fractureBodyPart: "wrist" }), [cover({})], rows).find((i) => i.id.startsWith("table-fracture"));
  assert.equal(f?.amountText, null); assert.equal(f?.calculatedAmount, undefined); assert.match(f?.reason ?? "", /2,500.*5,000/);
});

test("hospital cash is counted from the printed first paid day and most days (Singapore group scheme)", () => {
  const life = cover({ id: "c2", category: "Death", currency: "SGD", productName: "Group Term Life", evidenceText: "Sum insured S$200,000" });
  const rows = [tableRow("g", "Group Term Life", "Daily Hospital Cash Benefit", printed(40, "per_day", "SGD"), { fromDay: 4, maxDays: 10 })];
  const items = run(facts({ eventType: "hospitalisation", diagnosis: "dengue", hospitalised: true, hospitalNights: 20 }), [life], rows, [personCover("g", "Group Term Life")]);
  const h = items.find((i) => i.id.startsWith("table-hospital-cash"));
  // Days 4 to 13 are paid (10 days at most): 10 x S$40.
  assert.equal(h?.calculatedAmount, 400); assert.equal(h?.currency, "SGD"); assert.equal(h?.status, "likely_applicable");
});

test("a daily rate with no first paid day or no most days read gives no amount", () => {
  const rows = [tableRow("k", "Harbour Accident Shield", "Hospital Income", printed(100, "per_day", "MYR"), { fromDay: null, maxDays: 30 })];
  const h = run(facts({ eventType: "hospitalisation", diagnosis: "fracture", hospitalised: true, hospitalNights: 6 }), [cover({})], rows).find((i) => i.id.startsWith("table-hospital-cash"));
  assert.equal(h?.amountText, null); assert.match(h?.reason ?? "", /first paid day and most days/);
});

test("an ambulance limit is shown as printed, never as the bill (UK-style plan)", () => {
  const uk = cover({ currency: "GBP", productName: "Thames Personal Accident", evidenceText: "Sum insured £50,000" });
  const rows = [tableRow("t", "Thames Personal Accident", "Ambulance costs", printed(300, "up_to", "GBP"))];
  const a = run(facts({ eventType: "accident", ambulanceUsed: true, ambulanceBill: 180 }), [uk], rows, [personCover("t", "Thames Personal Accident")]).find((i) => i.id.startsWith("table-ambulance"));
  assert.equal(a?.amountText, null); assert.match(a?.reason ?? "", /up to GBP 300/i);
});

test("a row not matched to a verified cover, or with no currency, gives no amount", () => {
  const rows = [tableRow("x", "Unknown Plan", "Wrist", printed(2500, "lump_sum", "MYR"), { section: "Fractures", source: { documentId: "other", document: "x.pdf", page: 2, excerpt: "Wrist 2,500" } })];
  const f1 = run(facts({ eventType: "accident", fractureBodyPart: "wrist" }), [cover({})], rows, [personCover("x", "Unknown Plan", "other")]).find((i) => i.id.startsWith("table-fracture"));
  assert.equal(f1?.amountText, null);
  const rows2 = [tableRow("k", "Harbour Accident Shield", "Wrist", printed(2500, "lump_sum", null), { section: "Fractures" })];
  const f2 = run(facts({ eventType: "accident", fractureBodyPart: "wrist" }), [cover({})], rows2).find((i) => i.id.startsWith("table-fracture"));
  assert.equal(f2?.amountText, null); assert.match(f2?.reason ?? "", /currency/);
});

test("a death benefit row pays its printed amount once the death is confirmed; a critical illness never without its definition checked", () => {
  const life = cover({ id: "c3", category: "Death", currency: "GBP", productName: "Thames Term Life", evidenceText: "Sum assured £250,000" });
  const rows = [tableRow("l", "Thames Term Life", "Death Benefit", printed(250000, "lump_sum", "GBP"))];
  const covers = [personCover("l", "Thames Term Life")];
  const d = run(facts({ eventType: "death", death: true, deathDate: "2026-09-01" }), [life], rows, covers).find((i) => i.id.startsWith("table-death"));
  assert.equal(d?.calculatedAmount, 250000); assert.equal(d?.currency, "GBP");
  const unconfirmed = run(facts({ eventType: "death", death: null, deathDate: "2026-09-01" }), [life], rows, covers).find((i) => i.id.startsWith("table-death"));
  assert.equal(unconfirmed?.amountText, null);
  const ci = cover({ id: "c4", category: "Critical Illness", currency: "GBP", productName: "Thames Critical Cover", evidenceText: "£80,000" });
  const c = run(facts({ eventType: "diagnosis", diagnosis: "stroke", diagnosisDate: "2026-09-01" }), [ci], [tableRow("i", "Thames Critical Cover", "Critical Illness Benefit", printed(80000, "lump_sum", "GBP"))], [personCover("i", "Thames Critical Cover")]).find((i) => i.id.startsWith("table-critical-illness"));
  assert.equal(c?.amountText, null); assert.match(c?.reason ?? "", /80,000/);
});

test("no scheme number, product name or benefit amount is written into the claim rules", () => {
  for (const f of ["lib/claims/rules.ts", "lib/claims/table-benefits.ts", "lib/claims/death-evidence.ts", "lib/claims/ci-evidence.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /"G\d{6}"/, `${f} names a group scheme`);
  }
  const rules = readFileSync("lib/claims/rules.ts", "utf8");
  assert.doesNotMatch(rules, /S\$\d|\b5000\s*\*|Math\.min\([^)]*,\s*500\)|- 10\)/, "rules.ts writes a scheme's amount or waiting days");
  assert.doesNotMatch(rules, /Living Care|living-care/, "rules.ts names one scheme's product");
});

test("a body part matches a row only when every word of it is in the row's name (Critic R225, TE P144-1)", () => {
  const rows = [tableRow("k", "Harbour Accident Shield", "Upper jaw", printed(3000, "lump_sum", "MYR"), { section: "Fractures" }),
    tableRow("k", "Harbour Accident Shield", "Neck (cervical vertebrae)", printed(6000, "lump_sum", "MYR"), { section: "Fractures" }),
    tableRow("k", "Harbour Accident Shield", "Arm (humerus)", printed(4000, "lump_sum", "MYR"), { section: "Fractures" })];
  const arm = run(facts({ eventType: "accident", fractureBodyPart: "upper arm" }), [cover({})], rows).filter((i) => i.id.startsWith("table-fracture"));
  assert.deepEqual(arm.map((i) => i.calculatedAmount), [4000]);
  const femur = run(facts({ eventType: "accident", fractureBodyPart: "neck of femur" }), [cover({})], rows).filter((i) => i.id.startsWith("table-fracture"));
  assert.equal(femur.length, 0, "the neck-of-spine row is not a femur");
});

test("a death paid only on an accident is never paid for a death from illness (TE P144-2)", () => {
  const life = cover({ id: "c5", category: "Death", currency: "AUD", productName: "Coastal Life", evidenceText: "A$800,000" });
  const rows = [tableRow("a", "Coastal Life", "Death due to accident", printed(800000, "lump_sum", "AUD"))];
  const items = run(facts({ eventType: "death", death: true, deathDate: "2026-09-01" }), [life], rows, [personCover("a", "Coastal Life")]);
  assert.equal(items.some((i) => i.id.startsWith("table-death") && i.calculatedAmount), false);
});

const item = (o: Partial<ClaimAssessmentItem>): ClaimAssessmentItem => ({ id: "x", title: "x", status: "potentially_applicable", amountText: null, reason: "", conditions: [], ...o } as ClaimAssessmentItem);
test("a daily cash item from the wording's rules is never paid again from the table (TE P144-3)", () => {
  const rows = [tableRow("k", "Harbour Accident Shield", "ICU Daily Cash", printed(500, "per_day", "INR"), { fromDay: 1, maxDays: 30 })];
  const f = facts({ eventType: "hospitalisation", hospitalised: true, hospitalNights: 4 });
  const out = withTableBenefits(f, [cover({})], claimTable(rows, [personCover("k", "Harbour Accident Shield")]),
    [item({ id: "med-icu-cash", title: "Daily ICU Cash", coverageId: "c1", calculatedAmount: 2000 })]);
  assert.equal(out.filter((i) => i.id.startsWith("table-hospital-cash")).length, 0);
});

test("a row is paid only under its own document's matching cover, never a same-named or neighbouring one (TE P144-4)", () => {
  // A row from a document no verified cover is on does not borrow a verified policy with the same product name.
  const rows = [tableRow("x", "Harbour Accident Shield", "Wrist", printed(2500, "lump_sum", "MYR"), { section: "Fractures" })];
  const f1 = run(facts({ eventType: "accident", fractureBodyPart: "wrist" }), [cover({})], rows, [personCover("x", "Harbour Accident Shield", "unverified")]).find((i) => i.id.startsWith("table-fracture"));
  assert.equal(f1?.calculatedAmount, undefined);
  // One schedule with an accident cover and a life cover: a death row named for neither maps to neither.
  const acc = cover({ id: "acc", category: "Personal Accident", productName: "Harbour Accident Shield" });
  const life = cover({ id: "life", category: "Death", productName: "Harbour Term Life" });
  const d = run(facts({ eventType: "death", death: true, deathDate: "2026-09-01" }), [acc, life],
    [tableRow("s", "Harbour Plan", "Death Benefit", printed(100000, "lump_sum", "MYR"))], [personCover("s", "Harbour Plan")]).find((i) => i.id.startsWith("table-death"));
  assert.equal(d?.calculatedAmount, undefined);
});

test("the table's death row never pays beside a death item the rules already gave for the same cover (Critic R225)", () => {
  const life = cover({ id: "c6", category: "Death", currency: "SGD", productName: "Group Term Life" });
  const rows = [tableRow("g", "Group Term Life", "Death Benefit", printed(200000, "lump_sum", "SGD"))];
  const f = facts({ eventType: "death", death: true, deathDate: "2026-09-01" });
  for (const id of ["gtl-death", "gpa-accidental-death", "travel-accidental-death"]) {
    const out = withTableBenefits(f, [life], claimTable(rows, [personCover("g", "Group Term Life")]), [item({ id, title: "Death", coverageId: "c6", calculatedAmount: 200000 })]);
    assert.equal(out.filter((i) => i.calculatedAmount).length, 1, id);
  }
});

console.log(`claim table benefits: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("FAIL", f); process.exit(1); }
