/** Home's top line (components/home-attention.tsx) never says "Nothing needs you right now." above a To-do list that
 * shows something: with To-do items it says nothing is urgent and links to them. Renders the real line; no database,
 * no network.
 *   node --import tsx scripts/format/home-attention-todo-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AllClear } from "@/components/home-attention";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const component = readFileSync("components/home-attention.tsx", "utf8"), page = readFileSync("app/page.tsx", "utf8");

const text = (todo: number) => renderToStaticMarkup(createElement(AllClear, { todo })).replace(/<[^>]+>/g, "");
test("the all-clear line counts Home's To-do before saying nothing needs you", () => {
  assert.equal(text(0), "Nothing needs you right now.");
  assert.equal(text(1), "Nothing urgent. 1 thing to check in your To-do.");
  assert.equal(text(3), "Nothing urgent. 3 things to check in your To-do.");
  assert.match(renderToStaticMarkup(createElement(AllClear, { todo: 2 })), /<a class="text-link" href="#home-todo">/);
  assert.match(component, /data-testid="home-all-clear"><AllClear todo=\{todo\} \/><\/p>/);
  assert.match(component, /export function HomeAttention\(\{ memberId, todo = 0 \}: \{ memberId\?: string; todo\?: number \}\)/);
});
test("Home passes the To-do count it shows, and the link lands on that list", () => {
  assert.match(page, /<HomeAttention memberId=\{active\?\.id\} todo=\{data\?\.reminders\?\.length\?\?0\}\/>/);
  assert.match(page, /<div className="section dashboard-panel" id="home-todo">[^]{0,200}<h2>To-do<\/h2>/);
  assert.match(page, /\{data\?\.reminders\?\.length\?data\.reminders\.map\(/, "the To-do list is the reminders the count comes from");
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`home-attention-todo: ${passed} passed, fetches 0`);
