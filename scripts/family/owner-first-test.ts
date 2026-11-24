/**
 * Owner first (lib/household/member-profile.ts familyStart): the Family page starts a new household with the person who
 * signed up, as "self", before anyone else; households that already have people are never blocked.
 * Scripted test (evidence category 1), no model, no network. The page itself is checked in
 * e2e/tests/r8-family-owner-first.spec.ts. Made-up people only.
 */
import assert from "node:assert/strict";
import { familyStart } from "@/lib/household/member-profile";

let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n   ${(e as Error).message.split("\n").slice(0, 4).join("\n   ")}`); }
}

check("a brand-new household (nobody on file) is asked about the owner first", () => assert.equal(familyStart([]), "owner"));
check("only a spouse on file (the reported case) still has no owner: the owner is offered, nothing is blocked", () =>
  assert.equal(familyStart([{ relationship: "spouse" }]), "family-without-owner"));
check("an owner on file opens the family step", () => assert.equal(familyStart([{ relationship: "self" }]), "family"));
check("the owner is found wherever they sit in the list and however the word is cased", () =>
  assert.equal(familyStart([{ relationship: "child" }, { relationship: " Self " }]), "family"));
check("a missing relationship is not an owner", () => assert.equal(familyStart([{ relationship: null }, {}]), "family-without-owner"));

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
