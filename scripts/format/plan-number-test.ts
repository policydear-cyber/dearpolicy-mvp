/**
 * A plan's own number before a currency code and its figure is the plan's name, never money ("Plan 3 SGD 100,000" is
 * SGD 100,000 under plan 3, never SGD 3; #449 report, 13 Nov). Allow-list of plan words; a short number (1-2 digits);
 * a code and a figure must follow, and a percent after that figure leaves main's reading. Everything else reads as main.
 */
import assert from "node:assert/strict";
import { anyMoneyFigures } from "@/lib/format/currency";
import { moneyFiguresIn } from "@/lib/chat/answer-verification";

let passed = 0;
const both = (line: string, want: number[]) => {
  assert.deepEqual(anyMoneyFigures(line).map((f) => f.value), want, `anyMoneyFigures: ${line}`);
  assert.deepEqual(moneyFiguresIn(line).map((f) => f.value), want, `moneyFiguresIn: ${line}`);
  passed++;
};
// The fix, across plan words, currencies, case and layouts.
for (const [line, want] of [
  ["Plan 3 SGD 100,000", [100000]], ["PLAN 1 USD 50,000", [50000]], ["Tier 2 MYR 1,500.50", [1500.5]], ["Option 4 EUR 20,000", [20000]],
  ["Class 12 SGD 400 a day", [400]], ["Level 2 GBP 3,000", [3000]], ["Grade 1 HKD 80,000", [80000]], ["Category 3 AUD 9,000", [9000]],
  ["Type 2 SGD 250", [250]], ["Package 5 USD 1,000", [1000]], ["Band 1 SGD 750", [750]], ["Plan 3\tSGD 100,000", [100000]],
  ["Plan 3: SGD 100,000", [100000]], ["Plan 3 SGD 100,000 Plan 4 SGD 200,000", [100000, 200000]], ["Plan 3 SGD 100000", [100000]],
] as [string, number[]][]) both(line, want);
// Negative controls: main's reading stands.
for (const [line, want] of [
  ["Hospital cash 50 SGD 365", [50]], ["Room 300 SGD 1,000", [300]], ["1,000 SGD 12 mths", [1000]], ["Total 1,500 USD 2026", [1500]],
  ["Plan 3 USD 50 percent", [3]], ["Planned 3 SGD 100", [3]], ["Option 2 SGD", [2]], ["Plan 300 SGD 1,000", [300]],
  ["Plan B SGD 3,000", [3000]], ["Explain 3 SGD 100", [3]],
] as [string, number[]][]) both(line, want);
console.log(`plan-number: ${passed} passed`);
