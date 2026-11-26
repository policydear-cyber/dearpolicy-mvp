/** A broken page shows DearPolicy's own message: nothing lost, a retry and a way back, no raw error text. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync("app/error.tsx", "utf8");
assert.ok(src.startsWith('"use client"'), "E1 error boundary must be a client component");
assert.match(src, /Your documents and answers are safe/, "E2 says nothing is lost");
assert.match(src, /onClick=\{\(\) => reset\(\)\}[^>]*>Try again|Try again/, "E3 offers a retry");
assert.match(src, /href="\/"/, "E4 offers a way back");
assert.ok(!/error\.message|error\.digest|\{error\}/.test(src.replace(/error: Error & \{ digest\?: string \}/, "")), "E5 never prints the raw error");
assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(src), "E6 no colour literals");
console.log("page-error test passed: 6 cases");
