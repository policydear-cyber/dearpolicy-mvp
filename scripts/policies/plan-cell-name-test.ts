/**
 * A plan-table row whose stored name ran into the first plan's empty cell ("Reinstatement fees for frequent flyer miles
 * Not Applicable") is shown without it, beside the household's plan figure. Made-up rows, no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("a plan row's shown name drops the first plan's empty cell the reader ran into it, and nothing else", async () => {
  const { nameWithoutPlanCell } = await import("@/lib/insurance/scale-limit");
  assert.equal(nameWithoutPlanCell("Reinstatement fees for frequent flyer miles Not Applicable", "Reinstatement fees for frequent flyer miles Not Applicable S$1,000 S$1,500"),
    "Reinstatement fees for frequent flyer miles");
  assert.equal(nameWithoutPlanCell("Golf equipment N/A", "Golf equipment N/A\tS$500\tS$800"), "Golf equipment");
  assert.equal(nameWithoutPlanCell("Kos rawatan Tidak dilindungi", "Kos rawatan Tidak dilindungi RM300 RM500"), "Kos rawatan");
  for (const [name, quote] of [
    // The cell is the name's own words, the quote says something else, the cell is not the first of the run, two runs, none.
    ["Pre-existing conditions Not covered", "Pre-existing conditions Not covered under this policy"],
    ["Golf equipment N/A", "Golf equipment S$500 N/A S$800"], ["Golf equipment N/A", "Golf equipment N/A S$500 S$800 Family N/A S$1,000 S$1,600"],
    ["Golf equipment N/A", null], ["Not covered", "Not covered S$500 S$1,000"], ["Golf equipment", "Golf equipment N/A S$500 S$800"],
    ["Golf equipment N/A", "Other words N/A S$500 S$800"],
  ] as [string, string | null][]) assert.equal(nameWithoutPlanCell(name, quote), name, String(quote));
});
