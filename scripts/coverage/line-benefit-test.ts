/** A confirmed line's benefit name decides which cover it pays on, not its product's name (live check, PR 542: Singlife
 * Comprehensive Critical Illness II's confirmed "Death Benefit" S$5,000 showed "amount not confirmed" on Death).
 *   node --import tsx scripts/coverage/line-benefit-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { lineBenefit } from "@/lib/coverage/line-benefit";
import { lumpSumParts } from "@/lib/coverage/table-figures";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

test("the benefit is read only from '<product> · <benefit>' notes", () => {
  assert.equal(lineBenefit("Acme Critical Illness Plan · Death Benefit", "Acme Critical Illness Plan"), "Death Benefit");
  assert.equal(lineBenefit("ACME CRITICAL ILLNESS PLAN ·  Death  Benefit ", "Acme Critical Illness Plan"), "Death Benefit");
  assert.equal(lineBenefit("Death Benefit", "Acme Critical Illness Plan"), null);
  assert.equal(lineBenefit("Other Plan · Death Benefit", "Acme Critical Illness Plan"), null);
  assert.equal(lineBenefit("Acme Critical Illness Plan · ", "Acme Critical Illness Plan"), null);
  assert.equal(lineBenefit(null, "Acme Critical Illness Plan"), null);
  assert.equal(lineBenefit("Acme · Death Benefit", null), null);
});
const line = (name: string, benefit: string | null, amount: number) => ({ name, benefit, amount, currency: "SGD", documentIds: [`doc-${name}`] });
test("a critical illness plan's confirmed death benefit keeps its amount on Death", () => {
  const { parts } = lumpSumParts([], [line("Acme Critical Illness Plan", "Death Benefit", 5000)], [], "Death");
  assert.equal(parts[0].amount, 5000); assert.equal(parts[0].otherTile, undefined);
});
test("a death-tile line whose benefit pays on another cover still shows no amount there", () => {
  const { parts } = lumpSumParts([], [line("Acme Life Plan", "Accidental Death Benefit", 50000)], [], "Death");
  assert.equal(parts[0].amount, null); assert.equal(parts[0].otherTile, true);
  const ci = lumpSumParts([], [line("Acme Life Plan", "Critical Illness Benefit", 50000)], [], "Death");
  assert.equal(ci.parts[0].amount, null);
});
test("with no benefit kept, the product's name is judged as before", () => {
  const { parts } = lumpSumParts([], [line("Acme Critical Illness Plan", null, 5000)], [], "Death");
  assert.equal(parts[0].amount, null); assert.equal(parts[0].otherTile, true);
  const gtl = lumpSumParts([], [line("Group Term Life", null, 1000000)], [], "Death");
  assert.equal(gtl.parts[0].amount, 1000000);
});

console.log(`line-benefit: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(`  FAIL ${f}`); process.exit(1); }
