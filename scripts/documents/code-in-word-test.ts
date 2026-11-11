/**
 * A currency code is never the end of a word. "rm" in "Term", "Form", "Firm" or "Permanent" is not ringgit, "AUD" in
 * "FRAUD" is not Australian dollars, and "ERM" in "TERM" is no three-letter code. Made-up text only.
 * Run: node --import tsx scripts/documents/code-in-word-test.ts
 */
import { moneyPrinted, dailyRatePrinted } from "@/lib/documents/fact-check";
import { amountAppears } from "@/lib/documents/evidence";
import { figuresDifferByPlan } from "@/lib/insurance/scale-limit";
import { amountOnlyInContext } from "@/lib/documents/own-figure";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
function eq<T>(got: T, want: T, what: string) { if (got !== want) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }

test("W1 a word ending in a code's letters is no currency: a count of years is not money", () => {
  eq(moneyPrinted("Policy Term\t20 years", 20), false, "Policy Term 20");
  eq(moneyPrinted("POLICY TERM 25", 25), false, "POLICY TERM 25");
  eq(moneyPrinted("Claim Form 2", 2), false, "Claim Form 2");
  eq(moneyPrinted("Medical Firm 3", 3), false, "Medical Firm 3");
  eq(moneyPrinted("Exclusion: fraud 10", 10), false, "fraud 10 (aud)");
  eq(moneyPrinted("Total and Permanent Disability\t100,000", 100000), false, "a bare figure on a line whose only 'currency' is the rm in Permanent");
});
test("W2 a code standing on its own, or touching its figure, is still money", () => {
  eq(moneyPrinted("Sum Assured RM 100,000", 100000), true, "RM 100,000");
  eq(moneyPrinted("Sum Assured RM100,000", 100000), true, "RM100,000");
  eq(moneyPrinted("Basic sum assured: SGD 250,000", 250000), true, "SGD 250,000");
  eq(moneyPrinted("Total and Permanent Disability\tS$100,000", 100000), true, "S$ beside Permanent");
  eq(moneyPrinted("Limit (MYR)\t5,000", 5000), true, "a code in a heading on the line");
  eq(moneyPrinted("Death benefit AUD 300,000", 300000), true, "AUD 300,000");
  eq(moneyPrinted("Term cover £50,000", 50000), true, "a sign after Term");
});
test("W3 a daily rate needs a real currency, never the rm of a word", () => {
  eq(dailyRatePrinted("Hospital cash RM 100 per day", 100), true, "RM 100 per day");
  eq(dailyRatePrinted("Hospital cash 100 per day", 100), true, "a bare daily rate stays as before (the sign is optional here)");
});
test("W4 three capital letters ending a word are no code beside a dot-grouped figure", () => {
  eq(amountAppears("POLICY TERM 1.500", 1500, "money"), false, "TERM 1.500");
  eq(amountAppears("Sum insured IDR 1.500.000", 1500000, "money"), true, "IDR 1.500.000");
  eq(amountAppears("Santunan Rp 2.500.000", 2500000, "money"), true, "Rp 2.500.000");
});
test("W5 plan columns: a word's tail is no cell", () => {
  // Before, "RM 10" in "TERM 10" was read as a ringgit cell, so the two S$ plan figures looked like mixed currencies.
  eq(figuresDifferByPlan("POLICY TERM 10 S$500 S$800"), true, "TERM 10 then two plans' figures");
  eq(figuresDifferByPlan("Hospital cash RM100 RM200"), true, "two ringgit plan cells");
});
test("W7 a word ending in rm before a count is no ringgit; a printed S$ figure stays money", () => {
  eq(moneyPrinted("Loss of one arm\t2", 2), false, "arm 2 (a line with no currency of its own)");
  eq(moneyPrinted("Loss of one arm\tS$40,000", 40000), true, "S$40,000");
});
test("W6 own figure: a year count after Term is no money figure in the line", () => {
  eq(amountOnlyInContext("Policy Term 20 years\nSum Assured S$200,000", 200000), null, "the sum is the person's own");
});

for (const f of failures) console.error("FAIL", f);
console.log(`code in word: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
