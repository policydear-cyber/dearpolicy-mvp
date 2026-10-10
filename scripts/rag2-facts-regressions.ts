/**
 * Round 6 regression (real-model L3): a fact whose value records that something was NOT said is refused, unless the
 * household's own words say they don't know. Deterministic, no network.
 */
import assert from "node:assert/strict";
import { checkFact } from "../lib/rag2/loop/facts";

let n = 0;
const ok = (name: string, f: () => void) => { f(); n++; console.log("  ok  " + name); };
const users = ["Kai broke his arm yesterday.", "Mei hurt her wrist at netball, not sure how exactly.", "I don't know when he was admitted."];

ok("F1 'not stated' from words that do not say it is refused", () => {
  const r = checkFact({ key: "how_it_happened", value: "not stated", words: "Kai broke his arm yesterday." }, users);
  assert.equal(r.ok, false);
});
for (const v of ["unknown", "Not mentioned", "N/A", "unspecified", "not given", "to be confirmed", "no details given"]) {
  ok(`F2 placeholder "${v}" is refused`, () => assert.equal(checkFact({ key: "cause", value: v, words: "Kai broke his arm yesterday." }, users).ok, false));
}
ok("F3 the household saying they are not sure may be recorded (so it is never asked again)", () => {
  const r = checkFact({ key: "how_it_happened", value: "unknown", words: "not sure how exactly" }, users);
  assert.equal(r.ok, true);
});
ok("F4 a real answer is still recorded", () => {
  const r = checkFact({ key: "injury", value: "broke his arm", words: "Kai broke his arm yesterday." }, users);
  assert.equal(r.ok, true);
});
ok("F5 a value merely containing 'not' is not a placeholder", () => {
  const r = checkFact({ key: "admission_time", value: "unknown", words: "I don't know when he was admitted." }, users);
  assert.equal(r.ok, true);
});
console.log(`rag2 facts regressions: ${n} passed`);
