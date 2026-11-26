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
test("D4 opposite wording is never merged (a negation or exception on one side only)", () => {
  assert.equal(same("The claim must be made within thirty days of the accident date", "The claim must not be made within thirty days of the accident date or later"), false);
  assert.equal(same("Benefit is paid when the Insured Person is employed in Singapore full time", "Benefit is paid unless the Insured Person is employed in Singapore full time"), false);
});
test("D5 a very short condition is never merged", () => {
  assert.equal(same("Must be insured", "The insured person must be insured for at least ninety days"), false);
});
test("D6 the same wording twice is the same condition", () => {
  assert.equal(same("within 12 months of diagnosis by a specialist", "within 12 months of diagnosis by a specialist"), true);
});

console.log(`condition duplicates: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
