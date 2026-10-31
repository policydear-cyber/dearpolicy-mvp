/**
 * A schedule line's amount is a benefit's sum only when its own printed label says so. A premium, a waiver of premium, a
 * fund, surrender or cash value, a policy loan, a fee or tax charged on the policy, or the person's own share of a bill
 * is never a cover's sum: no Home tile, no total, no claim amount (TE P1: "Life Cover Premium A$1,200" and "Life Insurance
 * Fund Value RM45,000" gave a death amount; "TPD Premium Waiver S$3,000" is stored under Total Permanent Disability).
 * Made-up schedules in S$, A$, RM, Rp, £, €, HK$ and ₹, in English, Malay, Indonesian, French, German and Chinese; each
 * kind has a control that stays a sum. Pure: no database, no model, no network.
 *   npm run coverage:benefit-sum-line-test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (() => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failed: string[] = [];
const t = (name: string, fn: () => void) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };

async function main() {
  const { notABenefitSum, lineLabel, benefitSumKind, asBenefitLine } = await import("@/lib/coverage/benefit-sum-line");
  const kind = (evidenceText: string, amount: number) => benefitSumKind({ evidenceText, amount });
  const held = (evidenceText: string, amount: number) => assert.equal(kind(evidenceText, amount), "withhold", `«${evidenceText}» ${amount}: the cover stays, its figure is withheld`);
  const whole = (evidenceText: string, amount: number) => assert.equal(kind(evidenceText, amount), "sum", `«${evidenceText}» ${amount} is the cover's sum`);
  const not = (evidenceText: string, amount: number) => assert.equal(notABenefitSum({ evidenceText, amount }), true, `«${evidenceText}» ${amount} is no benefit sum`);
  const sum = (evidenceText: string, amount: number) => assert.equal(notABenefitSum({ evidenceText, amount }), false, `«${evidenceText}» ${amount} is a benefit sum`);

  t("premiums and contributions are never a sum (A$, S$, RM, Rp, £, €, Chinese)", () => {
    not("Life Cover Premium\tA$1,200", 1200); not("Term Life Premium S$1,204.50 yearly", 1204.5); not("Annual premium: RM2,400", 2400);
    not("Premi tahunan Rp4.800.000", 4800000); not("Monthly premium £18.40", 18.4); not("Prime annuelle 1 250,00 €", 1250);
    not("Jahresprämie €980", 980); not("年度保费 HK$12,000", 12000); not("Takaful contribution RM1,800 a year", 1800); not("Caruman bulanan RM150", 150);
  });
  t("a waiver of premium is never the cover it waives for", () => {
    not("TPD Premium Waiver\tS$3,000", 3000); not("Waiver of Premium (Critical Illness) S$2,400", 2400);
    not("Premium Waiver (TPD) RM1,200", 1200); not("Beitragsbefreiung €600", 600);
  });
  t("a value the policy holds is never a sum it pays on a claim", () => {
    not("Life Insurance Fund Value\tRM45,000", 45000); not("Guaranteed Cash Value at year 10: S$12,340", 12340); not("Surrender value £8,200", 8200);
    not("Nilai tunai Rp25.000.000", 25000000); not("Valeur de rachat 15 000 €", 15000); not("Rückkaufswert €7.500", 7500); not("现金价值 HK$30,000", 30000);
    not("Account value as at 31 Dec: S$56,789.10", 56789.1);
  });
  t("a loan, a fee or a tax on the policy, and the person's own share of a bill, are never a sum", () => {
    not("Policy loan outstanding S$4,000", 4000); not("Policy fee S$50", 50); not("Stamp duty RM10", 10); not("GST S$72", 72);
    not("Deductible S$3,500 per policy year", 3500); not("Excess £250 each claim", 250); not("Co-insurance cap S$3,000", 3000); not("Selbstbehalt €150", 150);
  });
  t("controls: the cover's own sums stay sums, also when a product's name says Premium or Premier", () => {
    sum("Death\tS$500,000", 500000); sum("Total Permanent Disability A$500,000", 500000); sum("Sum assured RM200,000", 200000);
    sum("Premium Plan sum assured S$100,000", 100000); sum("Premier ward: Room and board S$1,200 a day", 1200); sum("Premium Shield annual limit S$1,500,000", 1500000);
    sum("Surgeon's fee up to S$2,000", 2000); sum("Hospital charges as charged, up to RM150,000", 150000); sum("Uang pertanggungan Rp500.000.000", 500000000);
    sum("Capital décès 250 000 €", 250000); sum("身故保额 HK$1,000,000", 1000000); sum("Accidental death ₹5,00,000", 500000); sum("Home Loan Protection: death S$300,000", 300000); sum("Mortgage loan cover RM400,000", 400000);
  });
  t("the label is the line's own: a premium printed on the next row does not touch the sum above it, and the other way round", () => {
    const page = "Death benefit S$500,000\nAnnual premium S$1,204.50";
    sum(page, 500000); not(page, 1204.5);
    assert.equal(lineLabel(page, 1204.5), "Annual premium S$");
    sum("Sum insured S$250,000; Premium S$300", 250000); not("Sum insured S$250,000; Premium S$300", 300);
  });
  t("only the words right before the figure decide: brackets, qualifiers, dates and an earlier clause never do (Critic H1, TE F1)", () => {
    sum("Overseas Medical Expenses (Excess: S$100) S$500,000", 500000); sum("Overseas medical expenses (no excess applies) S$250,000", 250000);
    sum("Deductible S$3,500, Annual Limit S$1,000,000", 1000000); not("Deductible S$3,500, Annual Limit S$1,000,000", 3500);
    sum("Annual limit after deductible S$1,500,000", 1500000); sum("Pays medical expenses in excess of S$500 up to S$10,000", 10000);
    sum("Hospitalisation (co-insurance 10% applies) S$1,000,000", 1000000); sum("Daily room & board (inclusive of GST) S$500", 500);
    sum("Room & board including service charges: S$800 per day", 800); sum("Funeral expenses including undertaker fees S$5,000", 5000);
    sum("Accidental Death (premiums waived on claim) RM100,000", 100000); sum("Accidental death — in addition to the cash value, S$50,000", 50000);
    sum("Krankheitskosten ohne Selbstbeteiligung 100.000 €", 100000); sum("Medical Expenses Franchise €75  Plafond €150 000", 150000);
    not("Medical Expenses Franchise €75  Plafond €150 000", 75);
    sum("Life Cover S$500,000 Premium S$1,200", 500000); not("Life Cover S$500,000 Premium S$1,200", 1200);
    not("Fund value as at 30 Sep 2026: A$45,210.33", 45210.33); not("Guaranteed cash value at age 65: S$80,000", 80000); not("Total premium (incl. GST) S$1,080", 1080);
    not("Cotisation annuelle 1 200 €", 1200); not("Nilai Serahan / Surrender value\tRM45,000", 45000); not("Premium payable S$1,000", 1000);
  });
  t("a cover word after the term, or a sum named as the other choice, keeps the line", () => {
    sum("Rental Vehicle Excess S$1,000", 1000); sum("Car Rental Excess Cover £2,000", 2000); sum("Excess Waiver Benefit A$5,000", 5000);
    sum("Return of Premium Benefit S$12,000", 12000); sum("Return of Premium S$20,000", 20000); sum("Pengembalian premi Rp20.000.000", 20000000);
    sum("Death Benefit: 101% of premiums paid or Sum Assured of S$200,000, whichever is higher", 200000);
    sum("Death benefit: higher of sum assured or fund value S$150,000", 150000);
    sum("Mortgage loan protection — outstanding loan balance covered up to S$300,000", 300000); sum("Loan Protection Death Benefit S$300,000", 300000);
    sum("Basic Contribution Takaful Plan — Sum Covered RM200,000", 200000); sum("Sum Covered (per contribution schedule) RM100,000", 100000);
  });
  t("sentence forms in other languages stay sums (Malay, Indonesian, Chinese, French, German, English)", () => {
    sum("Manfaat kematian dibayar sebanyak RM250,000", 250000); sum("Jika Peserta meninggal dunia, santunan sebesar Rp500.000.000 dibayarkan", 500000000);
    sum("被保险人身故，本公司按基本保额 HK$1,000,000 给付", 1000000); sum("En cas de décès, nous versons un capital de 150 000 €", 150000);
    sum("Im Todesfall zahlen wir eine Leistung von 200.000 €", 200000); sum("The policy pays a death benefit of A$850,000 to your estate", 850000);
    sum("Waiting period 30 days; Critical illness S$200,000", 200000); sum("Premium ward hospital cash S$300/day", 300);
  });
  t("a cover whose figure may be a waived premium, a value or a share keeps its line and shows no figure (TE F2)", () => {
    held("Waiver of premium benefit S$3,000", 3000); held("Premium waiver cover S$3,000", 3000); held("Fund value benefit S$45,000", 45000);
    held("Payor Waiver Benefit RM1,200", 1200); held("Excess Waiver Benefit A$5,000", 5000); held("Co-insurance 10%, capped at S$3,000", 3000);
    held("Death benefit: higher of sum assured or fund value S$150,000", 150000); not("Manfaat pengecualian caruman RM2,400", 2400);
    not("Surrender value of the policy (guaranteed) S$12,000", 12000);
    // Controls: a plan tier, a mortgage cover's loan balance and a sum named after a premium alternative are whole sums.
    whole("Premium Plan Death Benefit S$500,000", 500000); whole("Contribution Takaful Plan Death Benefit RM200,000", 200000);
    whole("Mortgage loan protection — outstanding loan balance covered up to S$300,000", 300000); whole("Hospital & Surgical, 10% co-insurance, up to S$1,000,000 per year", 1000000);
    whole("Death Benefit: 101% of premiums paid or Sum Assured of S$200,000, whichever is higher", 200000); whole("Return of Premium Benefit S$12,000", 12000);
    whole("Car Rental Excess Cover £2,000", 2000); whole("Premium ward hospital cash S$300/day", 300); whole("Death\tS$500,000", 500000);
  });
  t("a reader leaves a non-sum line out, withholds a doubtful figure, and passes a sum through unchanged", () => {
    assert.equal(asBenefitLine({ amount: "1200.00" }, "Term Life Premium S$1,200"), null);
    assert.deepEqual(asBenefitLine({ id: "a", amount: "3000" }, "Waiver of premium benefit S$3,000"), { id: "a", amount: null });
    assert.deepEqual(asBenefitLine({ id: "b", amount: 500000 }, "Death benefit S$500,000"), { id: "b", amount: 500000 });
    assert.deepEqual(asBenefitLine({ id: "c", amount: null }, "Premium S$100"), { id: "c", amount: null }, "a line with no amount has no figure to judge");
  });
  t("anything doubtful is never dropped: a figure on its own after a comma, a figure not printed, no label (nothing is removed on a guess)", () => {
    sum("Hospital & Surgical, 10% co-insurance, up to S$1,000,000 per year", 1000000);
    sum("Annual premium S$1,200", 999); assert.equal(lineLabel("Annual premium S$1,200", 999), "", "a stored figure the line does not print gives no label");
    sum("", 1000); sum("S$1,000", 1000);
  });
  t("every reader of stored schedule lines leaves such a line out", () => {
    for (const f of ["lib/coverage/facts.ts", "app/api/dashboard/route.ts", "app/api/coverage/route.ts", "lib/rag/chat.ts"])
      assert.match(readFileSync(f, "utf8"), /asBenefitLine\(/, f + " applies the rule");
  });
  t("no request left this machine", () => assert.equal(fetches, 0));

  console.log(`\nbenefit sum line: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
