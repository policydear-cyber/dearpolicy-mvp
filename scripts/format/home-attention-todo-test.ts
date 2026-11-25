/** Home (DC 16 Nov): the person's protection cards come first, with the Ask DearPolicy box beside them, and no To-do list,
 * "since your last visit" line or all-clear line. What needs the household (a document that couldn't be read, a name to
 * confirm, a claim waiting) is listed under the cards only when there is something; otherwise nothing is shown. Reads the
 * real sources; no database, no network. (Was the To-do count test; DC removed Home's To-do list on 16 Nov.)
 *   node --import tsx scripts/format/home-attention-todo-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const component = readFileSync("components/home-attention.tsx", "utf8"), page = readFileSync("app/page.tsx", "utf8");

test("Home has no To-do list, no all-clear line and no last-visit line", () => {
  assert.doesNotMatch(page, /To-do|home-todo|data\?\.reminders/);
  assert.doesNotMatch(component, /AllClear|Nothing needs you|home-since|Since your last visit/);
});
test("the cards come first and the ask box sits beside them, before anything else on Home", () => {
  const top = page.indexOf('<div className="home-top"');
  assert.ok(top > 0, "Home has a top block");
  for (const later of ["unclaimed-panel", "<HomeAttention/>"]) assert.ok(page.indexOf(later) > top, `${later} comes after the cards`);
  const block = page.slice(top, page.indexOf("unclaimed-panel"));
  assert.match(block, /<section className="home-cards"/); assert.match(block, /<HomeAsk memberId=\{active\?\.id\} name=\{name\}\/>/);
});
test("the ask box opens the chat with the question and the person chosen on Home", () => {
  assert.match(component, /export function HomeAsk\(/);
  assert.match(component, /params\.set\("ask", text\.trim\(\)\.slice\(0, 2000\)\)/);
  assert.match(component, /if \(memberId\) params\.set\("member", memberId\)/);
  assert.match(component, /router\.push\(`\/chat\$\{query \? `\?\$\{query\}` : ""\}`\)/);
});
test("on phone an Ask DearPolicy button is always on Home", () => {
  assert.match(page, /className="home-ask-fab button primary" aria-label="Ask DearPolicy"/);
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.home-ask-fab \{ display: none; \}/);
  assert.match(css, /\.home-ask-fab \{[^}]*position: fixed;/);
});
test("what needs the household shows only when there is something", () => {
  assert.match(component, /if \(!loaded \|\| !items\.length\) return null;/);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`home-attention-todo: ${passed} passed, fetches 0`);
