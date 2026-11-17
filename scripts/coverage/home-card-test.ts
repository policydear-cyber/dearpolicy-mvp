/** Home's protection cards (DC 17 Nov "the ui looks weird and empty"): a card with no single confirmed amount names what
 * pays instead of standing empty, never with a summed or unconfirmed figure; the grid's column count keeps the last row
 * from being one card alone where 3 or 4 columns avoid it. Pure functions plus the page source; no database, no network.
 *   node --import tsx scripts/coverage/home-card-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homeCardShowsAmount, homeCardSource, homeGridColumns } from "@/lib/coverage/home-card";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

test("one policy: its name", () => {
  assert.equal(homeCardSource({ policyNames: ["Group Term Life"] }), "Group Term Life");
  assert.equal(homeCardSource({ policyNames: ["  Shield   Plan A "] }), "Shield Plan A");
});
test("two policies: both names; the same name twice (any case) counts once", () => {
  assert.equal(homeCardSource({ policyNames: ["Group Term Life"], parts: [{ name: "Group Term Life" }, { name: "Funeral Benefit" }] }), "Group Term Life + Funeral Benefit");
  assert.equal(homeCardSource({ policyNames: ["Term Life", "TERM LIFE"] }), "Term Life");
});
test("several lines or policies: no total on Home (different schedules are never added without support, 17 Nov)", () => {
  // Two confirmed Death policies S$200,000 + S$100,000: the dashboard's S$300,000 is not shown; the card names both.
  const two = { policyNames: ["Oakridge Term 80", "Oakridge Whole Life"], count: 2 };
  assert.equal(homeCardShowsAmount(two), false); assert.equal(homeCardSource(two), "Oakridge Term 80 + Oakridge Whole Life");
  // One plan paying two Death benefits (S$1,000,000 + S$5,000): no total either, and the card says how many.
  const onePlan = { policyNames: ["Group Term Life"], parts: [{ name: "Group Term Life" }, { name: "Group Term Life" }], count: 2 };
  assert.equal(homeCardShowsAmount(onePlan), false); assert.equal(homeCardSource(onePlan), "Group Term Life \u00b7 2 benefits");
  assert.equal(homeCardSource({ policyNames: [], count: 3 }), "3 benefits");
  // One line: its own confirmed amount is shown.
  assert.equal(homeCardShowsAmount({ count: 1 }), true);
  assert.equal(homeCardShowsAmount({ count: 1, policyNames: ["Term Life", "term  life"] }), true, "the same policy named twice is one");
  // Fails closed (Critic, e57bfdc): one line by count, but two policies named, never shows a figure that may be their sum.
  assert.equal(homeCardShowsAmount({ count: 1, policyNames: ["A Plan", "B Plan"] }), false);
  assert.equal(homeCardShowsAmount({ count: 0 }), true, "a derived cover with no line has no amount to sum");
});
test("three or more: a count, never a list that overflows the card", () => {
  assert.equal(homeCardSource({ policyNames: ["A Plan", "B Plan", "C Plan"] }), "3 policies");
});
test("nothing named, or only the dashboard's 'Policy' stand-in: no line, never an invented name", () => {
  assert.equal(homeCardSource({ policyNames: [] }), null);
  assert.equal(homeCardSource({ policyNames: null, parts: [{ name: "Policy" }] }), null);
  assert.equal(homeCardSource({ policyNames: null, parts: [{ name: "Policy" }, { name: null }] }), "2 benefits", "unnamed, but how many is still said");
  assert.equal(homeCardSource({ policyNames: ["Owned policy"] }), null);
});
test("the source line never carries an amount: only names go in", () => {
  // A policy name that happens to hold a figure is shown as the name it is; no amount is ever built here.
  assert.equal(homeCardSource({ policyNames: ["Plan 500"] }), "Plan 500");
  const input = readFileSync("lib/coverage/home-card.ts", "utf8").match(/export type HomeCardInput = [^;]+;/)?.[0] ?? "";
  assert.ok(input, "the input type is declared"); assert.doesNotMatch(input, /amount|total|currency/);
});
test("columns: the last row is never one card alone where 3 or 4 columns avoid it", () => {
  for (let n = 4; n <= 24; n++) {
    const cols = homeGridColumns(n); assert.ok(cols === 3 || cols === 4, `n=${n} cols=${cols}`);
    const last = n % cols || cols;
    const avoidable = [3, 4].some((c) => (n % c || c) > 1);
    if (avoidable) assert.ok(last > 1, `n=${n}: ${cols} columns leaves one card alone`);
  }
  assert.equal(homeGridColumns(7), 4); assert.equal(homeGridColumns(6), 3); assert.equal(homeGridColumns(8), 4); assert.equal(homeGridColumns(9), 3);
  for (const n of [0, 1, 2, 3]) assert.equal(homeGridColumns(n), 3, "a few cards keep card size");
});
test("the page shows the amount only when there is one, names the source, and sets the columns", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /const amount=!homeCardShowsAmount\(c\)\?null:c\.amount!=null\?money\(c\.amount,c\.currency\):c\.displayAmount;const source=homeCardSource\(c\);/);
  assert.match(page, /\{source&&<span className="coverage-source" title=\{source\}>\{source\}<\/span>\}/);
  assert.match(page, /\{amount&&<span className="coverage-amount">\{amount\}<\/span>\}/);
  assert.match(page, /data-cols=\{homeGridColumns\(covered\.length\)\}/);
  const css = readFileSync("app/globals.css", "utf8");
  // Columns follow the width the cards get, not the screen (Test engineer #519 F2): 2 until 3 or 4 fit card-sized.
  assert.match(css, /\.home-cards \{ container-type: inline-size; \}/);
  assert.match(css, /@container \(min-width: 820px\) \{\s*\.home-cards \.coverage-grid\[data-cols="4"\] \{ grid-template-columns: repeat\(4,/);
  assert.match(css, /@container \(min-width: 600px\) \{\s*\.home-cards \.coverage-grid\[data-cols="3"\] \{ grid-template-columns: repeat\(3,/);
  assert.doesNotMatch(css.slice(css.indexOf("Home cards are compact sheets"), css.indexOf("Gaps to consider (DC 17 Nov)")), /overflow-wrap: anywhere/, "a cover name never breaks mid-word");
  assert.match(css, /\.home-cards \.coverage-grid > :last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`home-card: ${passed} passed, fetches 0`);
