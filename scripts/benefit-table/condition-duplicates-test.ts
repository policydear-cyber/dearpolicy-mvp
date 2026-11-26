/** Scripted test: a condition the answer already says in other words is not said again as a line of its own (Live tester, 26 Nov:
 * "What does terminal illness pay?" gave the same condition twice more). The longer wording stays; a different, opposite or
 * shorter-than-four-words condition is never merged. No model, network or database.
 *   npm run -s benefit-table:condition-duplicates-test */
import assert from "node:assert/strict";
import { sameConditionInOtherWords as same } from "@/lib/benefit-table/chat";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const LONG = "provided no other Benefit has been paid to the Insured Person under this Policy or under any supplementary contracts attached to this Policy";
const SHORT = "No other benefit may have been paid under this policy";

test("D1 the live pair is one condition: the shorter says what the longer says", () => {
  assert.equal(same(SHORT, LONG), true);
});
test("D2 it only goes one way: the longer is never dropped for the shorter", () => {
  assert.equal(same(LONG, SHORT), false);
});
test("D3 a different condition is kept", () => {
  assert.equal(same("highly probable to lead to death within the next twelve (12) months", LONG), false);
  assert.equal(same("The Company may at its sole discretion pay an advance payment", LONG), false);
});
test("D4 opposite or different wording is never merged: numbers, direction words, negations", () => {
  const no = (a: string, b: string) => { assert.equal(same(a, b), false, a + " | " + b); assert.equal(same(b, a), false, b + " | " + a); };
  no("Claim within 30 days of discharge from hospital", "Claim within 60 days of discharge from hospital");
  no("Waiting period of 90 days applies to this benefit", "Waiting period of 30 days applies to this benefit");
  no("Cover applies under age 65 at the date of claim", "Cover applies over age 65 at the date of claim");
  no("Admitted before the policy anniversary date shown", "Admitted after the policy anniversary date shown");
  no("Hospital stay of at least 24 hours in a ward", "Hospital stay of at most 24 hours in a ward");
  no("Pays less than the sum insured for each claim", "Pays more than the sum insured for each claim");
  no("Excludes pre-existing conditions from this cover", "Includes pre-existing conditions from this cover");
  no("No other benefit may have been paid under this policy", "Other benefit may have been paid under this policy");
  no("Payable if no other benefit has been paid under the policy", "Payable if other benefit has been paid under the policy");
  no("The claim must be made within thirty days of the accident date", "The claim must not be made within thirty days of the accident date or later");
  no("Benefit is paid when the person is employed in Singapore full time", "Benefit is paid unless the person is employed in Singapore full time");
  no("Benefit is paid when the person is employed in Singapore full time", "Benefit is paid when the person is employed overseas full time");
  // The same words in another order say another thing: who depends on whom, who is paid to whom, which age comes first.
  no("The spouse is covered only if the insured person is covered", "The insured person is covered only if the spouse is covered");
  no("Benefit payable on death of the insured person to the nominee", "Benefit payable on death of the nominee to the insured person");
  no("Employee must be employed by the company and the insured child", "Employee must be employed by the insured child and the company");
  no("Child aged 18 to 21 and in full time education", "Child aged 21 to 18 and in full time education");
});
test("D5 a very short condition is never merged", () => {
  assert.equal(same("Must be insured", "The insured person must be insured for at least ninety days"), false);
});
test("D6 the same wording twice is the same condition", () => {
  assert.equal(same("within 12 months of diagnosis by a specialist", "within 12 months of diagnosis by a specialist"), true);
});

console.log(`condition duplicates: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
