/** Scripted test: when Home could not load, it says so once and shows nothing else about the household: no "no cover card / no
 * document on file" card and no ask box (Live tester, 26 Nov: with the API failing, Home said both "couldn't load your family's
 * cover" and "No document for this person is on file yet. Upload a policy", so a household might upload documents that are safe).
 * Source checks on app/page.tsx. No model, network or database.
 *   npm run -s format:home-load-error-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const page = readFileSync("app/page.tsx", "utf8");

test("E1 the error alert is shown, and says the documents are safe", () => {
  assert.match(page, /data\?\.error&&<div className="alert error" role="alert"><strong>DearPolicy couldn&rsquo;t load your family&rsquo;s cover just now\.<\/strong><small>Your documents are safe\./);
});
test("E2 on a failed load the cards area shows nothing (no 'no cover card' or 'no policy document on file' card)", () => {
  assert.match(page, /Loading…<\/div>:data\?\.error\?null:personEmpty\?/);
});
test("E3 on a failed load the ask box and the Ask button are not offered", () => {
  assert.match(page, /\{!data\?\.error&&<HomeAsk memberId=/);
  assert.match(page, /\{!emptyPortfolio&&!data\?\.error&&<Link href=\{`\/chat/);
});
test("E4 a loaded Home still shows the cards, the ask box and the Ask button", () => {
  assert.match(page, /personEmpty\?<PersonNothingYet name=/);
  assert.match(page, /data-testid="home-no-cards"/);
  assert.doesNotMatch(page, /\{!data\?\.error&&!data\?\.error/);
});

console.log(`home load error: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
