/** A document that states its one currency for all its amounts ("Currency : Singapore Dollar", "All amounts are in SGD")
 * confirms the bare figures of its own schedule lines in that currency ("Critical Illness  100,000.00"), wherever the
 * statement stands (page 1 header, schedule footer, a separate page). Fail-safe: a bare "$", a currency only in another
 * document, two currencies, an exchange clause, a code inside an address or reference, a line printing its own currency,
 * and a non-dollar document give nothing. Made-up documents, people and insurers. Pure logic: no database, network or model.
 *   npm run -s documents:document-currency-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { documentStatedCurrency, statedCurrencies, mentionedCurrencies, currencyStatements } = await import("@/lib/documents/document-currency");
  const FC = await import("@/lib/documents/fact-check");
  const { verifiedExtraction } = await import("@/lib/rag/ingest");
  const { PolicyExtractionSchema } = await import("@/lib/ai/extract-policy");

  type Cov = { category: string; amount: number; currency: string; page: number; evidence: string };
  const extraction = (covs: Cov[], name = "Mei Tan") => PolicyExtractionSchema.parse({
    documentType: "Policy schedule", documentRole: "personal_schedule", documentNotes: [], insurer: "Lantern Mutual (fictitious)", productName: "Lantern Shield", productsMentioned: ["Lantern Shield"],
    policyNumber: null, groupPolicyNumber: null, policyType: "Whole Life", policyholder: null, personalCoverageConfirmed: true, startDate: null, renewalOrExpiryDate: null,
    insuredPeople: [{ name, relationshipHint: "self", coverages: covs.map((c) => ({ category: c.category, productName: null, policyNumber: null, amount: c.amount, currency: c.currency, notes: null, sourcePage: c.page, evidenceText: c.evidence, evidenceVerified: true })) }],
    referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [], keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
  });
  type P = { pageNumber: number; text: string; imageCurrency?: string };
  const check = (covs: Cov[], pages: P[]) => FC.factCheckExtraction(extraction(covs), pages).extraction.insuredPeople[0].coverages;
  const verified = (covs: Cov[], pages: P[]) => check(covs, pages).map((c) => c.evidenceVerified);

  // A schedule page whose figure lines print no currency at all.
  const SCHED = "Benefit Schedule\nLife Assured\tMei Tan\nCritical Illness\t150,000.00\nEarly Critical Illness\t50,000.00\nDeath\t200,000.00\nTotal and Permanent Disability\t200,000.00\nPersonal Accident\t100,000.00\nOutpatient Benefit\t1,500.00\nPolicy Term\t25 years";
  const COVS = (currency = "SGD", page = 2): Cov[] => [
    { category: "Critical Illness", amount: 150000, currency, page, evidence: "Critical Illness\t150,000.00" },
    { category: "Early Critical Illness", amount: 50000, currency, page, evidence: "Early Critical Illness\t50,000.00" },
    { category: "Death", amount: 200000, currency, page, evidence: "Death\t200,000.00" },
    { category: "Total Permanent Disability", amount: 200000, currency, page, evidence: "Total and Permanent Disability\t200,000.00" },
    { category: "Personal Accident", amount: 100000, currency, page, evidence: "Personal Accident\t100,000.00" },
    { category: "Outpatient", amount: 1500, currency, page, evidence: "Outpatient Benefit\t1,500.00" },
  ];
  const all = (xs: boolean[], want: boolean) => assert.deepEqual(xs, xs.map(() => want));
  const cover = (head: string): P => ({ pageNumber: 1, text: `Lantern Mutual (fictitious)\nPolicy Schedule\n${head}\nPolicyholder\tMei Tan` });

  // ---- control: the same schedule with no statement anywhere confirms nothing (the problem being fixed)
  await test("B0 control: no statement, bare figures stay unconfirmed", () => all(verified(COVS(), [cover("Policy No.\tLM-0001"), { pageNumber: 2, text: SCHED }]), false));

  // ---- S: statement shapes and positions
  const positives: [string, P[]][] = [
    ["page 1 header field 'Currency : Singapore Dollar'", [cover("Currency : Singapore Dollar"), { pageNumber: 2, text: SCHED }]],
    ["schedule footer sentence 'All amounts are in Singapore Dollars.'", [cover("Policy No.\tLM-0002"), { pageNumber: 2, text: SCHED + "\nAll amounts are in Singapore Dollars." }]],
    ["a separate later page 'Currency: SGD'", [cover("Policy No.\tLM-0003"), { pageNumber: 2, text: SCHED }, { pageNumber: 3, text: "Important Notes\nCurrency: SGD\nPlease read your policy contract." }]],
    ["tabbed field 'Policy Currency<TAB>SGD'", [cover("Policy Currency\tSGD"), { pageNumber: 2, text: SCHED }]],
    ["field with the next field on its line", [cover("Policy Currency : Singapore Dollar    Policy Term : 25 years"), { pageNumber: 2, text: SCHED }]],
    ["field run on to the next label with single spaces", [cover("Currency: Singapore Dollars Premium Mode: Annual"), { pageNumber: 2, text: SCHED }]],
    ["'Currency of the Policy - S$'", [cover("Currency of the Policy - S$"), { pageNumber: 2, text: SCHED }]],
    ["'All figures shown in this schedule are expressed in SGD.'", [cover("All figures shown in this schedule are expressed in SGD."), { pageNumber: 2, text: SCHED }]],
    ["'(Amounts in S$)' under the table title", [cover("Policy No.\tLM-0004"), { pageNumber: 2, text: SCHED.replace("Benefit Schedule", "Benefit Schedule\n(Amounts in S$)") }]],
    ["'Singapore Dollars (SGD)' value", [cover("Contract Currency: Singapore Dollars (SGD)"), { pageNumber: 2, text: SCHED }]],
    ["statement and an S$-printed figure on another line agree", [cover("Currency : SGD\nAnnual Premium\tS$2,400.00"), { pageNumber: 2, text: SCHED }]],
  ];
  for (const [name, pages] of positives) await test(`S ${name}: every bare line confirmed`, () => all(verified(COVS(), pages), true));

  await test("S multi-page schedule: lines on pages 2 and 3, statement on page 1", () => {
    const p2 = "Benefit Schedule (1 of 2)\nLife Assured\tMei Tan\nCritical Illness\t150,000.00\nDeath\t200,000.00";
    const p3 = "Benefit Schedule (2 of 2)\nLife Assured\tMei Tan\nPersonal Accident\t100,000.00\nOutpatient Benefit\t1,500.00";
    all(verified([
      { category: "Critical Illness", amount: 150000, currency: "SGD", page: 2, evidence: "Critical Illness\t150,000.00" },
      { category: "Death", amount: 200000, currency: "SGD", page: 2, evidence: "Death\t200,000.00" },
      { category: "Personal Accident", amount: 100000, currency: "SGD", page: 3, evidence: "Personal Accident\t100,000.00" },
      { category: "Outpatient", amount: 1500, currency: "SGD", page: 3, evidence: "Outpatient Benefit\t1,500.00" },
    ], [cover("Currency : Singapore Dollar"), { pageNumber: 2, text: p2 }, { pageNumber: 3, text: p3 }]), true);
  });
  await test("S US dollars: 'Currency of the Policy: US Dollars' confirms a USD reading", () => all(verified(COVS("USD"), [cover("Currency of the Policy: US Dollars"), { pageNumber: 2, text: SCHED }]), true));
  await test("S the amount and currency are kept as read", () => {
    const c = check(COVS(), [cover("Currency : Singapore Dollar"), { pageNumber: 2, text: SCHED }]);
    assert.deepEqual(c.map((x) => [x.amount, x.currency]), COVS().map((x) => [x.amount, "SGD"]));
  });
  await test("S intake (verifiedExtraction) confirms the bare line too", () => {
    const e = verifiedExtraction(extraction(COVS().slice(0, 1)), [cover("Currency : Singapore Dollar"), { pageNumber: 2, text: SCHED }]);
    assert.equal(e.insuredPeople[0].coverages[0].evidenceVerified, true); assert.equal(e.insuredPeople[0].coverages[0].amount, 150000);
  });

  // ---- N: negative controls
  const negatives: [string, P[], string?][] = [
    ["a bare '$' statement ('All amounts are in $')", [cover("All amounts are in $"), { pageNumber: 2, text: SCHED }]],
    ["a bare '$' field ('Currency: $')", [cover("Currency: $"), { pageNumber: 2, text: SCHED }]],
    ["bare 'dollars' ('All amounts are in dollars.')", [cover("All amounts are in dollars."), { pageNumber: 2, text: SCHED }]],
    ["two statements of different currencies", [cover("Currency : Singapore Dollar"), { pageNumber: 2, text: SCHED + "\nAll amounts are in US Dollars." }]],
    ["a statement plus a US$ figure elsewhere in the document", [cover("Currency : SGD"), { pageNumber: 2, text: SCHED }, { pageNumber: 3, text: "Rider schedule\nLife Assured\tMei Tan\nTerm Rider\tUS$ 50,000.00" }]],
    ["an exchange clause only ('converted to Singapore Dollars at the prevailing rate')", [cover("Policy No.\tLM-0005"), { pageNumber: 2, text: SCHED + "\nClaims incurred overseas will be converted to Singapore Dollars at the prevailing exchange rate." }]],
    ["'All amounts payable will be converted into Singapore Dollars.'", [cover("Policy No.\tLM-0006"), { pageNumber: 2, text: SCHED + "\nAll amounts payable will be converted into Singapore Dollars." }]],
    ["'Amounts are in SGD unless otherwise stated'", [cover("Amounts are in SGD unless otherwise stated"), { pageNumber: 2, text: SCHED }]],
    ["SGD inside an address", [cover("Mailing address: 12 SGD Lane, #04-01"), { pageNumber: 2, text: SCHED }]],
    ["SGD inside a reference number", [cover("Reference No.: SGD-2291-XK\nOur ref SGD 20250117"), { pageNumber: 2, text: SCHED }]],
    ["Singapore only as a place", [cover("Lantern Mutual Pte Ltd, Singapore 049999"), { pageNumber: 2, text: SCHED }]],
    ["a non-dollar document stating its currency (Ringgit)", [cover("Currency : Ringgit Malaysia"), { pageNumber: 2, text: SCHED }]],
    ["a pound-sterling document", [cover("All amounts are in pounds sterling."), { pageNumber: 2, text: SCHED }]],
    ["a statement in SGD and a page image printing USD", [cover("Currency : SGD"), { pageNumber: 2, text: SCHED, imageCurrency: "USD" }]],
    ["a statement of a dollar the list does not know ('New Zealand Dollars')", [cover("Currency : New Zealand Dollars"), { pageNumber: 2, text: SCHED }]],
  ];
  for (const [name, pages] of negatives) await test(`N ${name}: nothing confirmed`, () => all(verified(COVS(), pages), false));

  await test("N the currency stated only in another document of the same household", () => {
    const docA: P[] = [cover("Currency : Singapore Dollar"), { pageNumber: 2, text: SCHED }];
    const docB: P[] = [cover("Policy No.\tLM-0007"), { pageNumber: 2, text: SCHED }];
    all(verified(COVS(), docA), true);
    all(verified(COVS(), docB), false);
  });
  await test("N a line printing its own different currency: an SGD reading stays unconfirmed", () => {
    const text = "Benefit Schedule\nLife Assured\tMei Tan\nDeath\tUS$ 200,000.00";
    assert.deepEqual(verified([{ category: "Death", amount: 200000, currency: "SGD", page: 2, evidence: "Death\tUS$ 200,000.00" }], [cover("Currency : SGD"), { pageNumber: 2, text }]), [false]);
    // ... and the line's own currency still confirms a reading in it.
    assert.deepEqual(verified([{ category: "Death", amount: 200000, currency: "USD", page: 2, evidence: "Death\tUS$ 200,000.00" }], [cover("Currency : SGD"), { pageNumber: 2, text }]), [true]);
  });
  await test("N a line printing RM in an SGD-stated document stays unconfirmed for SGD", () => {
    const text = "Benefit Schedule\nLife Assured\tMei Tan\nDeath\tRM 200,000.00";
    assert.deepEqual(verified([{ category: "Death", amount: 200000, currency: "SGD", page: 2, evidence: "Death\tRM 200,000.00" }], [cover("Currency : SGD"), { pageNumber: 2, text }]), [false]);
  });
  await test("N a ringgit document's MYR reading is not filled in, and keeps its own currency (never $)", () => {
    const c = check(COVS("MYR"), [cover("Currency : Ringgit Malaysia"), { pageNumber: 2, text: SCHED }]);
    all(c.map((x) => x.evidenceVerified), false); assert.deepEqual(c.map((x) => x.currency), c.map(() => "MYR"));
  });
  await test("N the reading's currency differs from the statement", () => all(verified(COVS("SGD"), [cover("Currency : US Dollars"), { pageNumber: 2, text: SCHED }]), false));
  await test("N a figure that is not money-shaped (no separators, no decimals)", () => {
    const text = "Benefit Schedule\nLife Assured\tMei Tan\nDeath\t200000";
    assert.deepEqual(verified([{ category: "Death", amount: 200000, currency: "SGD", page: 2, evidence: "Death\t200000" }], [cover("Currency : SGD"), { pageNumber: 2, text }]), [false]);
  });
  await test("N a page that does not name the person", () => {
    const text = SCHED.replace("Life Assured\tMei Tan\n", "");
    const people = FC.factCheckExtraction(extraction(COVS()), [{ pageNumber: 1, text: "Currency : SGD\nPolicyholder\tMei Tan" }, { pageNumber: 2, text }]).extraction.insuredPeople;
    all(people.flatMap((p) => p.coverages.map((c) => c.evidenceVerified)), false);
  });
  await test("N intake (verifiedExtraction): no statement, no confirmation", () => {
    const e = verifiedExtraction(extraction(COVS().slice(0, 1)), [cover("Policy No.\tLM-0008"), { pageNumber: 2, text: SCHED }]);
    assert.equal(e.insuredPeople[0].coverages[0].evidenceVerified, false);
  });

  // ---- U: the pieces
  const shapes: [string, string[]][] = [
    ["Currency : Singapore Dollar", ["SGD"]], ["Policy Currency\tUSD", ["USD"]], ["All amounts are in S$.", ["SGD"]],
    ["Benefits are payable in US Dollars.", ["USD"]], ["Currency: $", []], ["Ref SGD-12345", []], ["Paid in SGD", []],
    ["Converted to SGD at the prevailing rate.", []], ["Currency risk applies to investment-linked funds.", []],
    ["Exchange rate: 1 USD = 1.35 SGD", []], ["Name\tMei Tan\t\tCurrency\tSGD", ["SGD"]],
  ];
  for (const [text, want] of shapes) await test(`U statedCurrencies(${JSON.stringify(text)})`, () => assert.deepEqual(statedCurrencies(text), want));
  await test("U an illness abbreviation (CAD) is no currency; 'CAD 5,000' is", () => {
    assert.deepEqual(mentionedCurrencies("Coronary Artery Disease (CAD)").filter((c) => c !== "$"), []);
    assert.ok(mentionedCurrencies("Limit CAD 5,000").some((c) => c.startsWith("?")));
  });
  await test("U documentStatedCurrency is null for a bare $ document with $ figures", () => assert.equal(documentStatedCurrency([{ text: "Currency: $\nDeath\t$200,000.00" }]), null));

  // ---- G: round 1 gate repros (PR #507)
  const P3 = (text: string): P => ({ pageNumber: 3, text });
  for (const value of ["USS", "U.S.D.", "U5D", "Dollar (US)", "USDollar", "Unites States Dollar", "Ringgit Malaysia", "SGD (USD for Plan B)"])
    await test(`G1 an unknown currency field value blocks the document ('Policy Currency : ${value}')`, () => {
      const pages = [cover("Currency : SGD"), { pageNumber: 2, text: SCHED }, P3(`Policy 2\nLife Assured\tMei Tan\nPolicy Currency : ${value}\nDeath\t300,000.00`)];
      all(verified([...COVS(), { category: "Death", amount: 300000, currency: "SGD", page: 3, evidence: "Death\t300,000.00" }], pages), false);
    });
  await test("G1 an unknown value in a statement sentence blocks ('All amounts are in USS.')", () => all(verified(COVS(), [cover("Currency : SGD"), { pageNumber: 2, text: SCHED + "\nAll amounts are in USS." }]), false));
  await test("G3 another currency on an unchecked page blocks (intake passes every page)", () => {
    const e = verifiedExtraction(extraction(COVS().slice(0, 1)), [cover("Currency : SGD"), { pageNumber: 2, text: SCHED }],
      { allPages: [cover("Currency : SGD"), { pageNumber: 2, text: SCHED }, P3("Rider\nCurrency : USD")] });
    assert.equal(e.insuredPeople[0].coverages[0].evidenceVerified, false);
    const control = verifiedExtraction(extraction(COVS().slice(0, 1)), [cover("Currency : SGD"), { pageNumber: 2, text: SCHED }], { allPages: [cover("Currency : SGD"), { pageNumber: 2, text: SCHED }, P3("Rider notes")] });
    assert.equal(control.insuredPeople[0].coverages[0].evidenceVerified, true);
  });
  for (const head of ["Premium  Currency : SGD", "Premium\tCurrency\tSGD", "Premium Payment\tCurrency: SGD", "Mode of Payment  Currency: SGD", "Premium Currency : SGD", "Rider Currency : SGD",
    "Premium amounts are payable in SGD.", "Your premium figures are shown in SGD.", "Rider benefits are payable in SGD.", "Cash values are in SGD"])
    await test(`G4 a premium, rider or value statement is not the document's ('${head.replace(/\t/g, "<TAB>")}')`, () => all(verified(COVS(), [cover(head), { pageNumber: 2, text: SCHED }]), false));
  for (const next of ["Save for the overseas rider, which is in another currency.", "Except the hospital cash benefit.", "Other than the rider shown on page 3.", "Excluding the investment-linked rider."])
    await test(`G5 an exception on the next line blocks ('${next}')`, () => all(verified(COVS(), [cover("All amounts are in SGD.\n" + next), { pageNumber: 2, text: SCHED }]), false));
  await test("G5 control: an unrelated next line keeps the statement", () => all(verified(COVS(), [cover("All amounts are in SGD.\nPolicyholder copy"), { pageNumber: 2, text: SCHED }]), true));
  for (const [label, line, amount] of [["units", "Units held\t100,000.00 units", 100000], ["km", "Ambulance\t10,000.00 km", 10000], ["kg", "Baggage\t1,000.00 kg", 1000], ["a word after", "Death\t200,000.00 approx", 200000]] as const)
    await test(`G7 a figure followed by a unit or word is not confirmed (${label})`, () => {
      assert.deepEqual(verified([{ category: "Death", amount, currency: "SGD", page: 2, evidence: line }], [cover("Currency : SGD"), { pageNumber: 2, text: `Benefit Schedule\nLife Assured\tMei Tan\n${line}` }]), [false]);
    });
  await test("G7 control: a figure ending its line, or its cell before another cell, is confirmed", () => {
    const text = "Benefit Schedule\nLife Assured\tMei Tan\nDeath 200,000.00\nCritical Illness\t150,000.00\t20 years";
    assert.deepEqual(verified([{ category: "Death", amount: 200000, currency: "SGD", page: 2, evidence: "Death 200,000.00" }, { category: "Critical Illness", amount: 150000, currency: "SGD", page: 2, evidence: "Critical Illness\t150,000.00\t20 years" }],
      [cover("Currency : SGD"), { pageNumber: 2, text }]), [true, true]);
  });
  await test("G statement and blocking pieces", () => {
    assert.deepEqual(currencyStatements("Currency of the Policy: US Dollars"), { stated: ["USD"], block: false });
    assert.deepEqual(currencyStatements("Policy Currency : USS"), { stated: [], block: true });
    assert.deepEqual(currencyStatements("Currency risk applies to investment-linked funds."), { stated: [], block: false });
    assert.deepEqual(currencyStatements("Claims are payable in Singapore Dollars or the equivalent."), { stated: [], block: false });
  });

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`document-currency: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
