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
  await test("P a bare $ elsewhere names no currency: the household's currency fills the bare page (DC 22 Nov)", () => assert.deepEqual(shown([death], [{ pageNumber: 1, text: "Premium $12.50 monthly" }, p2(BARE)], "SGD"), ["SGD 100000"]));
  await test("P ... and for a ringgit household a bare $ is read in the household's currency too (DC 22 Nov)", () => assert.deepEqual(shown([{ ...death, currency: null }], [{ pageNumber: 1, text: "Premium $12.50 monthly" }, p2(BARE)], "MYR"), ["MYR 100000"]));
  await test("P a lettered currency beside a bare $ still wins: US$ on the page holds it for an S$ household", () => assert.deepEqual(shown([death], [p2("Premium US$12.50 monthly\n" + BARE)], "SGD"), ["held"]));
  await test("P 'dollars' written out names no currency: the household's currency fills it (DC 22 Nov)", () => assert.deepEqual(shown([death], [p2("All amounts are in dollars\n" + BARE)], "SGD"), ["SGD 100000"]));
  for (const line of ["Sum assured: HK Dollar 500,000", "All amounts in HK dollars", "Amount in Hongkong Dollars", "Taiwanese Dollar 500,000", "Macau dollars 100", "Kiwi dollars", "Aussie dollars 5,000", "Zimbabwean dollars", "Amounts in Hong Kong $", "Premium Kiwi $120.00"])
    await test(`P (Critic #576) '${line}' is another dollar: held for an S$ household`, () => assert.deepEqual(shown([death], [p2(line + "\n" + BARE)], "SGD"), ["held"]));
  for (const line of ["Sum Assured Singapore $500,000", "Amounts in Singapore $", "Amounts in Sing $"])
    await test(`P (Critic #576) '${line}' is S$: held for a US$ household, filled for an S$ one`, () => {
      assert.deepEqual(shown([death], [p2(line + "\n" + BARE)], "USD"), ["held"]);
      assert.deepEqual(shown([death], [p2(line + "\n" + BARE)], "SGD"), ["SGD 100000"]);
    });
  for (const line of ["United States $ 5,000", "Indonesia $ 5", "Philippine $ 5", "Mexican $ 100", "Amounts in Chilean $"])
    await test(`P (Critic #576) '${line}' is not the household's: held for an S$ household`, () => assert.deepEqual(shown([death], [p2(line + "\n" + BARE)], "SGD"), ["held"]));
  for (const line of ["Premium $ 500", "Total $5,000", "Accidental Death $100,000", "Monthly $ 120"])
    await test(`P (Critic #576) '${line}' stays a bare dollar: filled`, () => assert.deepEqual(shown([death], [p2(line + "\n" + BARE)], "SGD"), ["SGD 100000"]));
  for (const line of ["Currency: Singaporean Dollar", "Sing Dollar"])
    await test(`P (Critic #576) '${line}' is S$: held for a US$ household, filled for an S$ one`, () => {
      assert.deepEqual(shown([death], [p2(line + "\n" + BARE)], "USD"), ["held"]);
      assert.deepEqual(shown([death], [p2(line + "\n" + BARE)], "SGD"), ["SGD 100000"]);
    });
  for (const line of ["Sum Assured $500,000", "All amounts are in dollars", "Premium in dollars"])
    await test(`P (Critic #576) '${line}' stays a bare dollar: filled`, () => assert.deepEqual(shown([death], [p2(line + "\n" + BARE)], "SGD"), ["SGD 100000"]));
  await test("P 'Canadian Dollar' never agrees", () => assert.deepEqual(shown([death], [p2("Currency: Canadian Dollar\n" + BARE)], "SGD"), ["held"]));

  // ---- C: Critic #526 (H1-H3)
  await test("C H1 a bare $ page beside 'Policy Currency: USD' on another page is not S$", () => {
    assert.equal(HC.householdCurrencyPages([{ pageNumber: 1, text: "Policy Currency: USD" }, p2("Death Benefit $500,000.00")], "SGD").size, 0);
    // The figure itself is still confirmed as money (the bare $), with no currency given to it.
    assert.deepEqual(shown([{ amount: 500000, currency: null, evidence: "Death Benefit $500,000.00" }], [{ pageNumber: 1, text: "Policy Currency: USD" }, p2("Life Assured\tMei Ling Tan\nDeath Benefit $500,000.00")], "SGD"), ["null 500000"]);
  });
  await test("C H1 ... and the same bare $ page alone is read in the household's currency (DC 22 Nov)", () =>
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

  // ---- T: Test engineer #526
  const usLine = (mark: string) => ({ cov: { amount: 500000, currency: null, evidence: `Death\tIn Force\t${mark}500,000.00` } as Cov, page: p2(`Life Assured\tMei Ling Tan\nDeath\tIn Force\t${mark}500,000.00`) });
  for (const mark of ["US $", "U.S.$", "U.S. $", "HK $", "NT$", "NZ $", "Usd ", "Php ", "Rs ", "Rs. ", "C $"]) {
    await test(`T F1 '${mark}' is never S$`, () => { const { cov, page } = usLine(mark); assert.notDeepEqual(shown([cov], [page], "SGD"), ["SGD 500000"]); });
  }
  await test("T F1 'US $' is US$ for a US$ household", () => { const { cov, page } = usLine("US $"); assert.deepEqual(shown([cov], [page], "USD"), ["USD 500000"]); });
  for (const head of ["Currency: Myr", "Currency: NTD", "All amounts are in Malaysian currency", "Currency: usd"])
    await test(`T F1 a header '${head}' holds the bare lines`, () => assert.deepEqual(shown([{ ...death, currency: null }], [p2(head + "\n" + BARE)], "SGD"), ["held"]));
  await test("T F1 'Policy Currency: SGD' on page 1 never makes page 2's 'US $' lines S$", () => {
    const { cov, page } = usLine("US $");
    assert.notDeepEqual(shown([cov], [{ pageNumber: 1, text: "Policy Currency: SGD" }, page], "SGD"), ["SGD 500000"]);
  });
  await test("T F1 a sentence with a bare $ is a bare $, not a code", async () => {
    const currenciesIn = HC.currenciesNamed;
    assert.deepEqual(currenciesIn("the cost is $500 and S$ 20 and US$30").sort(), ["$", "SGD", "USD"].sort());
    assert.ok(currenciesIn("the cost is $500").every((c) => c === "$"));
    assert.deepEqual(currenciesIn("S$100").filter((c) => c !== "$"), ["SGD"]);
  });
  await test("T F2 another document of the same policy says US Dollar: nothing filled", () => {
    const out = verifiedExtraction(extraction([death]), [p2(BARE)], { allPages: [p2(BARE)], householdCurrency: "SGD", relatedTexts: ["Policy Schedule\nPolicy currency: US Dollar"] });
    assert.equal(out.insuredPeople[0].coverages[0].evidenceVerified, false);
  });
  await test("T F2 ... one that says Singapore Dollar agrees", () => {
    const out = verifiedExtraction(extraction([death]), [p2(BARE)], { allPages: [p2(BARE)], householdCurrency: "SGD", relatedTexts: ["Policy currency: Singapore Dollar"] });
    assert.equal(out.insuredPeople[0].coverages[0].currency, "SGD");
  });
  await test("T F6 a page that states the currency itself carries no settings note", () => {
    const n = notes([death], [p2("All amounts in SGD\n" + BARE)], "SGD")[0];
    assert.ok(!n.includes(HC.HOUSEHOLD_CURRENCY_NOTE));
    assert.deepEqual(shown([death], [p2("All amounts in SGD\n" + BARE)], "SGD"), ["SGD 100000"]);
  });

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

  // ---- R: compulsory at sign-up (DC 18 Nov), asked of a household that has none
  const { readFileSync } = await import("node:fs");
  const read = (f: string) => readFileSync(f, "utf8");
  await test("R the sign-up form asks for the currency, nothing preselected, and can't be sent without it", () => {
    const form = read("app/signup/SignupForm.tsx");
    assert.match(form, /const \[currency, setCurrency\] = useState\(""\)/);
    assert.match(form, /<option value="" disabled>Choose a currency/);
    assert.match(form, /password\.length < 8 \|\| !currency/);
    assert.match(form, /JSON\.stringify\(\{[^}]*currency/);
  });
  await test("R the sign-up route refuses a missing or unknown currency and stores the choice with the new household", () => {
    const route = read("app/api/auth/signup/route.ts");
    assert.match(route, /parseHouseholdCurrencySetting\(body\.currency\)/);
    assert.match(route, /if \(!currency\) return NextResponse\.json\(\{ error: "Choose the currency your policies are in\." \}, \{ status: 400 \}\)/);
    assert.match(route, /ensureDefaultHousehold\([\s\S]*currency,\s*\}\)/);
    assert.match(read("lib/household/repo.ts"), /insert into accounts\(id, name, currency\)/);
  });
  await test("R the setting's reader accepts only the listed choices", () => {
    for (const v of ["SGD", "sgd ", "NONE", "PHP"]) assert.ok(HC.parseHouseholdCurrencySetting(v), v);
    for (const v of ["", "$", "S$", "JPY", null, 5, "none of these"]) assert.equal(HC.parseHouseholdCurrencySetting(v), null, String(v));
  });
  await test("R a household with no currency is asked on household pages, owners only, and can't dismiss it", () => {
    const prompt = read("components/household-currency-prompt.tsx");
    assert.match(prompt, /m\.role === "owner"/);
    assert.match(prompt, /!data\.activeHouseholdCurrency/);
    assert.doesNotMatch(prompt, /localStorage|sessionStorage|Not now|onDismiss|Remind me/i);
    const shell = read("components/AppShell.tsx");
    assert.match(shell, /!noNav && !reviewerArea && !operatorArea && pathname !== "\/household" && <HouseholdCurrencyPrompt/);
  });

  // Test engineer F1: glued, dotted and header forms name the currency; "Premium $500" stays a bare dollar.
  const named: Array<[string, string]> = [
    ["Hong Kong$ 500,000", "HKD"], ["Singapore$ 500,000", "SGD"], ["Australia$ 500,000", "?"], ["U.S.A. $ 500,000", "USD"],
    ["Aust. $ 500,000", "AUD"], ["Aus $ 500,000", "AUD"], ["Sing. $ 500,000", "SGD"], ["Sum Assured US ($)", "USD"],
    ["US ($) 100,000.00", "USD"], ["Amounts in Dollars (US)", "USD"], ["S  $ 500,000", "SGD"], ["Venezuela $ 5", "?"], ["Puerto Rico $ 5", "?"],
  ];
  for (const [text, code] of named) await test(`F1 '${text}' names ${code}`, () => assert.ok(HC.currenciesNamed(text).includes(code), JSON.stringify(HC.currenciesNamed(text))));
  for (const text of ["Premium $500", "Accidental Death $100,000", "Total $ 5,000"]) await test(`F1 '${text}' stays a bare dollar`, () => assert.deepEqual([...new Set(HC.currenciesNamed(text))], ["$"]));

  // Critic and Test engineer #577: a currency lettered ANYWHERE against the sign is named, never a bare "$" that takes the
  // household's currency. Before the sign (any 1 to 4 letters, dots, spaces, dash or slash), after it ("$US", "($ US)"), in
  // brackets ("Dollars (Singapore)", "($ - US)"), as a header ("Currency: Singapore") or as another mark ("Rm", "P100,000").
  const letteredForms = ["$US500,000", "$US 500,000", "$HK 500,000", "$A 5,000", "$NZ 100", "$S500", "$ US 5,000", "($ US) 5,000", "($US)", "(in $US)", "500,000 $US", "US-$ 5,000", "US/$ 500",
    "Currency: $ (US)", "Currency ($ US)", "Amounts in $ (US)", "A $100,000", "CA $ 5", "Can $ 5", "CDN $ 5", "TW $ 5", "N.T. $ 5", "N.Z. $ 5", "H.K. $ 5", "HKG $ 5", "S. $ 5", "SGP $ 5",
    "Sin $ 5", "S'pore $ 5", "MY $ 5", "MX $ 5", "BN $ 5", "FJ $ 5", "U. S. $ 5", "U S $100,000", "NewZealand$ 5", "UnitedStates$ 5", "$CA 5", "($ S) 5", "($ HK)", "($ AU)", "($ CA)", "$ (US)", "($ - US)",
    "Amounts in Dollars (Singapore)", "Dollars (SGP)", "Dollars (AUS)", "Dollars (Australia)", "Dollars (CA)", "Dollars (Canada)", "Dollars (New Zealand)", "All amounts in Hong Kong ($)", "Sum Assured CA ($)",
    "Currency: Singapore", "Currency: US", "Currency: Hong Kong", "Currency: Australia", "Currency: Canada", "Currency: Malaysia", "In Singapore currency", "Rm 100,000", "R.M. 100,000", "P100,000", "R100,000", "SFr 100,000", "Stg 100,000", "Dhs 100,000", "円 100,000", "元 100,000"];
  for (const t of letteredForms) await test(`C577 '${t}' is a named currency, not a bare $`, () => { const r = HC.currenciesNamed(t); assert.ok(r.some((c) => c !== "$"), JSON.stringify(r)); });
  for (const t of ["Premium $500", "$ 500,000", "Total $5,000", "Sum Assured $ 100,000", "Accidental Death $100,000", "Cover to $ 1,000,000", "in $500", "Pay $50 monthly", "Up to $5,000 per year", "Fee $ 20"])
    await test(`C577 control '${t}' stays a bare dollar`, () => assert.deepEqual(HC.currenciesNamed(t), ["$"]));
  for (const [mark, own] of [["$US ", "USD"], ["US-$ ", "USD"], ["A $", "AUD"], ["CA $", "CAD"], ["HKG $", "HKD"]] as const) {
    await test(`C577 a line '${mark}100,000.00' is filled for no household but its own currency`, () => {
      for (const house of ["SGD", "MYR", "USD"]) {
        const out = shown([{ ...death, currency: null }], [p2(`Life Assured\tMei Ling Tan\nDeath\tIn Force\t${mark}100,000.00`)], house);
        assert.ok(!out.some((x) => x === `${house} 100000`) || house === own, `${house}: ${JSON.stringify(out)}`);
      }
    });
  }
  await test("C577 'Currency: Singapore' fills nothing for a USD or MYR household", () => {
    for (const house of ["USD", "MYR"]) assert.ok(!shown([{ ...death, currency: null }], [p2("Currency: Singapore\n" + BARE)], house).some((x) => x === `${house} 100000`));
  });

  // Critic #579: letters after the figure, after the sign with a linking word or bracket, "Dollars - US"; and the benefit's
  // own label before the sign ("ICU $200", "Plan A $100") is NOT a currency: it fills with the household's currency.
  const afterForms = ["Sum insured $100,000 US", "$100,000 (US)", "$100 HK", "($100 HK)", "$100HK", "$ 100 A", "$100 S", "$ in US", "$ (in US)", "$ [US]", "$ {US}", "$ / US", "[US] $", "HK 100 $",
    "Dollars - US", "Dollars: US", "Dollars in US", "Dollars (US)", "$ - US", "$: US", "$ in HK", "$ - Singapore"];
  for (const t of afterForms) await test(`C579 '${t}' is a named currency, not a bare $`, () => { const r = HC.currenciesNamed(t); assert.ok(r.some((c) => c !== "$"), JSON.stringify(r)); });
  for (const t of ["ICU $200", "OPD $50", "GP $30", "IP $100", "ER $100", "CI $100,000", "TPD $100", "ADB $100", "Per day $100", "Option B $100", "Plan A $100", "Class A $100", "Section A $100", "Rider A $100", "Plan A $100 per day"])
    await test(`C579 control '${t}' is a bare dollar and fills`, () => assert.deepEqual(HC.currenciesNamed(t), ["$"]));
  await test("C579 'Plan A $100' on a schedule fills the household currency; 'A $100' in a cell does not", () => {
    const line = (m: string) => shown([{ ...death, currency: null }], [p2(`Life Assured\tMei Ling Tan\nDeath\tIn Force\t${m}100,000.00`)], "SGD");
    assert.deepEqual(line("Plan A $"), ["SGD 100000"]);
    assert.deepEqual(line("ICU $"), ["SGD 100000"]);
    assert.ok(!line("A $").includes("SGD 100000"));
  });

  console.log(`household-currency-test: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
}
void main();
