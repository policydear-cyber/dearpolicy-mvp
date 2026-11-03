/** The household's own word on who a printed name is (householdRecord, lib/benefit-table/assemble.ts) wins over any
 * match by name, for that one document only. Pure; made-up names from several markets and writing systems.
 *   npm run benefit-table:household-record-test */
import assert from "node:assert/strict";
import { coversOf, householdRecord, type FamilyMember } from "@/lib/benefit-table/assemble";
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
t("two people claiming the same printed name by hand is not trusted: nobody, never a guess between them", () => {
  const fam = [m("a", "Priya", { chosenAs: [{ documentId: "d1", name: "Priya Nair" }] }), m("b", "Priya N", { chosenAs: [{ documentId: "d1", name: "Priya Nair" }] })];
  assert.equal(householdRecord("Priya Nair", "d1", fam), "nobody");
});
t("the household's answer holds however the cover prints the name (order, title, role, comma, full-width brackets)", () => {
  const cases: [string, string][] = [["Ana Ortega", "Sra. Ana Ortega"], ["Ana Ortega", "Ortega, Ana"], ["Ana Ortega", "Ana Ortega (Life Assured)"],
    ["Siti binti Ahmad", "Puan Siti binti Ahmad"], ["Siti binti Ahmad", "Ahmad, Siti binti"], ["陈伟明", "陈伟明（受保人）"], ["Nguyễn Văn An", "NGUYỄN VĂN AN"]];
  for (const [stored, printed] of cases) {
    const fam = [m("a", stored.split(/[ ,]/)[0], { excludedFrom: ["d1"] }), m("b", "Chosen", { chosenAs: [{ documentId: "d1", name: stored }], namedOn: [{ documentId: "d1", name: stored }] })];
    const got = householdRecord(printed, "d1", fam);
    assert.equal(typeof got === "object" && got ? got.member.id : got, "b", `${stored} printed as ${printed}`);
    const dismissed = [m("a", stored.split(/[ ,]/)[0], { notThem: [{ documentId: "d1", name: stored }] })];
    assert.equal(householdRecord(printed, "d1", dismissed), "nobody", `not family: ${stored} printed as ${printed}`);
  }
});
t("the closest stored name decides: a fuller name the household did not answer is not taken by a shorter one it did", () => {
  const on = (n: string) => ({ documentId: "d1", name: n });
  const fam = [m("a", "Ana", { namedOn: [on("Ana"), on("Ana Ortega")] }), m("b", "Ana Lucia Ortega", { chosenAs: [on("Ana")] })];
  assert.equal(householdRecord("Sra. Ana Ortega", "d1", fam), null, "closest is 'Ana Ortega', which the household did not answer");
  assert.equal((householdRecord("Sra. Ana", "d1", fam) as { member: FamilyMember }).member.id, "b");
});
t("two stored names equally close with different answers: nobody, never a guess", () => {
  const on = (n: string) => ({ documentId: "d1", name: n });
  const fam = [m("a", "Wei", { chosenAs: [on("Tan Wei")] }), m("b", "Jie", { chosenAs: [on("Wei Jie")] })];
  assert.equal(householdRecord("Tan Wei Jie", "d1", fam), "nobody");
});
t("no answer on the document: unchanged behaviour even with every printed name listed", () => {
  const on = (n: string) => ({ documentId: "d1", name: n });
  assert.equal(householdRecord("Ortega, Ana", "d1", [m("a", "Ana", { namedOn: [on("Ana Ortega")] })]), null);
});
t("someone the household took off a document is not offered as who an unclear name there might be", () => {
  const cover = { person: "Tan Wei Jie", product: "Plan", cover: "Plan", plan: null, riderOf: null, policyNumber: null, sumInsured: 5000, premium: null, premiumFrequency: null,
    asOf: null, startDate: null, endDate: null, page: 1, quote: "x", source: { page: 1, quote: "x", verified: true }, currency: "SGD" };
  const reading = { documentId: "d", document: "d", kind: "personal_proof", product: "Plan", plan: null, namedPeople: [], covers: [cover], benefits: [], dropped: [] };
  const run = (excluded: string[]) => coversOf([reading] as never, [m("wj", "Wei Jie", { excludedFrom: excluded }), m("tw", "Tan Wei")]).ambiguous.map((a) => a.candidates.map((c) => c.id).sort());
  assert.deepEqual(run([]), [["tw", "wj"]]);
  assert.deepEqual(run(["d"]), [["tw"]]);
});
console.log(`\nhousehold record: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
