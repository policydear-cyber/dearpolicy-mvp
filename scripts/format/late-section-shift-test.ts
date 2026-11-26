/** Scripted test: sections that load late are placed so they do not push content already on screen (Live tester, 26 Nov: layout
 * shift 0.889 on Documents and 0.479 on Records). Source checks on app/policies/page.tsx and app/records/page.tsx.
 *   npm run -s format:late-section-shift-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const policies = readFileSync("app/policies/page.tsx", "utf8");
const records = readFileSync("app/records/page.tsx", "utf8");

test("S1 Documents: the folders come after the upload box, not above it", () => {
  assert.ok(policies.indexOf('className="upload-panel"') < policies.indexOf("<PolicyFolders"), "folders after the upload panel");
  assert.equal((policies.match(/<PolicyFolders/g) ?? []).length, 1);
  assert.ok(policies.indexOf("<PolicyFolders") > policies.indexOf("<h2>Documents on file</h2>"), "inside Documents on file");
  assert.ok(policies.indexOf("<PolicyFolders") < policies.indexOf('<div className="document-list rows">'), "above the list");
});
test("S2 Documents: folders still wait for the family and documents to load", () => {
  assert.match(policies, /\{loaded && familyKnown && family\.length > 0 && <PolicyFolders documents=\{policies\}/);
});
test("S3 Records: Payment records wait for the premiums above to load or fail", () => {
  assert.match(records, /\{\(people\|\|peopleFailed\)&&<section className="section">/);
  assert.ok(records.indexOf("(people||peopleFailed)") > records.indexOf("people?.map"), "after the people");
  assert.match(records, /<\/section>\}\n    <\/div>/);
});
test("S4 Records: payments still load, show their loading line, failure and empty states", () => {
  assert.match(records, /Loading your payments…/);
  assert.match(records, /Your payments could not be loaded/);
  assert.match(records, /No payment records yet/);
});

console.log(`late section shift: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
