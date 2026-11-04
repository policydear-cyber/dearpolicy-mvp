/** Kin words common in Singapore and Malaysian English ("my ibu", "amma", "my appa", "anak lelaki") name someone other
 * than the speaker. They stay a guard after the English-only change (Critic H1 on #343): a message that uses one never
 * resolves to the account holder. Made-up household; no database, no model.
 *   npm run -s chat:kin-words-test */
import assert from "node:assert/strict";
import { householdPersonFromWords } from "@/lib/chat/person-words";

const fam = [{ id: "s", display_name: "Alex Tan", preferred_name: null, relationship: "self" }, { id: "m", display_name: "Mei Tan", preferred_name: null, relationship: "mother" },
  { id: "f", display_name: "Kai Tan", preferred_name: null, relationship: "father" }, { id: "c", display_name: "Leo Tan", preferred_name: null, relationship: "child" }];
let passed = 0; const failures: string[] = [];
const cases: [string, string | null][] = [
  ["My ibu fell and broke her wrist, do I have cover?", "m"], ["Amma was warded yesterday, am I covered?", "m"], ["My mak was admitted to hospital, can I claim?", "m"],
  ["My appa had a heart attack, what do I get?", "f"], ["My ayah passed away, do I get the death benefit?", "f"], ["My anak lelaki broke his arm, do I claim?", "c"],
  ["My mum was admitted, can I claim?", "m"],
];
for (const [q, want] of cases) {
  try {
    const r = householdPersonFromWords(q, fam as never);
    const got = r?.status === "resolved" ? r.person.id : null;
    assert.notEqual(got, "s", "resolved to the speaker");
    assert.equal(got, want);
    passed++;
  } catch (e) { failures.push(`${q}: ${e instanceof Error ? e.message : String(e)}`); }
}
console.log(`kin words: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
