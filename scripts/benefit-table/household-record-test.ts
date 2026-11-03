/** The household's own word on who a printed name is (householdRecord, lib/benefit-table/assemble.ts) wins over any
 * match by name, for that one document only. Pure; made-up names from several markets and writing systems.
 *   npm run benefit-table:household-record-test */
import assert from "node:assert/strict";
import { householdRecord, type FamilyMember } from "@/lib/benefit-table/assemble";
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
let passed = 0; const failed: string[] = [];
const t = (name: string, fn: () => void) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };
const m = (id: string, display_name: string, extra: Partial<FamilyMember> = {}): FamilyMember => ({ id, display_name, ...extra });

t("no household answer: null, so the match by name decides as before", () => {
  assert.equal(householdRecord("Chen Wei Ming", "d1", [m("a", "Wei Ming"), m("b", "Chen Li")]), null);
});
t("a name the household matched by hand on this document is that person, whatever the name says", () => {
  const fam = [m("a", "Wei Ming"), m("b", "Chen Wei Ming Jr", { chosenAs: [{ documentId: "d1", name: "CHEN  WEI MING" }] })];
  assert.equal((householdRecord("Chen Wei Ming", "d1", fam) as { member: FamilyMember }).member.id, "b");
  assert.equal(householdRecord("Chen Wei Ming", "d2", fam), null, "another document is not changed by it");
});
t("a name the household said is not in the family is nobody, on that document only", () => {
  const fam = [m("a", "Siti", { notThem: [{ documentId: "d1", name: "Siti binti Ahmad" }] })];
  assert.equal(householdRecord("siti binti ahmad", "d1", fam), "nobody");
  assert.equal(householdRecord("Siti binti Ahmad", "d2", fam), null);
});
t("a person taken off a document is not matched there by name again", () => {
  const fam = [m("a", "Ana", { excludedFrom: ["d1"] }), m("b", "Ana Lucia Ortega")];
  assert.equal(householdRecord("Ana Ortega", "d1", fam), "nobody");
  assert.equal(householdRecord("Ana Ortega", "d2", fam), null);
});
t("names in other writing systems compare whole", () => {
  const fam = [m("a", "伟明"), m("b", "陈伟明", { chosenAs: [{ documentId: "d1", name: "陈伟明" }] })];
  assert.equal((householdRecord("陈伟明", "d1", fam) as { member: FamilyMember }).member.id, "b");
  assert.equal(householdRecord("陈伟", "d1", fam), null);
});
t("two people claiming the same printed name by hand is not trusted: falls back to the usual match", () => {
  const fam = [m("a", "Priya", { chosenAs: [{ documentId: "d1", name: "Priya Nair" }] }), m("b", "Priya N", { chosenAs: [{ documentId: "d1", name: "Priya Nair" }] })];
  assert.equal(householdRecord("Priya Nair", "d1", fam), null);
});
console.log(`\nhousehold record: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
