/** A broken page shows DearPolicy's own message: nothing lost, a working retry and a way back, no raw error text. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const raw = readFileSync("app/error.tsx", "utf8");
// Comments never count: strip block and line comments first.
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
const jsx = src.slice(src.indexOf("return <"));

assert.ok(raw.startsWith('"use client"'), "E1 error boundary must be a client component");
assert.match(jsx, /Your documents and answers are safe/, "E2 says nothing is lost");
assert.match(jsx, /<button[^>]*type="button"[^>]*onClick=\{\(\) => startTransition\(\(\) => \{[^}]*router\.refresh\(\);[^}]*reset\(\);[^}]*\}\)\}[^>]*>Try again<\/button>/, "E3 a real button that refreshes from the server and resets");
assert.match(jsx, /<Link[^>]*href="\/"[^>]*>Back to Home<\/Link>/, "E4 a link back to Home");
assert.match(jsx, /role="alert"/, "E5 announced to screen readers");
assert.match(src, /useEffect\(\(\) => \{ heading\.current\?\.focus\(\); \}, \[\]\)/, "E6 focus moves to the heading");
assert.match(jsx, /<h1 ref=\{heading\} tabIndex=\{-1\}>/, "E7 heading can take focus");
assert.match(src, /function PageError\(\{ reset \}: \{ reset: \(\) => void \}\)/, "E8 only reset is received, so the error cannot be printed");
assert.ok(!/\berror\b/.test(jsx.replace(/data-testid="page-error"/, "")), "E9 the page does not refer to the error");
assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(raw), "E10 no colour literals");
console.log("page-error test passed: 10 cases");
