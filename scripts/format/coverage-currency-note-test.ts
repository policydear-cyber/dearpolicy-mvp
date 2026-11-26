/** Coverage says where its currency comes from once for each person, never on every cover card. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const raw = readFileSync("components/benefit-table-coverage.tsx", "utf8");
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
const card = src.slice(src.indexOf("function CoverCard("), src.indexOf("function TellUs("));

assert.ok(!/table-currency-note/.test(card), "N1 the cover card does not repeat the note");
assert.equal((src.match(/data-testid="table-currency-note"/g) ?? []).length, 1, "N2 the note is written in one place");
assert.match(src, /person\.covers\.some\(c=>c\.fromSettings\|\|rowsForCover\(c,person\.covers,person\.rows\)\.rows\.some\(r=>r\.fromSettings\)\)\?<p[^>]*table-currency-note/, "N3 shown only when a figure for that person uses the account currency");
assert.match(src, /const CURRENCY_NOTE_ONCE="Some amounts here use the currency from your account settings, where the document prints none\."/, "N4 says what it means");
assert.ok(src.indexOf("table-currency-note") > src.indexOf("cov-person-head"), "N5 sits in the person section, after its heading");
console.log("coverage currency note test passed: 5 cases");
