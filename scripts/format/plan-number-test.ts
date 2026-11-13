/**
 * A plan's own number before a currency code and its figure is the plan's name, never money ("Plan 3 SGD 100,000" is
 * SGD 100,000 under plan 3, never SGD 3; #449 report, 13 Nov). Allow-list of plan words; a short number (1-2 digits);
 * a code and a figure must follow, with only spaces or tabs between them, and that figure must not carry its own code
 * ("class 80 SGD 150 SGD" is two amounts) or
 * a percent (main's reading stands; claim-amounts-test). A number glued to a letter ("B1 SGD 300") is a label too. Everything else reads as main.
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
  // Critic and TE round 1: a full stop ends the figure; wider plan words; "#", "-", plurals; a letter-glued number.
  ["Plan 3 SGD 100,000.", [100000]], ["Plan 3 SGD 1,000.50.", [1000.5]], ["Plans 3 SGD 100,000", [100000]], ["Plan #3 SGD 100,000", [100000]],
  ["Plan - 3 SGD 100,000", [100000]], ["Plan\t3 SGD 100,000", [100000]], ["Plan C3 SGD 100,000", [100000]], ["Ward class B1 SGD 300", [300]],
  ["Section 2 SGD 5,000", [5000]], ["Schedule 1 USD 50,000", [50000]], ["Variant 4 SGD 2,000", [2000]],
] as [string, number[]][]) both(line, want);
// Negative controls: main's reading stands.
for (const [line, want] of [
  ["Hospital cash 50 SGD 365", [50]], ["Room 300 SGD 1,000", [300]], ["1,000 SGD 12 mths", [1000]], ["Total 1,500 USD 2026", [1500]],
  ["Plan 3 USD 50 percent", [3]], ["Planned 3 SGD 100", [3]], ["Option 2 SGD", [2]], ["Plan 300 SGD 1,000", [300]],
  ["Plan B SGD 3,000", [3000]], ["Explain 3 SGD 100", [3]],
  // Critic and TE round 1 on #456: the figure after the code carries its own code, so both are amounts.
  ["Daily cash by ward class 80 SGD 150 SGD", [80, 150]], ["Deductible per level 50 SGD; 100 SGD for level 2", [50, 100]],
  ["Copay per class 20 SGD (30 SGD for class B)", [20, 30]], ["Each tier 25 USD: 40 USD in tier 2", [25, 40]],
  // Critic round 2: words that name a thing carrying an amount are not plan labels, and a counted unit after the
  // second figure means the first is the amount.
  ["Hospital cash benefit 50 SGD 365", [50]], ["Hospital Cash Benefit 50 SGD 30 days", [50]], ["Max benefit 90 SGD 1,000", [90]],
  ["Room 50 SGD 100", [50]], ["Ward 80 SGD 150", [80]], ["Cover 20 USD 5", [20]], ["Rider 20 SGD 5", [20]], ["Unit 10 SGD 25", [10]],
  ["Items 5 USD 20", [5]], ["Class 30 SGD 300 per day", [30]], ["Level 50 SGD 30 days", [50]],
  // Known limit kept from main: a ":" or "(" between the code and its figure is not read past.
  ["Plan 3 SGD: 100,000", [3]], ["Plan 3 SGD (100,000)", [3]],
] as [string, number[]][]) both(line, want);
console.log(`plan-number: ${passed} passed`);
