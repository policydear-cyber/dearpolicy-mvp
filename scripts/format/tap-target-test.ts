/** Scripted test: the controls the Live tester measured at 40px high on a phone (Coverage person tabs and "All N benefits" rows,
 * the "parts not in this summary" row, Learn shelf chips, the Yearly/Monthly toggle) are 44px, the size of a thumb. Source checks on
 * the style sheets. Page links ("p. 5") stay 24px by choice: 759 of them sit in dense rows on Coverage and 24px meets WCAG 2.2.
 *   npm run -s format:tap-target-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const rule = (css: string, selector: string) => {
  const found = css.split("\n").find((line) => line.startsWith(selector + " {"));
  assert.ok(found, `rule ${selector} exists`);
  return found;
};
const globals = readFileSync("app/globals.css", "utf8");
const plans = readFileSync("components/plan-cards.css", "utf8");
const learn = readFileSync("components/learn/learn.css", "utf8");

test("T1 Coverage person tabs are 44px", () => { assert.match(rule(globals, ".cov-people a"), /min-height: 44px/); });
test("T2 Coverage 'All N benefits' rows are 44px", () => { assert.match(rule(globals, ".cov-all summary"), /min-height: 44px/); });
test("T3 the 'parts not in this summary' row is 44px and keeps its disclosure arrow", () => { const r = rule(globals, ".cov-unplaced summary"); assert.match(r, /min-height: 44px/); assert.doesNotMatch(r, /display: *(flex|grid)/, "a flex summary loses its arrow"); assert.doesNotMatch(r, /list-style/, "list-style removes the arrow"); });
test("T6 the Coverage person tabs are one scrolling row at every width, so the sticky bar stays 60px and the scroll margin clears it", () => {
  const bar = rule(globals, ".cov-people");
  assert.match(bar, /flex-wrap: nowrap; overflow-x: auto/);
  assert.match(bar, /padding: 8px 2px; scroll-padding-inline: 2px/);
  assert.match(globals, /\n\.cov-people a \{ flex: none; white-space: nowrap; \}/);
  assert.doesNotMatch(rule(globals, ".cov-people"), /flex-wrap: wrap/);
  assert.match(rule(globals, ".cov-person"), /scroll-margin-top: 64px/);
});
test("T4 Learn shelf chips are 44px", () => { assert.match(rule(learn, ".learn-shelf-nav a"), /min-height: 44px/); });
test("T5 the Yearly/Monthly toggle is 44px", () => { assert.match(rule(plans, ".plan-interval button"), /min-height: 44px/); });

console.log(`tap targets: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
