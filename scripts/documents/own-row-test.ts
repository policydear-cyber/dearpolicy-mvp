/** A schedule line printed as a row of its own (a name in the left cell, an amount in the right one) is its own benefit,
 * never the rest of the row above (TE real-model run, 4 Nov: "Intensive care | RM 600 per day" swallowed "Surgical fees |
 * As charged, up to RM 30,000", so Benefits had no surgical row and the ICU row quoted the surgical cap). A row that stops
 * mid-phrase still takes the line below. Made-up English schedules in several currencies; no database, no model.
 *   npm run -s documents:own-row-test */
import assert from "node:assert/strict";
import { benefitRowsFromText } from "@/lib/documents/layout";
import { rowKind } from "@/lib/policies/catalog-builder";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const rows = (text: string) => benefitRowsFromText(text).map((r) => [r.label, r.value] as const);

const MARKETS = [["RM", "Harbour Assurance"], ["S$", "Kestrel Life"], ["£", "Alder Mutual"], ["HK$", "Lotus General"], ["A$", "Wattle Health"]] as const;
for (const [c, insurer] of MARKETS) {
  test(`${c}: a per-day row and the as-charged row below it stay two rows`, () => {
    const got = rows(`${insurer}\nPOLICY SCHEDULE\nPlan: Example Hospital Plan\n\nRoom and board\t${c} 250 per day, up to 120 days\nIntensive care\t${c} 600 per day\nSurgical fees\tAs charged, up to ${c} 30,000\nAnnual limit\t${c} 150,000`);
    assert.deepEqual(got, [["Room and board", `${c} 250 per day, up to 120 days`], ["Intensive care", `${c} 600 per day`], ["Surgical fees", `As charged, up to ${c} 30,000`], ["Annual limit", `${c} 150,000`]]);
  });
  test(`${c}: a lump-sum row never takes the next benefit's amount`, () => {
    const got = rows(`POLICY SCHEDULE\n\nDeath benefit\t${c}200,000\nAmbulance fees\tAs charged, up to ${c}1,000\nOutpatient\tUp to ${c}500 per visit`);
    assert.deepEqual(got.map(([l]) => l), ["Death benefit", "Ambulance fees", "Outpatient"]);
    assert.equal(got[0][1], `${c}200,000`);
  });
  test(`${c}: an as-charged row with its cap is stored as as charged, never as a fixed sum`, () => {
    assert.equal(rowKind("Surgical fees", `As charged, up to ${c} 30,000`), "as_charged");
  });
}
test("a row whose amount stops mid-phrase still takes the rest from the line below", () => {
  const got = rows("POLICY SCHEDULE\n\nRoom and board\tS$250 per day\nHearing Loss in\t15% of the Sum Insured, up to\nOne Ear\tof S$10,000\nAnnual limit\tS$150,000");
  assert.ok(got.some(([, v]) => /15% of the Sum Insured, up to of S\$10,000|15% of the Sum Insured, up to S\$10,000|15% of the Sum Insured, up to\s+of S\$10,000/.test(v)), JSON.stringify(got));
});
console.log(`own row: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
