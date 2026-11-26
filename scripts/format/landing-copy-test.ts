/** Scripted test: the landing page's currency line says what happens to a bare "$" in plain words (docs/copy.md: no
 * "bare"; the Live tester flagged it as jargon on 26 Nov) and matches the sign-up page's own hint, and the line never
 * promises more than the app does (the household's currency applies only where a document prints none). Source check.
 *   npm run -s format:landing-copy-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const landing = readFileSync("app/welcome/page.tsx", "utf8");
const line = /text: "(Amounts keep the currency[^"]*)"/.exec(landing)?.[1] ?? "";

test("L1 the currency line exists and keeps what the document prints", () => { assert.match(line, /^Amounts keep the currency your document prints\./); });
test("L2 it says what happens when a document shows only a dollar sign, in plain words", () => { assert.match(line, /If it shows only \\u201c\$\\u201d, DearPolicy uses the currency you choose when you sign up\.$/); });
test("L3 no jargon: the word 'bare' and the claim 'never guessed' are gone from the landing page", () => { assert.doesNotMatch(landing, /\bbare\b/i); assert.doesNotMatch(landing, /never guessed/i); });

console.log(`landing copy: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
