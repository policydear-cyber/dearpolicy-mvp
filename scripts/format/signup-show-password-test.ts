/** Sign up has the same Show/Hide password control as Sign in, so a new person on a phone can check a new password.
 * Rendered, not read from source. No model, network or database.
 *   npm run -s format:signup-show-password-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SignupForm from "@/app/signup/SignupForm";

const html = renderToStaticMarkup(createElement(SignupForm as never));
const field = html.match(/<div class="password-field">([\s\S]*?)<\/div>/)?.[1] ?? "";
assert.ok(field, "S1 the password sits in a password-field");
assert.match(field, /id="su-password"[^>]*type="password"|type="password"[^>]*id="su-password"/, "S2 hidden by default");
assert.match(field, /<button[^>]*type="button"[^>]*aria-pressed="false"[^>]*aria-controls="su-password"[^>]*>Show<\/button>/, "S3 a Show button that controls the field");
assert.match(html, /id="su-password-hint"/, "S4 the hint is still there");
assert.match(field, /autoComplete="new-password"|autocomplete="new-password"/i, "S5 still a new-password field");
const source = readFileSync("app/signup/SignupForm.tsx", "utf8");
assert.match(source, /type=\{showPassword \? "text" : "password"\}/, "S6 the type follows the toggle");
assert.match(source, /onClick=\{\(\) => setShowPassword\(\(v\) => !v\)\}/, "S7 the button flips it");
assert.ok(html.indexOf(">Show</button>") > html.indexOf('id="su-password"'), "S8 the button comes after the field");
assert.match(field, /class="mini-button"/, "S9 same button style as Sign in");
assert.ok(!/<button[^>]*disabled/.test(field), "S10 the toggle is never disabled");
assert.match(field, /id="su-password"[^>]*aria-describedby="su-password-hint"|aria-describedby="su-password-hint"[^>]*id="su-password"/, "S11 the field keeps pointing at its hint");
assert.match(source, /\{showPassword \? "Hide" : "Show"\}<\/button>/, "S12 the label flips with the state");
assert.equal((source.match(/showPassword \?/g) ?? []).length, 2, "S13 only the password field and the label follow the toggle");
console.log("signup show password test passed: 13 cases");
