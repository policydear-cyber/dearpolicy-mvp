/** A page whose text layer prints no currency, while its image prints one (DC 11 Nov, option b): once the page check has
 * confirmed the page against its image, its bare figures are read in that one currency at intake, so a schedule's own
 * "Total Permanent Disability 100,000.00" is confirmed as cover. Fail-safe: a text layer that prints any currency, an image
 * that prints none, two, or one outside the closed list, a page the readings do not agree on, and figures that are not
 * money (a percentage, days) give nothing. Made-up documents in several markets. Pure logic: no database, network or model.
 *   npm run -s documents:image-currency-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { singleImageCurrency, textPrintsCurrency } = await import("@/lib/documents/image-currency");
  const { crossCheckPages } = await import("@/lib/documents/layout-check");
  const FC = await import("@/lib/documents/fact-check");
  const { verifiedExtraction } = await import("@/lib/rag/ingest");
  const { PolicyExtractionSchema } = await import("@/lib/ai/extract-policy");

  const BARE = "Policy Schedule\nLife Assured\tJane Doe\nTotal Permanent Disability\t100,000.00\nDeath\t100,000.00\nPolicy Term\t20 years";

  // ---- C: the one currency an image prints
  const cases: [string, string, string, string | null][] = [
    ["S$ in a header", BARE, "Currency: S$\n" + BARE, "SGD"],
    ["Singapore Dollar written out", BARE, "Policy Currency: Singapore Dollar\n" + BARE, "SGD"],
    ["SGD code", BARE, "All amounts in SGD\n" + BARE, "SGD"],
    ["S$ header with $ figures", BARE, "Currency S$\nTotal Permanent Disability $100,000.00", "SGD"],
    ["US$", BARE, "Currency: US$\n" + BARE, "USD"],
    ["RM", BARE, "Jumlah RM 100,000.00", "MYR"],
    ["MYR code", BARE, "Currency MYR\n" + BARE, "MYR"],
    ["pound sign", BARE, "Sum assured £100,000.00", "GBP"],
    ["bare $ only", BARE, "Total Permanent Disability $100,000.00", "$"],
    ["two currencies", BARE, "S$ 100,000.00\nUS$ 50,000.00", null],
    ["ringgit beside a $", BARE, "RM 100,000.00\n$ 20.00", null],
    ["a sign outside the list (yen)", BARE, "¥100,000", null],
    ["NZ$ is another dollar", BARE, "NZ$100,000.00", null],
    ["New Zealand dollars", BARE, "Amounts in New Zealand dollars\n" + BARE, null],
    ["a code outside the list", BARE, "Currency CAD\n" + BARE, null],
    ["image prints no currency", BARE, BARE, null],
    ["the text layer prints a currency: the text decides", "Death\tS$100,000.00\nTotal Permanent Disability\t100,000.00", "Currency: US$\n" + BARE, null],
    ["the text layer prints a currency word", "Amounts in dollars\n" + BARE, "Currency: S$\n" + BARE, null],
  ];
  for (const [name, text, image, want] of cases) await test(`C ${name}`, () => assert.equal(singleImageCurrency(text, image), want));
  await test("C a text with no currency prints none", () => assert.equal(textPrintsCurrency(BARE), false));

  const extraction = (amount: number, currency: string, evidence: string, category = "Total Permanent Disability") => PolicyExtractionSchema.parse({
    documentType: "Policy schedule", documentRole: "personal_schedule", documentNotes: [], insurer: "Harbour Life (fictitious)", productName: "Harbour Protect", productsMentioned: ["Harbour Protect"],
    policyNumber: null, groupPolicyNumber: null, policyType: "Term Life", policyholder: null, personalCoverageConfirmed: true, startDate: null, renewalOrExpiryDate: null,
    insuredPeople: [{ name: "Jane Doe", relationshipHint: "self", coverages: [{ category, productName: null, policyNumber: null, amount, currency, notes: null, sourcePage: 2, evidenceText: evidence, evidenceVerified: true }] }],
    referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [], keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
  });
  // ---- X: the page check sets it only on a page the image confirmed
  type P = { pageNumber: number; text: string; extractionMethod?: string; unchecked?: boolean; partChecked?: boolean; uncheckedWhy?: string; imageCurrency?: string };
  const page = (text: string): P => ({ pageNumber: 2, text, extractionMethod: "native" });
  const run = async (text: string, image: string) => (await crossCheckPages([page(text)], [2], async () => [{ pageNumber: 2, text: image, extractionMethod: "ocr" }]))[0];
  await test("X1 a confirmed page with an S$ header gets SGD", async () => {
    const out = await run(BARE, "Currency: S$\n" + BARE);
    assert.ok(!out.unchecked && !out.partChecked, String(out.uncheckedWhy)); assert.equal(out.imageCurrency, "SGD");
  });
  await test("X2 figures that differ from the image are held back, so no currency makes them usable", async () => {
    const out = await run(BARE, "Currency: S$\n" + BARE.replace(/100,000\.00/g, "180,000.00"));
    assert.ok(out.unchecked || out.partChecked, "expected the page held back");
    assert.ok(!out.text.includes("100,000.00"), out.text);
    const c = FC.factCheckExtraction(extraction(100000, "SGD", "Total Permanent Disability\t100,000.00"), [out]).extraction.insuredPeople[0].coverages[0];
    assert.equal(c.evidenceVerified, false);
  });
  await test("X3 the image could not be read: none", async () => {
    const [out] = await crossCheckPages([page(BARE)], [2], async () => null);
    assert.equal(out.imageCurrency, undefined); assert.equal(out.unchecked, true);
  });
  await test("X4 a page the check did not read keeps no currency", async () => {
    const [out] = await crossCheckPages([page(BARE)], [], async () => [{ pageNumber: 2, text: "S$ " + BARE, extractionMethod: "ocr" }]);
    assert.equal(out.imageCurrency, undefined);
  });

  // ---- F: the fact check confirms a bare figure in the page's image currency, under the usual money rules
  const fc = (e: ReturnType<typeof extraction>, imageCurrency?: string, text = BARE) => FC.factCheckExtraction(e, [{ pageNumber: 2, text, imageCurrency }]).extraction.insuredPeople[0].coverages[0];
  await test("F1 SGD page image: the bare 100,000.00 is confirmed", () => {
    const c = fc(extraction(100000, "SGD", "Total Permanent Disability\t100,000.00"), "SGD");
    assert.equal(c.evidenceVerified, true); assert.equal(c.amount, 100000);
  });
  await test("F2 control: with no image currency the bare figure stays unconfirmed (as on main)", () => {
    assert.equal(fc(extraction(100000, "SGD", "Total Permanent Disability\t100,000.00")).evidenceVerified, false);
  });
  await test("F3 a USD reading on an SGD page is not confirmed", () => {
    assert.equal(fc(extraction(100000, "USD", "Total Permanent Disability\t100,000.00"), "SGD").evidenceVerified, false);
  });
  await test("F4 a bare $ image does not confirm a USD reading", () => {
    assert.equal(fc(extraction(100000, "USD", "Total Permanent Disability\t100,000.00"), "$").evidenceVerified, false);
  });
  await test("F5 USD page image confirms a USD reading", () => {
    assert.equal(fc(extraction(100000, "USD", "Total Permanent Disability\t100,000.00"), "USD").evidenceVerified, true);
  });
  await test("F6 a count of days is never money, whatever the image prints", () => {
    const text = BARE + "\nHospital stay\t30 days";
    assert.equal(fc(extraction(30, "SGD", "Hospital stay\t30 days", "Hospitalisation"), "SGD", text).evidenceVerified, false);
  });
  await test("F7 a percentage is never money", () => {
    const text = BARE + "\nAccidental Death\t150%";
    assert.equal(fc(extraction(150, "SGD", "Accidental Death\t150%", "Death"), "SGD", text).evidenceVerified, false);
  });
  await test("F8 a figure the page does not print is not confirmed", () => {
    assert.equal(fc(extraction(150000, "SGD", "Total Permanent Disability\t100,000.00"), "SGD").evidenceVerified, false);
  });
  await test("F9 another page's image currency does not apply", () => {
    const c = FC.factCheckExtraction(extraction(100000, "SGD", "Total Permanent Disability\t100,000.00"), [{ pageNumber: 1, text: "Cover page", imageCurrency: "SGD" }, { pageNumber: 2, text: BARE }]).extraction.insuredPeople[0].coverages[0];
    assert.equal(c.evidenceVerified, false);
  });
  await test("F10 an MYR page: RM is read for a ringgit reading", () => {
    assert.equal(fc(extraction(100000, "MYR", "Total Permanent Disability\t100,000.00"), "MYR").evidenceVerified, true);
  });

  // ---- I: through the intake's own check (verifiedExtraction), as the page check leaves the page
  await test("I1 intake: a confirmed page with an image-only currency keeps the cover verified", async () => {
    const [checked] = await crossCheckPages([page(BARE)], [2], async () => [{ pageNumber: 2, text: "Currency: Singapore Dollar\n" + BARE, extractionMethod: "ocr" }]);
    const e = verifiedExtraction(extraction(100000, "SGD", "Total Permanent Disability\t100,000.00"), [checked]);
    const c = e.insuredPeople[0].coverages[0];
    assert.equal(c.evidenceVerified, true); assert.equal(c.amount, 100000);
  });
  await test("I2 intake control: the same page unchecked by the image gives no verified cover", async () => {
    const e = verifiedExtraction(extraction(100000, "SGD", "Total Permanent Disability\t100,000.00"), [page(BARE)]);
    assert.equal(e.insuredPeople[0].coverages[0].evidenceVerified, false);
  });

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`image-currency: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
