/**
 * The household's currency applied when the table is shown (lib/benefit-table/household-currency.ts), DC 24 Nov: amounts a
 * document prints with no currency take the household's CURRENT setting, with no re-read and nothing stored; a currency
 * the document letters always wins. Pure: a stored reading is checked against its pages, then the setting is applied.
 */
import assert from "node:assert/strict";
import { checkStored } from "@/lib/benefit-table/service";
import type { SourceDoc } from "@/lib/benefit-table/check";
import { withHouseholdCurrency } from "@/lib/benefit-table/household-currency";

let failed = 0, passed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failed++; console.error(`  FAIL ${name}: ${e instanceof Error ? e.message : e}`); } }

const covLine = (sum: string) => `Aster Shield Plan\tIn force\t${sum}`;
function reading(id: string, policy: string, sum: string, benefitCell: string, extraPage?: string) {
  const p1 = ["Merlion Mutual Assurance Ltd", `Policy number: ${policy}`, "Insured person: Alex Tan", "Component\tStatus\tSum Assured", covLine(sum), ...(extraPage ? [extraPage] : [])].join("\n");
  const p2 = ["Table of benefits", "Section\tBenefit\tAmount payable", `1\tDeath Benefit\t${benefitCell}`].join("\n");
  const doc: SourceDoc = { id, name: "Schedule", readable: true, pages: [{ page: 1, text: p1 }, { page: 2, text: p2 }] };
  const stored = { document: {
    document: { kind: "personal_proof", product: "Aster Shield Plan", insurer: "Merlion Mutual Assurance Ltd", namedPeople: ["Alex Tan"], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: "Alex Tan", product: "Aster Shield Plan", cover: "Aster Shield Plan", plan: null, riderOf: null, policyNumber: policy, sumInsured: 100000, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: covLine(sum) }],
    benefits: [{ section: "1 Death Benefit", column: null, benefit: "Death Benefit", pays: "amount", value: 50000, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, quote: `1\tDeath Benefit\t${benefitCell}` }],
  }, pages: [] };
  return checkStored(doc, stored);
}

