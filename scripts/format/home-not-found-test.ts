/** Home (app/page.tsx): the tiles show what was found for the person, and the kinds of cover not found go in one line
 * under them, each still linking to its Coverage answer, instead of a "Not found" tile each repeating the same sentence.
 * Changes no status: a tile's status decides which list it is in. Renders the real component; no database, no network.
 *   node --import tsx scripts/format/home-not-found-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeNotFound } from "@/components/home-not-found";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const html = (categories: string[], note?: string | null) => renderToStaticMarkup(createElement(HomeNotFound, { categories, memberId: "m 1", note }));
const text = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");

test("every kind not found is named once, in order, each linking to its own Coverage answer", () => {
  const h = html(["Hospital Cash", "Critical Illness", "Long-term Care"]);
  assert.equal(text(h), "Not found in the personal policies you uploaded: Hospital Cash, Critical Illness, Long-term Care.A policy you have not uploaded may still include them.");
  assert.match(h, /href="\/coverage\?member=m%201&amp;category=Critical%20Illness"/);
  assert.equal((h.match(/<a /g) ?? []).length, 3);
});
test("with documents not fully read, it says so instead of implying no cover", () => {
  const t = text(html(["Travel"], "One of Ama's documents could not be read in full."));
  assert.equal(t, "Not found in what DearPolicy could read: Travel.One of Ama's documents could not be read in full.");
  assert.doesNotMatch(t, /may still include/);
});
test("nothing missing: nothing shown", () => {
  assert.equal(html([]), "");
});
test("Home shows a card only for cover it can call Covered; nothing for on-file or not-found cover (DC 16 Nov)", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  // DC 16 Nov: "If it's covered, it's covered." A cover no document gives the person has no card, and the "Not found" line
  // and the "On file, please confirm" tile are gone from Home; each cover's own Coverage page still says what was found.
  assert.match(page, /const covered=\(data\?\.coverages\?\?\[\]\)\.filter\(c=>c\.status==="covered"\);/);
  assert.match(page, /covered\.map\(c=>/);
  assert.doesNotMatch(page, /HomeNotFound|On file, please confirm|onFileNote|Not found/);
  assert.doesNotMatch(page, /"Not covered"|>Not covered</);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`home-not-found: ${passed} passed, fetches 0`);
