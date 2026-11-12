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
    ["bare $ only names no currency (Critic #417 C3)", BARE, "Total Permanent Disability $100,000.00", null],
    ["bare dollars only", BARE, "All amounts in dollars\n" + BARE, null],
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
  await test("F4 an A$ page does not confirm an SGD reading (Critic #417 C2)", () => {
    assert.equal(fc(extraction(100000, "SGD", "Total Permanent Disability\t100,000.00"), "AUD").evidenceVerified, false);
    assert.equal(fc(extraction(100000, "SGD", "Total Permanent Disability\t100,000.00"), "PHP").evidenceVerified, false);
  });
  // Critic #417 C1 / TE j417: a plain number on an S$ page is never money.
  const PLAIN = "Policy Schedule\nLife Assured\tJane Doe\nAge at entry\t45\nEntry age\t45\nPolicy Term\t20\nCommencement\t1 October 2026\nPlan Code\t50000\nPolicy No.\t88123456\nPolicy No.\t70,451,288\nWaiting period (days)\t90\nCustomer hotline\t6555 0199";
  for (const [label, amount, evidence] of [["age", 45, "Age at entry\t45"], ["entry age", 45, "Entry age\t45"], ["term", 20, "Policy Term\t20"], ["year of a date", 2026, "Commencement\t1 October 2026"],
    ["plan code", 50000, "Plan Code\t50000"], ["policy number", 88123456, "Policy No.\t88123456"], ["policy number with commas", 70451288, "Policy No.\t70,451,288"], ["days", 90, "Waiting period (days)\t90"], ["phone", 65550199, "Customer hotline\t6555 0199"]] as const)
    await test(`F11 ${label} is not money on an S$ page`, () => assert.equal(fc(extraction(amount, "SGD", evidence, "Death"), "SGD", PLAIN).evidenceVerified, false));
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
  for (const [label, evidence] of [["Term Life", "Term life sum assured\t100,000.00"], ["Long Term Care", "Long Term Care benefit\t100,000.00"], ["Short-term disability", "Short-term disability\t100,000.00"]] as const)
    await test(`F12 ${label} is a cover, not a term label`, () => assert.equal(fc(extraction(100000, "SGD", evidence, "Death"), "SGD", BARE + "\n" + evidence).evidenceVerified, true));
  await test("F13 a money-shaped figure after a term label is not money", () => {
    const line = "Policy Term (years):\t20.00";
    assert.equal(fc(extraction(20, "SGD", line, "Death"), "SGD", BARE + "\n" + line).evidenceVerified, false);
  });
  // "No.", "Age", "Period", "Year" mark a non-money field only as the label's last word (parked follow-up, #417).
  for (const [label, evidence, amount] of [["No Claim Bonus", "No Claim Bonus\t5,000.00", 5000], ["Old Age Benefit", "Old Age Benefit\t50,000.00", 50000],
    ["Benefit Period Limit", "Benefit Period Limit\t100,000.00", 100000], ["a limit per policy year", "Overall limit per policy year\t150,000.00", 150000],
    ["a limit per year", "Annual limit per year:\t150,000.00", 150000],
    ["a limit per period of insurance", "Annual limit per period of insurance\t150,000.00", 150000]] as const)
    await test(`F14 ${label} is a cover: the word is inside its label`, () => assert.equal(fc(extraction(amount, "SGD", evidence, "Other"), "SGD", BARE + "\n" + evidence).evidenceVerified, true));
  for (const [label, evidence, amount] of [["policy number", "Policy No.\t70,451,288", 70451288], ["policy number with a colon", "Policy No.:\t1,234.00", 1234],
    ["entry age", "Entry age\t45.00", 45], ["waiting period", "Waiting period\t30.00", 30], ["waiting period with its unit", "Waiting Period (days):\t90.00", 90],
    ["policy year", "Policy year:\t2,026.00", 2026], ["years", "Premium payment years\t25.00", 25],
    // Critic #423: the word opens a field phrase inside the label.
    ["number of units", "No. of units\t1,000", 1000], ["number of units with decimals", "No. of units\t1,000.00", 1000],
    ["number of lives", "No. of lives insured\t1,200", 1200], ["age next birthday", "Age next birthday\t45.00", 45],
    ["age next birthday capitalised", "Age Next Birthday\t65.00", 65], ["age at entry", "Age at entry\t45.00", 45],
    ["age limit", "Age limit\t100.00", 100], ["maximum age at expiry", "Maximum Age at Expiry\t100.00", 100],
    ["period of cover", "Period of cover\t365.00", 365], ["period of insurance in days", "Period of Insurance (days)\t365.00", 365],
    ["years in force", "Years in force\t10.00", 10], ["years of cover", "Years of cover\t1,000", 1000],
    ["year of entry", "Year of entry\t2,019", 2019]] as const)
    await test(`F15 ${label} ends its label: not money`, () => assert.equal(fc(extraction(amount, "SGD", evidence, "Death"), "SGD", BARE + "\n" + evidence).evidenceVerified, false));
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
