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

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`notional-sum: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
