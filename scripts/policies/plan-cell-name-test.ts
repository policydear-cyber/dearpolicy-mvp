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
  const has = { householdFigure: true };
  assert.equal(nameWithoutPlanCell("Reinstatement fees for frequent flyer miles Not Applicable", "Reinstatement fees for frequent flyer miles Not Applicable S$1,000 S$1,500", has),
    "Reinstatement fees for frequent flyer miles");
  assert.equal(nameWithoutPlanCell("Golf equipment N/A", "Golf equipment N/A\tS$500\tS$800", has), "Golf equipment");
  assert.equal(nameWithoutPlanCell("Kos rawatan Tidak dilindungi", "Kos rawatan Tidak dilindungi RM300 RM500", has), "Kos rawatan");
  for (const [name, quote] of [
    // The cell is the name's own words, the quote says something else, the cell is not the first of the run, two runs, none.
    ["Pre-existing conditions Not covered", "Pre-existing conditions Not covered under this policy"],
    ["Golf equipment N/A", "Golf equipment S$500 N/A S$800"], ["Golf equipment N/A", "Golf equipment N/A S$500 S$800 Family N/A S$1,000 S$1,600"],
    ["Golf equipment N/A", null], ["Not covered", "Not covered S$500 S$1,000"], ["Golf equipment", "Golf equipment N/A S$500 S$800"],
    ["Golf equipment N/A", "Other words N/A S$500 S$800"],
    // A row of empty cells only reads as covered without its cell (TE pr204 K1/K2).
    ["Cosmetic surgery Excluded", "Cosmetic surgery Excluded Excluded Excluded"], ["Dental treatment Not covered", "Dental treatment Not covered Not covered"],
  ] as [string, string | null][]) assert.equal(nameWithoutPlanCell(name, quote, has), name, String(quote));
  // With no figure of the household's own plan (their plan's cell may be the empty one), the stored name is shown (Critic R394 M2).
  assert.equal(nameWithoutPlanCell("Golf equipment N/A", "Golf equipment N/A\tS$500\tS$800", { householdFigure: false }), "Golf equipment N/A");
});

test("the Benefits route shows the trimmed name only beside the household's plan figure, and a save of the shown name keeps the stored one", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/benefits/route.ts", "utf8");
  assert.match(route, /benefitName:nameWithoutPlanCell\(row\.benefit_name,row\.quote,\{householdFigure:planFigure!=null\}\)/);
  assert.match(route, /SELECT id,benefit_name,quote FROM policy_benefits WHERE id=\$1 AND account_id=\$2/);
  assert.match(route, /if\(body\.benefitName!=null&&shownName!==stored&&\(even\(body\.benefitName\)===even\(shownName\)\|\|sentName\(body\.benefitName,shownName\)===undefined\)\)body\.benefitName=undefined;/);
});
