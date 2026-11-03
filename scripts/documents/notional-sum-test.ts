/** A schedule that says its printed sum insured is not what is paid ("The sum insured reflected in this schedule is to
 * determine the bonus calculation. The 'sum insured' does not represent the amount to be paid out for claims or
 * surrender."): that figure is never a cover amount. At intake the schedule line is kept with no amount; in the benefit
 * table the cover has no sum insured and a row printing the same figure has none; on Home the line is named with no
 * amount and the other policies' fixed sums are shown as such, never added to it. Made-up documents in several markets
 * and languages; pages that only limit or condition their sum are not affected. Pure logic: no database, network or model.
 *   npm run -s documents:notional-sum-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { printsNotionalSum, NOTIONAL_SUM_NOTE } = await import("@/lib/documents/notional-sum");
  const { checkReading } = await import("@/lib/benefit-table/check");
  const { lumpSumParts } = await import("@/lib/coverage/table-figures");
  const FC = await import("@/lib/documents/fact-check");
  const { PolicyExtractionSchema } = await import("@/lib/ai/extract-policy");

  // ---- N: which pages say their sum insured is notional
  const notional: [string, string][] = [
    ["SG footnote, wrapped, quoted", "1\tTHE SUM INSURED REFLECTED IN THIS SCHEDULE IS TO DETERMINE THE BONUS CALCULATION(IF ANY). THE \"SUM INSURED\" DOES NOT\nREPRESENT THE AMOUNT TO BE PAID OUT FOR CLAIMS OR SURRENDER. PLEASE REFER TO POLICY CONTRACT FOR HOW DEATH BENEFIT IS\nCOMPUTED."],
    ["UK with-profits", "The basic sum assured is used only to calculate bonuses and is not the amount payable on a claim."],
    ["HK, contraction", "Note: the Sum Assured doesn't represent the benefit payable on death or surrender."],
    ["for bonus calculation only", "Sum Insured (for bonus calculation purposes only)\tHK$200,000"],
    ["notional sum assured", "Notional Sum Assured\tRM 80,000"],
    ["MY Malay", "Jumlah Diinsuranskan yang ditunjukkan tidak mewakili amaun yang akan dibayar bagi tuntutan atau penyerahan."],
    ["Chinese simplified", "注：本保单所示保额不代表身故时的赔付金额。"],
    ["Chinese traditional, bonus", "保額僅用於計算紅利，詳情請參閱保單條款。"],
    // Closed phrasings for the same notional sum (Critic M2)
    ["bonus purposes and not the claim amount", "The basic sum assured is for bonus calculation purposes and is not the claim amount."],
    ["for bonus computation only", "Sum Assured (for bonus computation only)\tS$80,000"],
    ["nominal, basis for bonus, not payable on death", "The nominal sum assured is used solely as a basis for bonus allocation and is not payable on death."],
    ["is notional", "The Sum Insured stated is notional and is not payable on any claim."],
    ["a bonus base only", "The Sum Assured shown above is a bonus base only and is not the benefit payable."],
    ["Indonesian", "Uang Pertanggungan tidak mencerminkan jumlah yang dibayarkan atas klaim."],
    ["French", "Le capital assuré ne représente pas le montant versé en cas de sinistre."],
    ["Chinese, not the death payout", "此保额仅作为计算红利之用，并非身故赔付金额。"],
  ];
  for (const [name, text] of notional) await test(`N ${name}: notional`, () => assert.equal(printsNotionalSum(text), true, text));
  const plain: [string, string][] = [
    ["sum insured not reduced", "The sum insured will not be reduced by any amount paid under this rider."],
    ["not payable if", "The sum assured is not payable if death results from suicide within one year."],
    ["no bonuses included", "The death benefit is the sum insured. The sum insured does not include bonuses."],
    ["sum is the amount paid", "The Sum Assured is the amount we pay on the death of the Life Assured."],
    ["sum insured on a plain schedule", "BASIC/CORE BENEFIT\tSUM INSURED\nTERM LIFE\tS$500,000\nPLEASE REFER TO CONTRACT FOR MORE DETAILS."],
    ["premium not refundable", "The premium does not represent the amount payable on surrender."],
    ["Malay plain", "Jumlah Diinsuranskan akan dibayar apabila berlaku kematian."],
    ["Chinese plain", "身故保险金等于保额。"],
    ["bonus mentioned without the sum", "Bonuses are not guaranteed and may be used to calculate the surrender value."],
    // Ordinary policies that contrast their sum with something else (Critic H1, TE O2 on #291): never notional.
    ["not the surrender value", "The Sum Assured does not represent the surrender value payable on surrender of the policy."],
    ["total death benefit is sum plus bonuses", "The Sum Assured does not represent the total death benefit, which is the Sum Assured plus any bonuses declared."],
    ["not the amount under one benefit", "The Sum Insured is not the amount payable under Benefit 3, which pays 50% of the Sum Insured."],
    ["used to calculate bonus, then paid", "The sum assured is used to calculate the reversionary bonus. On death we pay the sum assured plus bonuses."],
    ["not the amount where partial", "The sum insured shall not be the amount payable where the claim is made under the partial disability table."],
    ["not the premiums paid", "Your coverage amount does not equal the premiums paid."],
    ["not the loan", "The Face Amount does not reflect any outstanding policy loan, which is deducted from the claim."],
    ["Malay, not the premium", "Jumlah diinsuranskan tidak sama dengan jumlah premium yang dibayar."],
    ["bonus only where participating, otherwise death benefit", "The Basic Sum Assured is for bonus calculation only where the policy is participating; otherwise it is the death benefit."],
    ["not the hospital maximum", "The sum insured does not represent the maximum we pay for hospital bills, which are paid as charged up to the limits below."],
    ["not paid if you cancel", "Your sum assured is not the amount paid if you cancel; see surrender values."],
    ["Chinese, not the premiums", "保额不等于已缴保费总额。身故赔付保额。"],
  ];
  for (const [name, text] of plain) await test(`P ${name}: not notional`, () => assert.equal(printsNotionalSum(text), false, text));

  // ---- T: the benefit table (read time, on stored readings: existing households need no new read)
  const page = (note: string) => `SCHEDULE PAGE\nLIFE INSURED\tAMELIA TAN\nPLAN NAME\tGROWTH BUILDER 12\nCURRENCY\tSINGAPORE DOLLARS\nBASIC BENEFIT\tSUM INSURED\nGROWTH BUILDER 12\tS$64,000.00\nDEATH BENEFIT\tS$64,000.00\nHOSPITAL CASH PER DAY\tS$100.00\n${note}`;
  const NOTE = "1 THE SUM INSURED SHOWN IS TO DETERMINE THE BONUS CALCULATION. THE SUM INSURED DOES NOT REPRESENT THE AMOUNT TO BE PAID OUT FOR CLAIMS.";
  const read = (note: string) => checkReading({ id: "doc-n", name: "Schedule.pdf", readable: true, pages: [{ page: 1, text: page(note) }] } as never, {
    document: { kind: "personal_proof", product: "GROWTH BUILDER 12", insurer: null, namedPeople: ["AMELIA TAN"], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: "AMELIA TAN", product: "GROWTH BUILDER 12", cover: "GROWTH BUILDER 12", plan: null, sumInsured: 64000, asOf: null, page: 1, quote: "GROWTH BUILDER 12\tS$64,000.00" }],
    benefits: [
      { section: null, column: null, benefit: "Death Benefit", pays: "amount", value: 64000, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: "DEATH BENEFIT\tS$64,000.00" },
      { section: null, column: null, benefit: "Hospital Cash per day", pays: "per_day", value: 100, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: "HOSPITAL CASH PER DAY\tS$100.00" },
    ] });
  await test("T1 a notional page: the cover has no sum insured, the printed figure is kept for matching only", () => {
    const r = read(NOTE);
    assert.equal(r.covers.length, 1); assert.equal(r.covers[0].sumInsured, null); assert.equal(r.covers[0].notionalSum, 64000);
  });
  await test("T2 a row printing the notional figure keeps its row, with no figure; another row's own figure stays", () => {
    const r = read(NOTE);
    const death = r.benefits.find((b) => b.benefit === "Death Benefit")!, cash = r.benefits.find((b) => /Hospital/.test(b.benefit))!;
    assert.ok(death, "the death row is kept"); assert.equal(death.value, null); assert.equal(death.pays, "words");
    assert.equal(cash.value, 100); assert.equal(cash.pays, "per_day");
  });
  await test("T3 control: the same schedule with no such note keeps its sum and figures", () => {
    const r = read("PLEASE REFER TO CONTRACT FOR MORE DETAILS.");
    assert.equal(r.covers[0].sumInsured, 64000); assert.equal(r.covers[0].notionalSum ?? null, null);
    assert.equal(r.benefits.find((b) => b.benefit === "Death Benefit")!.value, 64000);
  });

  await test("T4 a rider on the same notional page keeps its own fixed sum; the basic plan has none (TE O1, Critic L4)", () => {
    const text = `SCHEDULE\nLIFE INSURED\tWONG KA MAN\nBASIC PLAN\tSUM ASSURED\nHARBOUR PAR 25\tHK$300,000\nCRITICAL ILLNESS RIDER\tHK$150,000\nThe sum assured of the basic plan is used only to calculate bonuses and is not the amount payable on a claim.`;
    const r = checkReading({ id: "doc-p", name: "Par.pdf", readable: true, pages: [{ page: 1, text }] } as never, {
      document: { kind: "personal_proof", product: "HARBOUR PAR 25", insurer: null, namedPeople: ["WONG KA MAN"], plan: null, periodFrom: null, periodTo: null },
      covers: [
        { person: "WONG KA MAN", product: "HARBOUR PAR 25", cover: "Death", plan: null, sumInsured: 300000, asOf: null, page: 1, quote: "HARBOUR PAR 25\tHK$300,000" },
        { person: "WONG KA MAN", product: "HARBOUR PAR 25", cover: "Critical Illness", plan: null, sumInsured: 150000, asOf: null, page: 1, quote: "CRITICAL ILLNESS RIDER\tHK$150,000" },
      ], benefits: [] });
    assert.equal(r.covers.find((c) => c.cover === "Death")!.sumInsured, null);
    assert.equal(r.covers.find((c) => c.cover === "Critical Illness")!.sumInsured, 150000);
  });

  // ---- H: Home tile parts
  const line = (name: string, amount: number, doc: string) => ({ name, amount, currency: "SGD", documentIds: [doc] });
  await test("H1 a notional schedule line is named with no amount; the other policy's fixed sum is shown as such, never a total", () => {
    const held = [{ coverKey: "gb", name: "GROWTH BUILDER 12", documentId: "doc-n", sumInsured: null, currency: "SGD", notionalSum: 64000 }];
    const { parts, total, known } = lumpSumParts([], [line("Harbour Term", 500000, "doc-h"), line("GROWTH BUILDER 12", 64000, "doc-n")], held, "Death");
    assert.equal(total, null);
    assert.deepEqual(parts.map((p) => [p.name, p.amount]), [["Harbour Term", 500000], ["GROWTH BUILDER 12", null]]);
    assert.deepEqual(known && [known.amount, known.currency, known.without], [500000, "SGD", ["GROWTH BUILDER 12"]]);
  });
  await test("H2 a line of another document with the same figure is not notional", () => {
    const held = [{ coverKey: "gb", name: "GROWTH BUILDER 12", documentId: "doc-n", sumInsured: null, currency: "SGD", notionalSum: 64000 }];
    const { parts, total } = lumpSumParts([], [line("Harbour Term", 64000, "doc-h")], held, "Death");
    assert.equal(total, 64000); assert.deepEqual(parts.map((p) => p.amount), [64000]);
  });
  await test("H3 a line of that document with a different figure is not the notional figure", () => {
    const held = [{ coverKey: "gb", name: "GROWTH BUILDER 12", documentId: "doc-n", sumInsured: null, currency: "SGD", notionalSum: 64000 }];
    const { parts } = lumpSumParts([], [line("Rider Term", 30000, "doc-n")], held, "Death");
    assert.deepEqual(parts.map((p) => p.amount), [30000]);
  });

  // ---- I: intake keeps the line, with no amount and a fixed note
  const extraction = (amount: number, evidence: string) => PolicyExtractionSchema.parse({
    documentType: "Policy schedule", documentRole: "personal_schedule", documentNotes: [], insurer: "Lotus Life (fictitious)", productName: "Lotus Wealth 20", productsMentioned: ["Lotus Wealth 20"],
    policyNumber: "LW-20-5512", groupPolicyNumber: null, policyType: "Whole Life", policyholder: null, personalCoverageConfirmed: true, startDate: null, renewalOrExpiryDate: null,
    insuredPeople: [{ name: "Siti Aminah binti Yusof", relationshipHint: "self", coverages: [{ category: "Death", productName: "Lotus Wealth 20", policyNumber: "LW-20-5512", amount, currency: "MYR", notes: null, sourcePage: 1, evidenceText: evidence, evidenceVerified: true }] }],
    referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [], keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
  });
  const myPage = (note: string) => [{ pageNumber: 1, text: `JADUAL POLISI / POLICY SCHEDULE\nOrang Diinsuranskan\tSiti Aminah binti Yusof\nLotus Wealth 20\tRM 120,000.00\n${note}` }];
  await test("I1 a Malay notional note: the line is kept with no amount and the fixed note", () => {
    const c = FC.factCheckExtraction(extraction(120000, "Lotus Wealth 20\tRM 120,000.00"), myPage("Jumlah Diinsuranskan tidak mewakili amaun yang dibayar bagi tuntutan.")).extraction.insuredPeople[0].coverages[0];
    assert.equal(c.amount, null); assert.ok((c.notes ?? "").includes(NOTIONAL_SUM_NOTE), String(c.notes)); assert.equal(c.evidenceVerified, true);
  });
  await test("I2 control: no such note keeps the amount", () => {
    const c = FC.factCheckExtraction(extraction(120000, "Lotus Wealth 20\tRM 120,000.00"), myPage("Sila rujuk kontrak polisi.")).extraction.insuredPeople[0].coverages[0];
    assert.equal(c.amount, 120000); assert.equal(c.evidenceVerified, true);
  });

  await test("I3 a rider line on a notional page keeps its amount", () => {
    const e = extraction(30000, "Term Rider\tRM 30,000.00");
    e.insuredPeople[0].coverages[0].productName = "Term Rider";
    const c = FC.factCheckExtraction(e, [{ pageNumber: 1, text: `JADUAL POLISI\nOrang Diinsuranskan\tSiti Aminah binti Yusof\nLotus Wealth 20\tRM 120,000.00\nTerm Rider\tRM 30,000.00\nJumlah Diinsuranskan tidak mewakili amaun yang dibayar bagi tuntutan.` }]).extraction.insuredPeople[0].coverages[0];
    assert.equal(c.amount, 30000);
  });

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`notional-sum: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
