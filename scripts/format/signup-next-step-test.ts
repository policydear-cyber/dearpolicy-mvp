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
  assert.match(form, /!busy && !notice && !inviteNext && emailOk && password\.length >= 8 \? <p id="su-ready-hint" className="field-hint" data-testid="signup-next-step">Next: you may need to open a link we email you\. Then add your family and upload your first policy\.<\/p>/);
});
test("N2 the missing-email and missing-currency hints still come first", () => {
  assert.ok(form.indexOf("Enter your email to continue.") < form.indexOf("Choose your policy currency to continue."));
  assert.ok(form.indexOf("Choose your policy currency to continue.") < form.indexOf('data-testid="signup-next-step"'));
});
test("N3 someone joining by invitation is not told to upload their own first policy", () => {
  assert.match(form, /!inviteNext && emailOk && password\.length >= 8 \? <p id="su-ready-hint"/);
});
test("N4 the check-your-email notice says what follows the link: family and upload, or joining the household for an invited person", () => {
  assert.match(form, /setNotice\(inviteNext \? "Check your email\. Open the link we sent to finish creating your account\. Then you join the household you were invited to\. Not there\? Check your spam folder, or sign up again with the right address\." : "Check your email\. Open the link we sent to finish creating your account\. Then add your family and upload your first policy\. Not there\? Check your spam folder, or sign up again with the right address\."\)/);
});
test("N5 the hint waits for a password the button accepts (8 characters)", () => {
  assert.match(form, /password\.length < 8 \|\| !currency/);
  assert.match(form, /password\.length >= 8 \? <p id="su-ready-hint"/);
});

test("N6 the hint needs an email that looks like one, and goes once the notice is shown", () => {
  assert.match(form, /const emailOk = \/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\/\.test\(email\.trim\(\)\);/);
  assert.match(form, /!busy && !notice && !inviteNext && emailOk/);
});
test("N7 the submit button points at the hint, and the notice is announced", () => {
  assert.match(form, /type="submit"[^>]*aria-describedby="su-ready-hint"/);
  assert.match(form, /<div className="alert" role="status">\s*\{notice\}/);
});

console.log(`signup next step: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
