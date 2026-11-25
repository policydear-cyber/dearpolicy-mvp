/** Scripted tests: a chat page that is behind its own chat (one tab, an answer finished late) takes the chat as it now stands
 * after a refused send, so the next send is not refused the same way (Live tester, 25 Nov). It never sends the message again
 * for the person (Critic #594: wrong person, a second question counted, an unseen late answer). No model, network or database.
 *   npm run -s chat:stale-revision-resend-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catchUpState } from "@/components/chat-send-failure";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const page = readFileSync("app/chat/page.tsx", "utf8");

test("S1 the chat's current revision, own person and cursor are taken", () => {
  assert.deepEqual(catchUpState({ conversation: { revision: 4, family_member_id: "m-2" }, nextCursor: "c9" }), { revision: 4, memberId: "m-2", cursor: "c9" });
});
test("S2 a chat with no person yet, or no older page, gives empty values (not the old person)", () => {
  assert.deepEqual(catchUpState({ conversation: { revision: "7", family_member_id: null } }), { revision: 7, memberId: "", cursor: null });
});
test("S3 an unreadable or malformed chat gives nothing, so nothing on the page changes", () => {
  for (const bad of [null, undefined, {}, { conversation: null }, { conversation: { revision: "x" } }, { conversation: { revision: -1 } }, { conversation: {} }]) {
    assert.equal(catchUpState(bad as never), null);
  }
});
test("S4 the page catches up after a refused send and never posts the message a second time", () => {
  assert.match(page, /if\(conflict&&conversationId\)void catchUp\(conversationId,version\)/);
  assert.equal((page.match(/fetch\("\/api\/chat",\{method:"POST"/g) ?? []).length, 1, "one place posts a chat message");
  assert.match(page, /setRevision\(state\.revision\);setMemberId\(state\.memberId\)/);
});
test("S5 the refusal makes no claim the page cannot be sure of (box content, successful catch-up)", () => {
  assert.match(page, /Send it again, or reload the chat to see the latest messages\./);
  assert.doesNotMatch(page, /Your message is in the box/);
});

console.log(`stale-revision catch-up: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
