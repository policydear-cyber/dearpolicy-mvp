/** The household's own currency (Account settings, DC 17 Nov): a cover amount whose document prints no currency is read
 * in the currency the household chose (S$ when it has not chosen), and only then. Fail-safe: a currency the document
 * prints anywhere else, a page that names another currency, a page image that names another, a reading in another
 * currency, "Don't assume", a figure that is not money-shaped, the wrong person and a premium-waiver rider all give no
 * amount, exactly as before. Made-up documents from several insurers and markets. Pure logic: no database, network or
 * model.
 *   npm run -s documents:household-currency-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const HC = await import("@/lib/documents/household-currency");
  const { crossCheckPages } = await import("@/lib/documents/layout-check");
  const { verifiedExtraction } = await import("@/lib/rag/ingest");
  const { PolicyExtractionSchema } = await import("@/lib/ai/extract-policy");

  type Page = { pageNumber: number; text: string; imageCurrency?: string; imageCurrencies?: string[]; unreadable?: boolean; notRead?: boolean };
  type Cov = { amount: number; currency: string | null; evidence: string; page?: number; product?: string | null; person?: string };
  const extraction = (covs: Cov[], person = "Mei Ling Tan") => PolicyExtractionSchema.parse({
    documentType: "Policy schedule", documentRole: "personal_schedule", documentNotes: [], insurer: "Kestrel Assurance (fictitious)", productName: "Kestrel Shield", productsMentioned: ["Kestrel Shield"],
    policyNumber: null, groupPolicyNumber: null, policyType: "Term Life", policyholder: null, personalCoverageConfirmed: true, startDate: null, renewalOrExpiryDate: null,
    insuredPeople: [{ name: person, relationshipHint: "self", coverages: covs.map((c) => ({ category: c.product ?? "Death", productName: c.product ?? null, policyNumber: null, amount: c.amount, currency: c.currency, notes: null, sourcePage: c.page ?? 2, evidenceText: c.evidence, evidenceVerified: true })) }],
    referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [], keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
  });
  const shown = (covs: Cov[], pages: Page[], household: string | null, person?: string) =>
    verifiedExtraction(extraction(covs, person), pages, { allPages: pages, householdCurrency: household }).insuredPeople.flatMap((p) => p.coverages)
      .map((c) => (c.evidenceVerified && c.amount != null ? `${c.currency} ${c.amount}` : "held"));
  const notes = (covs: Cov[], pages: Page[], household: string | null) =>
    verifiedExtraction(extraction(covs), pages, { allPages: pages, householdCurrency: household }).insuredPeople.flatMap((p) => p.coverages).map((c) => c.notes ?? "");

  const BARE = "Policy Schedule\nLife Assured\tMei Ling Tan\nComponent\tStatus\tSum Assured\tPremium\nDeath\tIn Force\t100,000.00\t12.50\nTotal Permanent Disability\tIn Force\t80,000.00\t0.00\nHospital Cash\tIn Force\t150.00\t0.00";
  const death: Cov = { amount: 100000, currency: "SGD", evidence: "Death\tIn Force\t100,000.00" };
  const tpd: Cov = { amount: 80000, currency: null, evidence: "Total Permanent Disability\tIn Force\t80,000.00" };
  const p2 = (text: string, extra: Partial<Page> = {}): Page => ({ pageNumber: 2, text, ...extra });

  // ---- S: the setting itself
  await test("S parse: listed codes, any case", () => { assert.equal(HC.parseHouseholdCurrencySetting("sgd"), "SGD"); assert.equal(HC.parseHouseholdCurrencySetting(" NONE "), "NONE"); });
  await test("S parse: anything else is not a setting", () => { for (const v of ["XYZ", "S$", "", null, 5, {}, "SGD;drop"]) assert.equal(HC.parseHouseholdCurrencySetting(v), null); });
  await test("S not chosen assumes nothing (DC 17 Nov)", () => { assert.equal(HC.effectiveHouseholdCurrency(null), null); assert.equal(HC.effectiveHouseholdCurrency(undefined), null); assert.equal(HC.effectiveHouseholdCurrency(""), null); });
  await test("S Don't assume gives none", () => assert.equal(HC.effectiveHouseholdCurrency("NONE"), null));
  await test("S a chosen currency is that currency", () => assert.equal(HC.effectiveHouseholdCurrency("MYR"), "MYR"));
  await test("S every choice has a label", () => { for (const c of [...HC.HOUSEHOLD_CURRENCIES, HC.NO_HOUSEHOLD_CURRENCY]) assert.ok(HC.HOUSEHOLD_CURRENCY_LABELS[c]); });

  // ---- A: a document that prints no currency anywhere
  await test("A no currency anywhere, household S$: shown in S$", () => assert.deepEqual(shown([death, tpd], [p2(BARE)], "SGD"), ["SGD 100000", "SGD 80000"]));
  await test("A the amount says where its currency came from", () => assert.ok(notes([death], [p2(BARE)], "SGD")[0].includes(HC.HOUSEHOLD_CURRENCY_NOTE)));
  await test("A before this change (no household currency): held", () => assert.deepEqual(shown([death, tpd], [p2(BARE)], null), ["held", "held"]));
  await test("A Don't assume: held", () => assert.deepEqual(shown([death, tpd], [p2(BARE)], "NONE"), ["held", "held"]));
  await test("A household US$: a reading in SGD is not relabelled; one with no currency is US$", () => assert.deepEqual(shown([death, tpd], [p2(BARE)], "USD"), ["held", "USD 80000"]));
  await test("A household RM, a Malaysian schedule with no currency mark", () => assert.deepEqual(shown([{ ...death, currency: "MYR" }], [p2(BARE)], "MYR"), ["MYR 100000"]));
  await test("A an unknown setting is ignored", () => assert.deepEqual(shown([death], [p2(BARE)], "XYZ"), ["held"]));

  // ---- P: a currency the document prints always decides
  await test("P the line prints S$: confirmed as before, no settings note", () => {
    const pages = [p2(BARE.replace("100,000.00", "S$100,000.00"))];
    assert.deepEqual(shown([death], pages, "SGD"), ["SGD 100000"]);
    assert.ok(!notes([death], pages, "SGD")[0].includes(HC.HOUSEHOLD_CURRENCY_NOTE));
  });
  await test("P the schedule states its currency once and the household agrees", () => assert.deepEqual(shown([death], [p2("Currency : Singapore Dollar\n" + BARE)], "SGD"), ["SGD 100000"]));
  await test("P the schedule states another currency: never relabelled", () => {
    assert.deepEqual(shown([death], [p2("Currency : US Dollar\n" + BARE)], "SGD"), ["held"]);
    assert.deepEqual(shown([{ ...death, currency: null }], [p2("Policy currency: Ringgit Malaysia\n" + BARE)], "SGD"), ["held"]);
  });
  await test("P another page prints RM: the bare page is held", () => assert.deepEqual(shown([death], [{ pageNumber: 1, text: "Premium RM 120.00 monthly" }, p2(BARE)], "SGD"), ["held"]));
  await test("P another page prints £", () => assert.deepEqual(shown([{ ...death, currency: null }], [{ pageNumber: 1, text: "Excess £250" }, p2(BARE)], "SGD"), ["held"]));
  await test("P a wording page that lists the currencies a policy may be in holds a bare page", () =>
    assert.deepEqual(shown([death], [p2(BARE), { pageNumber: 9, text: "Currency of this Policy may be (a) Pounds Sterling (GBP); (b) Singapore Dollars (SGD); (c) United States Dollars (USD)." }], "SGD"), ["held"]));
  await test("P ... but a page that states the household's own currency still uses it", () =>
    assert.deepEqual(shown([death], [p2("Currency : Singapore Dollar\n" + BARE), { pageNumber: 9, text: "Policy currency may be GBP, SGD or USD." }], "SGD"), ["SGD 100000"]));
  await test("P a page naming two currencies is held", () => assert.deepEqual(shown([death], [p2("Currency : Singapore Dollar\nExample: US$ 1,000\n" + BARE)], "SGD"), ["held"]));
  await test("P a currency outside the list (yen) is held", () => assert.deepEqual(shown([death], [{ pageNumber: 1, text: "Excess ¥10,000" }, p2(BARE)], "SGD"), ["held"]));
  await test("P a bare $ elsewhere agrees with a dollar household", () => assert.deepEqual(shown([death], [{ pageNumber: 1, text: "Premium $12.50 monthly" }, p2(BARE)], "SGD"), ["SGD 100000"]));
  await test("P ... and not with a ringgit household", () => assert.deepEqual(shown([{ ...death, currency: null }], [{ pageNumber: 1, text: "Premium $12.50 monthly" }, p2(BARE)], "MYR"), ["held"]));
  await test("P 'dollars' written out agrees with S$", () => assert.deepEqual(shown([death], [p2("All amounts are in dollars\n" + BARE)], "SGD"), ["SGD 100000"]));
  await test("P 'Canadian Dollar' never agrees", () => assert.deepEqual(shown([death], [p2("Currency: Canadian Dollar\n" + BARE)], "SGD"), ["held"]));

  // ---- C: Critic #526 (H1-H3)
  await test("C H1 a bare $ page beside 'Policy Currency: USD' on another page is not S$", () => {
    assert.equal(HC.householdCurrencyPages([{ pageNumber: 1, text: "Policy Currency: USD" }, p2("Death Benefit $500,000.00")], "SGD").size, 0);
    // The figure itself is still confirmed as money (the bare $), with no currency given to it.
    assert.deepEqual(shown([{ amount: 500000, currency: null, evidence: "Death Benefit $500,000.00" }], [{ pageNumber: 1, text: "Policy Currency: USD" }, p2("Life Assured\tMei Ling Tan\nDeath Benefit $500,000.00")], "SGD"), ["null 500000"]);
  });
  await test("C H1 ... while the same bare $ page alone is a dollar that agrees with S$", () =>
    assert.deepEqual(shown([{ amount: 500000, currency: null, evidence: "Death Benefit $500,000.00" }], [p2("Life Assured\tMei Ling Tan\nDeath Benefit $500,000.00")], "SGD"), ["SGD 500000"]));
  await test("C H2 'Sum Assured (RM)' over a bare figure is ringgit", () => assert.deepEqual(shown([{ ...death, currency: null }], [p2("Sum Assured (RM)\n" + BARE)], "SGD"), ["held"]));
  await test("C H2 'Currency: RM' is ringgit", () => assert.deepEqual(shown([{ ...death, currency: null }], [p2("Currency: RM\n" + BARE)], "SGD"), ["held"]));
  await test("C H2 rupiah 'Rp' is another currency", () => assert.deepEqual(shown([{ ...death, currency: null }], [{ pageNumber: 1, text: "Premi Rp 1.500.000" }, p2(BARE)], "SGD"), ["held"]));
  for (const w of ["Currency: AED", "Amounts in dirhams", "Sum assured in South African rand", "Currency: MOP", "Kyat", "Amounts in Swedish krona"])
    await test(`C H2 '${w}' is another currency`, () => assert.deepEqual(shown([{ ...death, currency: null }], [{ pageNumber: 1, text: w }, p2(BARE)], "SGD"), ["held"]));
  await test("C H3 an unread scan page (no text, no image reading) holds the bare page", () => assert.deepEqual(shown([death], [{ pageNumber: 1, text: "" }, p2(BARE)], "SGD"), ["held"]));
  await test("C H3 an unreadable page holds it", () => assert.deepEqual(shown([death], [{ pageNumber: 1, text: "smudge", unreadable: true } as Page, p2(BARE)], "SGD"), ["held"]));
  await test("C H3 a page marked not read holds it", () => assert.deepEqual(shown([death], [{ pageNumber: 1, text: "", notRead: true } as Page, p2(BARE)], "SGD"), ["held"]));
  await test("C H3 a page the image check could not confirm holds it", async () => {
    const { UNCHECKED_PAGE } = await import("@/lib/documents/layout-check");
    assert.deepEqual(shown([death], [{ pageNumber: 1, text: UNCHECKED_PAGE + "\nSchedule" }, p2(BARE)], "SGD"), ["held"]);
  });
  await test("C H3 ... but a page that names S$ itself still uses it", () =>
    assert.deepEqual(shown([death], [{ pageNumber: 1, text: "" }, p2("Currency : Singapore Dollar\n" + BARE)], "SGD"), ["SGD 100000"]));

  await test("C 'real' as an ordinary word does not block", () => assert.deepEqual(shown([death], [{ pageNumber: 1, text: "This is a real policy schedule." }, p2(BARE)], "SGD"), ["SGD 100000"]));

  // ---- I: the page image
  await test("I the page image names RM: held", () => assert.deepEqual(shown([death], [p2(BARE, { imageCurrencies: ["MYR"] })], "SGD"), ["held"]));
  await test("I another page's image names US$: a bare page is held", () => assert.deepEqual(shown([death], [{ pageNumber: 1, text: "Cover", imageCurrencies: ["USD"] }, p2(BARE)], "SGD"), ["held"]));
  await test("I the image's one currency is the household's: the image decides (no settings note)", () => {
    const pages = [p2(BARE, { imageCurrency: "SGD", imageCurrencies: ["SGD"] })];
    assert.deepEqual(shown([death], pages, "SGD"), ["SGD 100000"]);
    assert.ok(!notes([death], pages, "SGD")[0].includes(HC.HOUSEHOLD_CURRENCY_NOTE));
  });
  await test("I the image's one currency is another: never relabelled", () => assert.deepEqual(shown([death], [p2(BARE, { imageCurrency: "USD", imageCurrencies: ["USD"] })], "SGD"), ["held"]));
  await test("I the page check records what the image names", async () => {
    const out = (await crossCheckPages([{ pageNumber: 2, text: BARE, extractionMethod: "native" } as Page & { extractionMethod: string }], [2], async () => [{ pageNumber: 2, text: "Ringgit Malaysia\n" + BARE, extractionMethod: "ocr" }]))[0];
    assert.deepEqual(out.imageCurrencies, ["MYR"]);
    assert.deepEqual(shown([death], [out], "SGD"), ["held"]);
  });
  await test("I an image that names no currency records none", async () => {
    const out = (await crossCheckPages([{ pageNumber: 2, text: BARE, extractionMethod: "native" } as Page & { extractionMethod: string }], [2], async () => [{ pageNumber: 2, text: BARE, extractionMethod: "ocr" }]))[0];
    assert.equal(out.imageCurrencies, undefined);
    assert.deepEqual(shown([death], [out], "SGD"), ["SGD 100000"]);
  });
  await test("I an image the page check rejected still blocks with what it names", async () => {
    const out = (await crossCheckPages([{ pageNumber: 2, text: BARE, extractionMethod: "native" } as Page & { extractionMethod: string }], [2], async () => [{ pageNumber: 2, text: "US$ only\nNothing alike 1,234.56", extractionMethod: "ocr" }]))[0];
    assert.ok(out.imageCurrencies?.includes("USD"));
  });

  // ---- F: only money, only the cover's own line, only the right person
  const ROWS = "Life Assured\tMei Ling Tan\nEntry Age\t45\nHospital Cash\t30 days\nWaiting period\t90\nDeath\tIn Force\t100000\nCo-payment\t10%";
  await test("F a plain number (no separators or decimals) is never money", () => assert.deepEqual(shown([{ amount: 100000, currency: null, evidence: "Death\tIn Force\t100000" }], [p2(ROWS)], "SGD"), ["held"]));
  await test("F an age is not a cover amount", () => assert.deepEqual(shown([{ amount: 45, currency: null, evidence: "Entry Age\t45", product: "Entry Age" }], [p2(ROWS)], "SGD"), ["held"]));
  await test("F days are not money", () => assert.deepEqual(shown([{ amount: 30, currency: null, evidence: "Hospital Cash\t30 days", product: "Hospital Cash" }], [p2(ROWS)], "SGD"), ["held"]));
  await test("F a percentage is not money", () => assert.deepEqual(shown([{ amount: 10, currency: null, evidence: "Co-payment\t10%", product: "Co-payment" }], [p2(ROWS)], "SGD"), ["held"]));
  await test("F a figure on another line than the cited one is held", () => assert.deepEqual(shown([{ amount: 80000, currency: null, evidence: "Death\tIn Force\t80,000.00" }], [p2(BARE)], "SGD"), ["held"]));
  await test("F a person the page does not name is held", () => assert.deepEqual(shown([death], [p2(BARE)], "SGD", "Rahul Menon"), []));
  await test("F a premium-waiver rider keeps no amount", () => {
    const pages = [p2(BARE + "\nPremium Waiver Rider\tIn Force\t150.00\t2.10")];
    assert.deepEqual(shown([{ amount: 150, currency: null, evidence: "Premium Waiver Rider\tIn Force\t150.00", product: "Premium Waiver Rider" }], pages, "SGD"), ["held"]);
  });

  // ---- E: empty and partial states
  await test("E no pages: nothing", () => assert.equal(HC.householdCurrencyPages([], "SGD").size, 0));
  await test("E a document with no cover keeps none", () => assert.deepEqual(shown([], [p2(BARE)], "SGD"), []));
  await test("E a page left out unchecked still decides the document (its words are kept)", () => {
    const unchecked = { pageNumber: 1, text: "This page could not be checked\nAll amounts in Ringgit Malaysia" };
    const out = verifiedExtraction(extraction([death]), [p2(BARE)], { allPages: [unchecked, p2(BARE)], householdCurrency: "SGD" });
    assert.equal(out.insuredPeople[0].coverages[0].evidenceVerified, false);
  });

  console.log(`household-currency-test: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
}
void main();
