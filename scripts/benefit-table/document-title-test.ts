/** Scripted tests: the benefit table never names a document by its upload's file name ("0b5b92fa-....pdf") in what it
 * shows. Every source of a checked reading (covers, rows, the "how" of a worked-out share, unlinked sections) names the
 * document as DearPolicy does everywhere else (document-name.ts documentCardTitle): its product name, a file name a
 * person chose made readable, or insurer and kind. Live check of #551 (the p22 row's "how" named the raw file).
 * No model, database or network.
 *   npm run benefit-table:document-title-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf } from "@/lib/benefit-table/assemble";
import { checkReading } from "@/lib/benefit-table/check";
import { titled } from "@/lib/benefit-table/service";
import { documentCardTitle } from "@/lib/policies/document-name";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const DOC = "eeeeeeee-1111-4111-8111-000000000009";
const FILE = "0b5b92fa-b801-4d2e-a812-726aaf9c97a7.pdf";
const page1 = "Example Life\nCRITICAL ILLNESS PLAN - POLICY SCHEDULE\nLife assured: Lee Wei Ming\tCurrency: Singapore Dollars (S$)\nBenefit\tSum assured\nCritical Illness Plan\tS$300,000";
const page2 = "3 BENEFITS\n3.1 Critical Illness Benefit\nWhile this Basic Benefit is in force, if the Life Assured is diagnosed with a covered illness, We will pay one hundred\npercent (100%) of the Sum Assured of this Basic Benefit in one (1) lump sum.\n3.2 Hospital Benefit\nWe will pay S$200 for each day in hospital.";
function table(file: { product_name: string | null; original_filename: string; insurer: string | null; document_role: string | null; policy_number: string | null }, linked = true) {
  const pages = [{ page: 1, text: page1 }, { page: 2, text: page2 }];
  const raw = checkReading({ id: DOC, name: file.original_filename, readable: true, pages }, {
    document: { kind: "personal_proof", product: "Critical Illness Plan", insurer: "Example Life", namedPeople: ["Lee Wei Ming"], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: "Lee Wei Ming", product: "Critical Illness Plan", cover: "Critical Illness Plan", plan: null, riderOf: null, policyNumber: "CI-9", premium: null, premiumFrequency: null,
      asOf: null, startDate: null, endDate: null, page: 1, sumInsured: 300000, quote: "Critical Illness Plan\tS$300,000" }],
    benefits: [
      { section: "3 BENEFITS", column: null, benefit: "3.1 Critical Illness Benefit", pays: "percent", value: 100, period: null, basis: null, asOf: null, percentOf: "other", baseAmount: null, baseQuote: null,
        cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, quote: "We will pay one hundred\npercent (100%) of the Sum Assured of this Basic Benefit in one (1) lump sum." },
      { section: "3 BENEFITS", column: null, benefit: "3.2 Hospital Benefit", pays: "per_day", value: 200, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
        cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, quote: "We will pay S$200 for each day in hospital." },
    ] } as never);
  const reading = titled(raw, documentCardTitle(file));
  const key = coverKeyOf({ product: "Critical Illness Plan", cover: "Critical Illness Plan", plan: null, riderOf: null });
  const sections = [...new Set(reading.benefits.map((b) => sectionKeyOf(DOC, b)))];
  return assembleTable([reading], [{ id: "m0", display_name: "Lee Wei Ming" }], linked ? sections.map((section) => ({ section, cover: key, why: "the schedule's benefit provisions" })) : []);
}
const CCI = { product_name: "Singlife Comprehensive Critical Illness II", original_filename: FILE, insurer: "Singapore Life Ltd.", document_role: "personal_schedule", policy_number: "84339090" };

test("a worked-out share's how names the document's product, never the upload's file name", () => {
  const t = table(CCI);
  const row = t.people[0].rows.find((r) => /Critical Illness Benefit/.test(r.benefit))!;
  assert.equal(row.figure.kind, "worked_out", JSON.stringify(row.figure));
  const how = (row.figure as { how: string }).how;
  assert.match(how, /Singlife Comprehensive Critical Illness II p1/);
  assert.doesNotMatch(how, /0b5b92fa|\.pdf/);
});
test("no source anywhere in the table names the upload's file name", () => {
  for (const linked of [true, false]) {
    const json = JSON.stringify(table(CCI, linked));
    assert.doesNotMatch(json, /0b5b92fa|\.pdf/, linked ? "linked" : "unlinked sections");
    assert.match(json, /Singlife Comprehensive Critical Illness II/);
  }
});
test("a document with no product name and a made-up file name is named by insurer and kind", () => {
  const json = JSON.stringify(table({ ...CCI, product_name: null }));
  assert.doesNotMatch(json, /0b5b92fa|\.pdf/);
  assert.match(json, /Singapore Life policy schedule \(ending 9090\)/);
});
test("a file name a person chose is shown made readable, without its extension", () => {
  const json = JSON.stringify(table({ ...CCI, product_name: null, original_filename: "my_critical_illness_schedule.pdf" }));
  assert.doesNotMatch(json, /\.pdf/);
  assert.match(json, /My Critical Illness Schedule/);
});
test("titled changes only this document's sources and keeps every figure", () => {
  const before = table(CCI);
  const rows = before.people[0].rows.map((r) => ({ benefit: r.benefit, figure: r.figure.kind === "none" ? null : (r.figure as { amount: number }).amount }));
  assert.deepEqual(rows.map((r) => r.figure).sort(), [200, 300000].sort());
});

for (const f of failures) console.error(`FAIL ${f}`);
console.log(`benefit-table document title: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
