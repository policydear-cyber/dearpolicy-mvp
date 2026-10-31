/** Which Home a household sees (lib/format/home-view.ts): the first-visit welcome only when nothing at all is on file;
 * a person with nothing yet keeps the household's page with a note naming any policy a premium was found for.
 * Made-up households in several markets; pure, no I/O.
 *   node --import tsx scripts/policies/home-view-test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homeView } from "@/lib/format/home-view";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const fam = (...counts: number[]) => counts.map((policy_count) => ({ policy_count }));

test("a household with nothing on file gets the welcome", () => {
  assert.deepEqual(homeView({ covered: 0, personDocs: 0, family: fam(0, 0), unclaimed: 0, premiums: [] }), { empty: true, personEmpty: false, paidFor: [] });
  assert.equal(homeView({ covered: 0, personDocs: 0, family: [], unclaimed: 0, premiums: [] }).empty, true, "no members yet");
});
test("a person with nothing yet in a household that has documents keeps the household page", () => {
  const v = homeView({ covered: 0, personDocs: 0, family: fam(3, 1, 0), unclaimed: 0, premiums: [] });
  assert.equal(v.empty, false); assert.equal(v.personEmpty, true); assert.deepEqual(v.paidFor, []);
});
test("a premium found for that person names its policy, once, falling back to the insurer", () => {
  const v = homeView({ covered: 0, personDocs: 0, family: fam(2, 0), unclaimed: 0, premiums: [
    { product_name: "Sekolah Accident Guard", insurer: "Takaful Seri" }, { product_name: "Sekolah Accident Guard", insurer: "Takaful Seri" },
    { product_name: null, insurer: "Thames Mutual" }, { product_name: null, insurer: null }] });
  assert.equal(v.personEmpty, true); assert.deepEqual(v.paidFor, ["Sekolah Accident Guard", "Thames Mutual"]);
});
test("only premium records on file (no document anywhere) is not the welcome", () => {
  const v = homeView({ covered: 0, personDocs: 0, family: fam(0), unclaimed: 0, premiums: [{ product_name: "Junior Shield", insurer: null }] });
  assert.equal(v.empty, false); assert.equal(v.personEmpty, true); assert.deepEqual(v.paidFor, ["Junior Shield"]);
});
test("only a document nobody has claimed yet is not the welcome", () => {
  const v = homeView({ covered: 0, personDocs: 0, family: fam(0, 0), unclaimed: 1, premiums: [] });
  assert.equal(v.empty, false); assert.equal(v.personEmpty, true);
});
test("a person with a document sees their cover, never the nothing-yet note", () => {
  const v = homeView({ covered: 0, personDocs: 1, family: fam(1, 0), unclaimed: 0, premiums: [] });
  assert.equal(v.empty, false); assert.equal(v.personEmpty, false);
});
test("a person covered through a document linked only to someone else keeps their tiles", () => {
  // A group certificate names two people; at upload only one was chosen, but the table still gives the other a cover.
  const v = homeView({ covered: 1, personDocs: 0, family: fam(1, 0), unclaimed: 0, premiums: [] });
  assert.equal(v.empty, false); assert.equal(v.personEmpty, false);
  assert.equal(homeView({ covered: 1, personDocs: 0, family: fam(0, 0), unclaimed: 0, premiums: [] }).empty, false, "never the welcome either");
});
test("Home uses the helper, and the nothing-yet note never says not covered", () => {
  const home = readFileSync("app/page.tsx", "utf8");
  assert.match(home, /homeView\(\{/); assert.match(home, /covered:confirmed\.length/); assert.match(home, /personEmpty\?<PersonNothingYet/);
  const note = home.slice(home.indexOf("function PersonNothingYet"), home.indexOf("function EmptyPortfolio"));
  assert.ok(note.length > 0); assert.doesNotMatch(note, /not covered|no cover\b|uninsured/i);
});

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`home view: ${passed} passed`);