const bare = () => reading("d1", "MPA-20417-S", "$100,000", "$50,000");
test("setup: the document prints no currency, so the stored reading has none", () => {
  const r = bare();
  assert.equal(r.benefits[0]!.currency, null);
  assert.equal(r.covers[0]!.currency, null);
  assert.deepEqual(r.pageCurrencies, { named: [], allKnown: true });
});
test("D1 a bare $ takes the household's setting, and says so", () => {
  const [r] = withHouseholdCurrency([bare()], "SGD");
  assert.equal(r!.benefits[0]!.currency, "SGD");
  assert.equal(r!.benefits[0]!.fromSettings, true);
  assert.equal(r!.covers[0]!.currency, "SGD");
  assert.equal(r!.covers[0]!.fromSettings, true);
});
test("D2 changing the setting changes the same stored amount, with no re-read", () => {
  const stored = bare();
  assert.equal(withHouseholdCurrency([stored], "SGD")[0]!.benefits[0]!.currency, "SGD");
  assert.equal(withHouseholdCurrency([stored], "MYR")[0]!.benefits[0]!.currency, "MYR");
  assert.equal(withHouseholdCurrency([stored], "USD")[0]!.covers[0]!.currency, "USD");
  assert.equal(stored.benefits[0]!.currency, null, "nothing stored is changed");
});
test("D3 no setting (Don't assume): nothing is assumed", () => {
  for (const none of [null, undefined, ""]) assert.equal(withHouseholdCurrency([bare()], none)[0]!.benefits[0]!.currency, null);
});
test("D4 a lettered currency wins: S$ stays S$ for a USD household, no S$S$", () => {
  const r = reading("d2", "MPA-1", "S$100,000", "S$50,000");
  assert.equal(r.benefits[0]!.currency, "SGD");
  const [out] = withHouseholdCurrency([r], "USD");
  assert.equal(out!.benefits[0]!.currency, "SGD");
  assert.equal(out!.covers[0]!.currency, "SGD");
  assert.equal(out!.benefits[0]!.fromSettings, undefined);
});
test("D5 a document that letters another currency anywhere is not filled", () => {
  const r = reading("d3", "MPA-2", "$100,000", "$50,000", "All premiums are payable in US$ only.");
  assert.ok(r.pageCurrencies!.named.includes("USD"), JSON.stringify(r.pageCurrencies));
  assert.equal(withHouseholdCurrency([r], "SGD")[0]!.benefits[0]!.currency, null);
});
test("D6 the household's own currency named in the document does not hold it", () => {
  const r = reading("d4", "MPA-3", "$100,000", "$50,000", "Currency: Singapore Dollar");
  assert.equal(withHouseholdCurrency([r], "SGD")[0]!.benefits[0]!.currency, "SGD");
});
test("D7 a schedule of the same policy that letters another currency holds the policy's bare amounts too", () => {
  const wording = reading("w1", "MPA-4", "$100,000", "$50,000");
  const schedule = reading("s1", "MPA-4", "US$100,000", "US$50,000");
  const out = withHouseholdCurrency([wording, schedule], "SGD");
  assert.equal(out[0]!.benefits[0]!.currency, null);
  assert.equal(out[1]!.benefits[0]!.currency, "USD");
});
test("D8 an unrelated document in another currency does not hold this one", () => {
  const mine = reading("m1", "MPA-5", "$100,000", "$50,000");
  const other = reading("o1", "XYZ-9999", "US$100,000", "US$50,000");
  const out = withHouseholdCurrency([mine, other], "SGD");
  assert.equal(out[0]!.benefits[0]!.currency, "SGD");
  assert.equal(out[1]!.benefits[0]!.currency, "USD");
});
test("D9 a page whose text is not known holds the document", () => {
  const r = bare();
  const unknown = { ...r, pageCurrencies: { named: [], allKnown: false } };
  assert.equal(withHouseholdCurrency([unknown], "SGD")[0]!.benefits[0]!.currency, null);
});
test("D10 a percentage or a day count never takes a currency", () => {
  const r = bare();
  const pct = { ...r, benefits: [{ ...r.benefits[0]!, pays: "percent" as const }] };
  assert.equal(withHouseholdCurrency([pct], "SGD")[0]!.benefits[0]!.currency, null);
});
test("D11 a reading with no page facts (not checked here) is left as it is", () => {
  const r = { ...bare(), pageCurrencies: undefined };
  assert.equal(withHouseholdCurrency([r], "SGD")[0]!.benefits[0]!.currency, null);
});
test("D12 a document with pages the table never loads (unreadable, not checked) is held", () => {
  const r = bare();
  const out = withHouseholdCurrency([r], "SGD", { unknownDocuments: new Set([r.documentId]) });
  assert.equal(out[0]!.benefits[0]!.currency, null);
});
test("D13 a wording with no cover that letters US$ holds the schedule of the same policy, grouped by the file's policy number", () => {
  const schedule = reading("s2", "MPA-20417-S", "$100,000", "$50,000");
  const wording = { ...reading("w2", "MPA-20417-S", "$1", "$1", "All amounts in this policy are in US$."), covers: [] };
  const keys = new Map([["s2", ["MPA20417S"]], ["w2", ["MPA20417S"]]]);
  const out = withHouseholdCurrency([schedule, wording], "SGD", { keys });
  assert.equal(out[0]!.benefits[0]!.currency, null, "the schedule is held");
  const alone = withHouseholdCurrency([schedule], "SGD", { keys });
  assert.equal(alone[0]!.benefits[0]!.currency, "SGD", "alone it is filled");
});
test("D14 a document never read into the table, of the same policy or insurer and product, holds the policy", () => {
  const schedule = reading("s3", "MPA-7", "$100,000", "$50,000");
  const keys = new Map([["s3", ["ACME|SHIELD"]], ["u1", ["ACME|SHIELD"]]]);
  assert.equal(withHouseholdCurrency([schedule], "SGD", { keys, unknownDocuments: new Set(["u1"]) })[0]!.benefits[0]!.currency, null);
  const unrelated = new Map([["s3", ["ACME|SHIELD"]], ["u1", ["OTHER|PLAN"]]]);
  assert.equal(withHouseholdCurrency([schedule], "SGD", { keys: unrelated, unknownDocuments: new Set(["u1"]) })[0]!.benefits[0]!.currency, "SGD");
});
test("D15 a cover-less wording that letters US$ holds every policy of its insurer, whatever the products are called, and never the whole household", () => {
  const schedule = reading("s4", "MPA-8", "$100,000", "$50,000");
  const wording = { ...reading("w4", "MPA-8", "$1", "$1", "All amounts in this policy are in US$."), covers: [] };
  const same = withHouseholdCurrency([schedule, wording], "SGD", { insurers: new Map([["s4", "Acme Ltd"], ["w4", "ACME"]]) });
  assert.equal(same[0]!.benefits[0]!.currency, null);
  // A wording tied to no insurer holds only itself: another policy of the household is filled (DC 24 Nov).
  const noInsurer = withHouseholdCurrency([schedule, wording], "SGD", {});
  assert.equal(noInsurer[0]!.benefits[0]!.currency, "SGD");
  let told: string[] = [];
  withHouseholdCurrency([schedule, wording], "SGD", { onHold: (h) => { told = h.map((x) => x.documentId); } });
  assert.deepEqual(told, ["w4"], "the wording itself, and nothing else, is held");
  for (const spelling of ["Merlion Mutual", "The Merlion Mutual Assurance Ltd", "Merlion Mutual Pte. Ltd.", "Merlion Mutual Insurance Co.", "Merlion Mutual Assurance (Singapore) Pte Ltd", "merlion mutual assurance limited", "Merlion Assurance"]) {
    const spelled = withHouseholdCurrency([schedule, wording], "SGD", { insurers: new Map([["s4", "Merlion Mutual Assurance Ltd"], ["w4", spelling]]) });
    assert.equal(spelled[0]!.benefits[0]!.currency, null, `insurer spelled ${spelling}`);
  }
  // The accepted limit: an insurer under another name matches nothing, so its wording holds only itself; the schedule's own
  // printed currency wins whenever it prints one.
  const alias = withHouseholdCurrency([schedule, wording], "SGD", { insurers: new Map([["s4", "AIA Singapore"], ["w4", "American International Assurance Company, Ltd."]]) });
  assert.equal(alias[0]!.benefits[0]!.currency, "SGD", "AIA under its legal name");
  // Another insurer's policy of the household is filled when the wording's insurer is filed under a policy of its own.
  const own = reading("s5", "ZZZ-9", "$100,000", "$50,000");
  const other = withHouseholdCurrency([schedule, own, wording], "SGD", { insurers: new Map([["s4", "Other Insurer"], ["s5", "Acme Ltd"], ["w4", "ACME"]]) });
  assert.equal(other[0]!.benefits[0]!.currency, "SGD");
  assert.equal(other[1]!.benefits[0]!.currency, null);
});
test("D16 a count read as an amount (\"Waiting period 14\") takes no currency; money does", () => {
  const r = bare();
  const count = { ...r, benefits: [{ ...r.benefits[0]!, value: 14, source: { ...r.benefits[0]!.source, excerpt: "Waiting period\t14" } }] };
  assert.equal(withHouseholdCurrency([count], "SGD")[0]!.benefits[0]!.currency, null);
  const small = { ...r, benefits: [{ ...r.benefits[0]!, value: 50, source: { ...r.benefits[0]!.source, excerpt: "Daily cash\t$50.00" } }] };
  assert.equal(withHouseholdCurrency([small], "SGD")[0]!.benefits[0]!.currency, "SGD");
});

