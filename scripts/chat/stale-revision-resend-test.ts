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
  assert.match(page, /if\(conflict&&conversationId\)void catchUp\(conversationId,version,text\)/);
  assert.equal((page.match(/fetch\("\/api\/chat",\{method:"POST"/g) ?? []).length, 1, "one place posts a chat message");
  assert.match(page, /setRevision\(state\.revision\);setMemberId\(state\.memberId\)/);
});
test("S5 the refusal makes no claim the page cannot be sure of (box content, successful catch-up)", () => {
  assert.match(page, /Send it again, or reload the chat to see the latest messages\./);
  assert.doesNotMatch(page, /Your message is in the box/);
});

test("S6 a deleted chat says so, with no 'send it again' after it", () => {
  assert.match(page, /const CHAT_GONE_TEXT="This chat no longer exists\."/);
  assert.match(page, /message\.error\.startsWith\(CHAT_GONE_TEXT\)/);
});
test("S7 a message the chat already holds is found among the household's own messages (the chat ends with the answer), not drawn as a second send", () => {
  // Behaviour of the lookup the page uses, on a history that ends [user, assistant] (Test engineer F1, #594).
  const shown = [{ role: "user", content: "Is dental covered?" }, { role: "assistant", content: "No." }];
  const lastSent = [...shown].reverse().find((m) => m.role === "user");
  assert.equal(String(lastSent?.content).trim(), "Is dental covered?");
  assert.match(page, /const lastSent=\[\.\.\.shown\]\.reverse\(\)\.find\(\(m:\{role:string\}\)=>m\.role==="user"\)/);
  assert.match(page, /ALREADY_SENT_TEXT/);
});

console.log(`stale-revision catch-up: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
