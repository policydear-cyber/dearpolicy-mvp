/** A new visitor to /signup learns sign-up is invite-only BEFORE filling in the form, read from the server setting on each
 * request; open sign-up (the default) shows nothing new. Renders the real page; no database, no network.
 *   npm run -s auth:signup-invite-note-test */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SignupPage from "@/app/signup/page";
import { INVITE_ONLY_NOTE } from "@/app/signup/SignupForm";
import { SIGNUP_CLOSED_MESSAGE } from "@/lib/auth/signup-gate";

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("  FAIL " + name + ": " + (e as Error).message); }
}
const render = (mode: string | undefined) => {
  if (mode === undefined) delete process.env.DEARPOLICY_SIGNUP_MODE; else process.env.DEARPOLICY_SIGNUP_MODE = mode;
  return renderToStaticMarkup(createElement(SignupPage));
};
const note = 'data-testid="signup-invite-only"';
t("invite-only: the note is shown above the form", () => {
  const html = render("invite");
  assert.ok(html.includes(note) && html.includes(INVITE_ONLY_NOTE));
  assert.ok(html.indexOf(note) < html.indexOf("<form"), "note comes before the form");
});
t("any other value counts as invite-only too (fails closed, as the gate does)", () => { for (const v of ["INVITE", "closed", "yes"]) assert.ok(render(v).includes(note), v); });
t("open sign-up (unset, empty, \"open\") shows no note", () => { for (const v of [undefined, "", "open", " Open "]) assert.ok(!render(v).includes(note), String(v)); });
t("the note and the refusal tell the same story (invited email address)", () => {
  assert.match(INVITE_ONLY_NOTE, /invitation only/); assert.match(SIGNUP_CLOSED_MESSAGE, /invitation only/);
  assert.match(INVITE_ONLY_NOTE, /email address your invitation was sent to/);
});
t("the form is still there in both modes", () => { for (const v of ["invite", undefined]) assert.ok(render(v).includes('id="su-email"'), String(v)); });
t("no network calls", () => assert.equal(fetches, 0));
console.log(`\nsignup invite note: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