test("D17 each held document says why, for the server log", () => {
  const r = reading("d9", "MPA-9", "$100,000", "$50,000", "All premiums are payable in US$ only.");
  let told: { documentId: string; why: string }[] = [];
  withHouseholdCurrency([r, bare()], "SGD", { onHold: (h) => { told = h; } });
  assert.deepEqual(told.map((h) => h.documentId), ["d9"]);
  assert.match(told[0]!.why, /another currency/);
  let none: unknown[] = [{}];
  withHouseholdCurrency([bare()], "SGD", { onHold: (h) => { none = h; } });
  assert.deepEqual(none, []);
});
test("D18 a wording with no insurer that shares its product with a schedule holds that schedule, through the product key", () => {
  const schedule = reading("s6", "MPA-6", "$100,000", "$50,000");
  const wording = { ...reading("w6", "ZZZ-6", "$1", "$1", "All amounts in this policy are in US$."), covers: [] };
  const keys = new Map([["s6", ["PRODUCT|ASTERSHIELDPLAN"]], ["w6", ["PRODUCT|ASTERSHIELDPLAN"]]]);
  assert.equal(withHouseholdCurrency([schedule, wording], "SGD", { keys })[0]!.benefits[0]!.currency, null);
  const other = new Map([["s6", ["PRODUCT|ASTERSHIELDPLAN"]], ["w6", ["PRODUCT|SOMETHINGELSE"]]]);
  assert.equal(withHouseholdCurrency([schedule, wording], "SGD", { keys: other })[0]!.benefits[0]!.currency, "SGD");
});
test("D19 an insurer's accent does not hide its wording: Mérlion holds Merlion", () => {
  const schedule = reading("s7", "MPA-7", "$100,000", "$50,000");
  const wording = { ...reading("w7", "ZZZ-7", "$1", "$1", "All amounts in this policy are in US$."), covers: [] };
  const held = withHouseholdCurrency([schedule, wording], "SGD", { insurers: new Map([["s7", "Merlion Mutual Ltd"], ["w7", "Mérlion Mutual Assurance"]]) });
  assert.equal(held[0]!.benefits[0]!.currency, null);
});
console.log(`household-currency-display: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
