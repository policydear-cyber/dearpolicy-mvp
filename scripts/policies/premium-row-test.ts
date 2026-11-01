/** The line under each premium (lib/format/premium-source.ts premiumRowDetail) is the same on Home and Payments: where
 * it was read, the insurer, a shared payment, any detail. Never a placeholder such as "Insurer" when none is known.
 * Made-up insurers in several markets; pure.
 *   node --import tsx scripts/policies/premium-row-test.ts */
import assert from "node:assert/strict";
import { premiumRowDetail } from "@/lib/format/premium-source";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

test("a premium read off the policy schedule says so, then its insurer", () =>
  assert.equal(premiumRowDetail({ source: "policy_schedule", insurer: "Selangor Takaful Berhad" }), "From the policy schedule · Selangor Takaful Berhad"));
test("a premium from a receipt or statement is a payment record", () =>
  assert.equal(premiumRowDetail({ source: "payment_record", insurer: "Thames Mutual", shared: true }), "From a payment record · Thames Mutual · shared/family payment"));
test("an unknown or unexpected source says the neutral words", () => {
  assert.equal(premiumRowDetail({ source: null, insurer: "Wattle Mutual" }), "From your documents · Wattle Mutual");
  assert.equal(premiumRowDetail({ source: "toString", insurer: null }), "From your documents");
});
test("no insurer known: nothing stands in for it", () =>
  assert.equal(premiumRowDetail({ source: "policy_schedule", insurer: null, detail: "S$120.00 of it from MediSave" }), "From the policy schedule · S$120.00 of it from MediSave"));

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`premium row: ${passed} passed`);
