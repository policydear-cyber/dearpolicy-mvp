/** "CAD" in a health document is often coronary artery disease, not Canadian dollars (TE #269 F2). A bare "CAD" code is
 * a currency only in capitals, directly beside a figure that reads as money, with no heart or artery words in the same
 * text; a C$ / CA$ sign is always Canadian dollars. Pure: no database, model or network.
 *   npm run format:cad-code-test */
import assert from "node:assert/strict";
import { explicitCurrency } from "@/lib/chat/policy-analysis";
import { statedCurrencyCode } from "@/lib/policies/benefit-rows";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const NOT_MONEY = ["CAD 5 scans covered, 1,500", "CAD 2 screenings a year 1,000", "CAD 1 angiogram 8,000", "CAD screening 2 times, 1,500",
  "Treatment for CAD 3 stents 20,000", "CAD 5", "CAD 5 scans", "CAD 5, scans 1,500", "CAD 8,000 per stent", "CAD 20,000 for coronary artery disease",
  "Cad 1,000", "CAD 4.5%", "CAD 1.5x", "Penyakit jantung koroner (CAD) RM 50,000", "冠心病 CAD 50,000", "Heart bypass for CAD 30,000"];
const MONEY = ["Benefit CAD 1,500", "Sum insured CAD 250,000", "250,000 CAD", "CAD 5.00 per scan", "CAD 1500", "Death benefit CAD 500.000,00"];
const SIGN = ["C$ 1,000 per stent", "CA$250,000 coronary care"];
for (const t of NOT_MONEY) test(`"${t}" is not Canadian dollars`, () => { assert.notEqual(explicitCurrency(t), "CAD"); assert.notEqual(statedCurrencyCode(t), "CAD"); });
for (const t of MONEY) test(`"${t}" is Canadian dollars`, () => { assert.equal(explicitCurrency(t), "CAD"); assert.equal(statedCurrencyCode(t), "CAD"); });
for (const t of SIGN) test(`"${t}" is Canadian dollars by its sign`, () => assert.equal(statedCurrencyCode(t), "CAD"));
// Other codes are unchanged (control).
for (const [t, want] of [["AUD 1,000", "AUD"], ["SGD 5 sessions 900", "SGD"], ["MYR 50,000", "MYR"], ["USD 2,000", "USD"]] as const)
  test(`"${t}" stays ${want}`, () => assert.equal(explicitCurrency(t), want));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log("FAIL", f); process.exit(1); }
