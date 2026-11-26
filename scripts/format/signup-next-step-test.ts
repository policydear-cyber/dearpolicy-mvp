/** Scripted test: the sign-up form says what happens after "Create account" (Live tester, 26 Nov: a newcomer could not tell whether an
 * email check or the upload comes next). Source checks on app/signup/SignupForm.tsx. No model, network or database.
 *   npm run -s format:signup-next-step-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const form = readFileSync("app/signup/SignupForm.tsx", "utf8");

test("N1 once the form is ready, a line says what comes next, and it is true whether or not an email check is needed", () => {
  assert.match(form, /!busy && !inviteNext \? <p id="su-ready-hint" className="field-hint" data-testid="signup-next-step">Next: you may need to open a link we email you\. Then add your family and upload your first policy\.<\/p>/);
});
test("N2 the missing-email and missing-currency hints still come first", () => {
  assert.ok(form.indexOf("Enter your email to continue.") < form.indexOf("Choose your policy currency to continue."));
  assert.ok(form.indexOf("Choose your policy currency to continue.") < form.indexOf('data-testid="signup-next-step"'));
});
test("N3 someone joining by invitation is not told to upload their own first policy", () => {
  assert.match(form, /!inviteNext \? <p id="su-ready-hint"/);
});
test("N4 the check-your-email notice says what to do after the link", () => {
  assert.match(form, /Open the link we sent to finish creating your account\. Then add your family and upload your first policy\./);
});

console.log(`signup next step: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
