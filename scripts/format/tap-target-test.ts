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
const coverage = readFileSync("components/benefit-table-coverage.tsx", "utf8");
const plans = readFileSync("components/plan-cards.css", "utf8");
const learn = readFileSync("components/learn/learn.css", "utf8");

test("T1 Coverage person tabs are 44px", () => { assert.match(rule(globals, ".cov-people a"), /min-height: 44px/); });
test("T2 Coverage 'All N benefits' rows are 44px", () => { assert.match(rule(globals, ".cov-all summary"), /min-height: 44px/); });
test("T3 the 'parts not in this summary' row is 44px and keeps its disclosure arrow", () => { const r = rule(globals, ".cov-unplaced summary"); assert.match(r, /min-height: 44px/); assert.doesNotMatch(r, /display: *(flex|grid)/, "a flex summary loses its arrow"); assert.doesNotMatch(r, /list-style/, "list-style removes the arrow"); });
test("T6 the Coverage person tabs are one scrolling row at every width, so the sticky bar stays 60px and the scroll margin clears it", () => {
  const bar = rule(globals, ".cov-people");
  assert.match(bar, /flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none/);
  assert.match(bar, /padding: 8px 4px; scroll-padding-inline: 4px/);
  assert.match(globals, /\n\.cov-people a \{ flex: none; white-space: nowrap; \}/);
  assert.doesNotMatch(rule(globals, ".cov-people"), /flex-wrap: wrap/);
  assert.match(rule(globals, ".cov-person"), /scroll-margin-top: 64px/);
});
test("T4 Learn shelf chips are 44px", () => { assert.match(rule(learn, ".learn-shelf-nav a"), /min-height: 44px/); });
test("T5 the Yearly/Monthly toggle is 44px", () => { assert.match(rule(plans, ".plan-interval button"), /min-height: 44px/); });

test("T7 a person tab that takes keyboard focus is scrolled fully into view", () => {
  assert.match(coverage, /<a key=\{p\.id\} href=\{`#person-\$\{p\.id\}`\} onFocus=\{e=>e\.currentTarget\.scrollIntoView\(\{inline:"nearest",block:"nearest"\}\)\}>/);
});

const login = readFileSync("app/login/page.tsx", "utf8");
const signup = readFileSync("app/signup/SignupForm.tsx", "utf8");
test("T8 the Sign in and Sign up text links (Forgot your password, Create an account, Sign in) are 44px: the Live tester measured them at 19px", () => {
  assert.match(rule(globals, ".auth-links a"), /display: inline-flex; align-items: center; min-height: 44px/);
  assert.match(login, /<p className="auth-links"[^>]*>\s*<Link href="\/reset-password">Forgot your password\?<\/Link>/);
  assert.match(login, /<p className="auth-links">\s*New here\? <Link[^>]*>Create an account<\/Link>/);
  assert.match(signup, /<p className="auth-links"[^>]*>\s*Already have an account\? <Link[^>]*>Sign in<\/Link>/);
  assert.match(readFileSync("app/reset-password/page.tsx", "utf8"), /<p className="auth-links"[^>]*>\s*<Link href="\/login">Back to sign in<\/Link>/);
  assert.match(readFileSync("app/confirm/page.tsx", "utf8"), /<p className="auth-links"[^>]*>\s*<Link href="\/login">Go to sign in<\/Link>/);
});
test("T9 the footer links (Learn the basics, Sign in, Create an account) are 44px: the Live tester measured Sign in and Create an account at 41px", () => {
  const css = readFileSync("components/public/public-site.css", "utf8");
  assert.match(rule(css, ".public-footer-links a"), /display: inline-flex; align-items: center; min-height: 44px/);
  assert.match(rule(css, ".public-footer-links"), /display: flex; flex-wrap: wrap; align-items: center/);
});

console.log(`tap targets: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
