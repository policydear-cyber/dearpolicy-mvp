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
  const { notABenefitSum, lineLabel } = await import("@/lib/coverage/benefit-sum-line");
  const not = (evidenceText: string, amount: number) => assert.equal(notABenefitSum({ evidenceText, amount }), true, `«${evidenceText}» ${amount} is no benefit sum`);
  const sum = (evidenceText: string, amount: number) => assert.equal(notABenefitSum({ evidenceText, amount }), false, `«${evidenceText}» ${amount} is a benefit sum`);

  t("premiums and contributions are never a sum (A$, S$, RM, Rp, £, €, Chinese)", () => {
    not("Life Cover Premium\tA$1,200", 1200); not("Term Life Premium S$1,204.50 yearly", 1204.5); not("Annual premium: RM2,400", 2400);
    not("Premi tahunan Rp4.800.000", 4800000); not("Monthly premium £18.40", 18.4); not("Prime annuelle 1 250,00 €", 1250);
    not("Jahresprämie €980", 980); not("年度保费 HK$12,000", 12000); not("Takaful contribution RM1,800 a year", 1800); not("Caruman bulanan RM150", 150);
    not("Return of Premium S$20,000", 20000);
  });
  t("a waiver of premium is never the cover it waives for", () => {
    not("TPD Premium Waiver\tS$3,000", 3000); not("Waiver of Premium (Critical Illness) S$2,400", 2400); not("Payor Waiver Benefit RM1,200", 1200);
  });
  t("a value the policy holds is never a sum it pays on a claim", () => {
    not("Life Insurance Fund Value\tRM45,000", 45000); not("Guaranteed Cash Value at year 10: S$12,340", 12340); not("Surrender value £8,200", 8200);
    not("Nilai tunai Rp25.000.000", 25000000); not("Valeur de rachat 15 000 €", 15000); not("Rückkaufswert €7.500", 7500); not("现金价值 HK$30,000", 30000);
    not("Account value as at 31 Dec: S$56,789.10", 56789.1);
  });
  t("a loan, a fee or a tax on the policy, and the person's own share of a bill, are never a sum", () => {
    not("Policy loan outstanding S$4,000", 4000); not("Policy fee S$50", 50); not("Stamp duty RM10", 10); not("GST S$72", 72);
    not("Deductible S$3,500 per policy year", 3500); not("Excess £250 each claim", 250); not("Co-insurance 10%, capped at S$3,000", 3000); not("Selbstbehalt €150", 150);
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
  t("a line with no printed label is left as it is (nothing is removed on a guess)", () => {
    sum("", 1000); sum("S$1,000", 1000);
  });
  t("every reader of stored schedule lines leaves such a line out", () => {
    for (const f of ["lib/coverage/facts.ts", "app/api/dashboard/route.ts", "app/api/coverage/route.ts", "lib/rag/chat.ts"])
      assert.match(readFileSync(f, "utf8"), /notABenefitSum\(/, f + " applies the rule");
  });
  t("no request left this machine", () => assert.equal(fetches, 0));

  console.log(`\nbenefit sum line: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
