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
test("L2 it says what happens when a document shows only a dollar sign, in plain words", () => { assert.match(line, /If it shows only \\u201c\$\\u201d, DearPolicy reads it in the currency you choose when you sign up\.$/); });
test("L3 no jargon: the word 'bare' and the claim 'never guessed' are gone from the landing page", () => { assert.doesNotMatch(landing, /\bbare\b/i); assert.doesNotMatch(landing, /never guessed/i); });

const reset = readFileSync("app/reset-password/page.tsx", "utf8");
const intro = /<p className="lead">(Enter the email[^<]*)<\/p>\s*<form/.exec(reset)?.[1] ?? "";
test("L4 the reset page tells a worried person what happens next, before the button, without saying whether the email has an account", () => {
  assert.match(intro, /^Enter the email you signed up with\. If it has an account, we will send a link to choose a new password\./);
  assert.doesNotMatch(intro, /\b(no account|not registered|does not exist)\b/i);
});
test("L5 it asks for the same browser, matching the 'opened in a different browser' error the page can show", () => {
  assert.match(intro, /Open that link in this same browser\.$/);
  assert.match(reset, /opened in a different browser/);
});

test("L6 a refused or failed request keeps the form and says no link was sent; only a successful response shows the 'sent' line", () => {
  assert.match(reset, /if \(res\.ok\) setSent\(true\);/);
  assert.match(reset, /res\.status === 429 \? SEND_PROBLEMS\.tooMany : SEND_PROBLEMS\.failed/);
  assert.match(reset, /\} catch \{\s*setProblem\(SEND_PROBLEMS\.failed\);/);
  assert.doesNotMatch(reset, /finally \{[^}]*setSent\(true\)/);
  assert.match(reset, /nothing has been sent/);
});
test("L7 the failure lines never say whether an email has an account", () => {
  const block = /const SEND_PROBLEMS = \{[^}]*\};/.exec(reset)?.[0] ?? "";
  assert.ok(block.length > 0);
  assert.doesNotMatch(block, /\b(no account|not registered|does not exist|unknown email)\b/i);
});

console.log(`landing copy: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
