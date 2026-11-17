/**
 * Member profile (#527) in the chat's people module: the sex the household entered settles "daughter" / "son" when the
 * relationship word does not, the words win when they do, and the members read carries the column (to_jsonb, so it also
 * works before sql/member-profile.sql is applied). Scripted, no database, made-up people.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toPerson } from "@/lib/rag2/people";

let passed = 0, failed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n   ${(e as Error).message}`); }
}
const m = (relationship: string, sex: string | null, notes: string | null = null) =>
  toPerson({ id: "1", displayName: "Lim Xin Yi", preferredName: null, relationship, notes, dateOfBirth: "2016-05-01", sex });

void (async () => {
  await check("a 'child' saved as female is labelled and matched as a daughter", () => {
    assert.equal(m("child", "female").relationLabel, "daughter");
    assert.equal(m("child", "female").gender, "f");
  });
  await check("prefer not to say or unanswered: as before, from the words only", () => {
    assert.equal(m("child", "unspecified").relationLabel, "child");
    assert.equal(m("child", null).relationLabel, "child");
  });
  await check("the relation words win over a mistaken sex", () => {
    assert.equal(m("child", "female", "son").gender, "m");
  });
  await check("the members read selects sex through to_jsonb (safe before the migration) and the turn fingerprint includes it", async () => {
    const src = await readFile("lib/rag2/store.ts", "utf8");
    assert.match(src, /to_jsonb\(f\)->>'sex' AS sex/);
    assert.match(src, /m\.dateOfBirth, m\.sex \?\? null\]/);
  });
  console.log(`\nrag2 member sex: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
