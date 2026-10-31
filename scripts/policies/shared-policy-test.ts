/** One person's view of a policy that covers several household members (Benefits, app/schedule/page.tsx): it says whom
 * else the policy covers and this person's own sum on it, so a figure printed for someone else is never read as theirs.
 * Made-up names and sums in several markets. Pure: no database, no network, no model.
 *   node --import tsx scripts/policies/shared-policy-test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { namesList, sharedPolicyNote, sharedPolicyText } from "@/lib/policies/shared-policy";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const rahul = { id: "m2", name: "Rahul Menon" };
test("everyone's view and a policy only one person holds say nothing extra", () => {
  assert.equal(sharedPolicyNote(["Ng Siew Lan", "Rahul Menon"], null, []), null);
  assert.equal(sharedPolicyNote(["Rahul Menon"], rahul, [[{ owner: "Rahul Menon", amount: "S$600,000" }]]), null);
  assert.equal(sharedPolicyNote([], rahul, []), null);
});
test("a person not linked to the policy gets no note", () => {
  assert.equal(sharedPolicyNote(["Ng Siew Lan", "Aiden Menon"], rahul, []), null);
});
test("a shared policy names the others and this person's own sum, by name or by id", () => {
  assert.deepEqual(sharedPolicyNote(["Ng Siew Lan", "Rahul Menon"], rahul, [null, [{ owner: "Rahul Menon", amount: "S$150,000" }]]), { others: ["Ng Siew Lan"], ownSum: "S$150,000" });
  assert.deepEqual(sharedPolicyNote(["Ama Owusu", "Kofi Owusu", "Rahul Menon"], rahul, [[{ ownerId: "m9", owner: "Rahul Menon", amount: "GH₵ 9,000" }, { ownerId: "m2", owner: "Rahul Menon", amount: "GH₵ 80,000" }]]),
    { others: ["Ama Owusu", "Kofi Owusu"], ownSum: "GH₵ 80,000" });
  assert.deepEqual(sharedPolicyNote(["Siti Aminah", "Rahul Menon"], rahul, [[{ owner: "Siti Aminah", amount: "RM 50,000" }]]), { others: ["Siti Aminah"], ownSum: null }, "another person's sum is never this person's");
});
test("two members with the same name: one is this person, the other is still named", () => {
  assert.deepEqual(sharedPolicyNote(["Rahul Menon", "Rahul Menon"], rahul, [])?.others, ["Rahul Menon"]);
});
test("the sentence never gives another person's sum as this person's", () => {
  assert.equal(sharedPolicyText({ others: ["Ng Siew Lan"], ownSum: "S$150,000" }, "Rahul Menon"),
    "This policy also covers Ng Siew Lan. Rahul Menon's own sum insured on it is S$150,000; an amount printed below may be for another person on it.");
  assert.equal(sharedPolicyText({ others: ["Chidi Okafor", "Ruth Okafor"], ownSum: null }, "Ada Okafor"), "This policy also covers Chidi Okafor and Ruth Okafor. An amount printed below may be for another person on it.");
  assert.equal(namesList(["A", "B", "C"]), "A, B and C");
});
test("Benefits uses it in the person view, and drops the repeated owner names there", () => {
  const page = readFileSync("app/schedule/page.tsx", "utf8");
  assert.match(page, /sharedPolicyNote\(rows\[0\]\?\.owners\?\?\[\],selectedPerson,rows\.map\(r=>r\.calculatedAgainst\)\)/);
  assert.match(page, /data-testid="shared-policy">\{sharedPolicyText\(note,selectedPerson!\.name\)\}/);
  assert.match(page, /benefit\.owners\.length>0&&!shared\(rows\)&&<small>/);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`shared-policy: ${passed} passed, fetches 0`);
