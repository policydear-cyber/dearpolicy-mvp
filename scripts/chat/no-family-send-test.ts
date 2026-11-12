/** Scripted tests: a household with nobody in it sees the server's own "Add a family member first" words and a link to
 * add family members, not "This chat was updated in another tab" (TE, 12 Nov: every new household's first chat message
 * was refused with 409 code "no_family_members", and the chat page read every 409 as a stale-chat conflict). A real
 * stale-chat 409 still reads as a conflict. No model, network or database.
 *   npm run -s chat:no-family-send-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sendFailure } from "@/components/chat-send-failure";
import { customerMessage } from "@/components/customer-text";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const route = readFileSync("app/api/chat/route.ts", "utf8");
const page = readFileSync("app/chat/page.tsx", "utf8");
const NO_FAMILY = route.match(/const NO_FAMILY_MESSAGE="([^"]+)"/)?.[1] ?? "";

test("N0 the route still refuses an empty household with 409 and its code", () => {
  assert.ok(NO_FAMILY.startsWith("Add a family member first"), "route message");
  assert.match(route, /code:"no_family_members"\},\{status:409\}/);
});
test("N1 409 with code no_family_members is not a conflict", () => assert.equal(sendFailure(409, NO_FAMILY, "no_family_members"), "no_family"));
test("N2 the code alone is enough, whatever the words", () => assert.equal(sendFailure(409, "", "no_family_members"), "no_family"));
test("N3 a failed answer saying the same (no status) is the same case", () => {
  // The flagged loop hook says the same words; its source is not read here (rag2:tools-test F4 keeps it to its own suites).
  for (const file of ["lib/chat/workflow.ts", "lib/simple-chat/hook.ts"]) {
    const said = readFileSync(file, "utf8").match(/!family\.length\)\s*throw new ChatConflict\("([^"]+)"\)/)?.[1];
    assert.ok(said, `${file} message`);
    assert.equal(sendFailure(null, said!), "no_family", file);
  }
});
test("N4 the server's words are shown as they are", () => assert.equal(customerMessage(NO_FAMILY, "fallback"), NO_FAMILY));
test("N5 the page shows the no-family notice with a link to /family, ahead of the conflict notice", () => {
  const at = page.indexOf('data-testid="chat-no-family"'), conflictAt = page.indexOf('data-testid="chat-conflict"');
  assert.ok(at > 0 && conflictAt > at, "notice before the conflict branch");
  assert.match(page.slice(at, at + 300), /href="\/family"/);
  assert.doesNotMatch(page, /status===409\|\|/, "no bare 409 test left");
});

// ---- C: controls
test("C1 a stale-chat 409 is still a conflict", () => assert.equal(sendFailure(409, "This chat changed. Reopen it before sending another message."), "conflict"));
test("C2 a 409 with no words is still a conflict", () => assert.equal(sendFailure(409, ""), "conflict"));
test("C3 a deleted chat (409) is still a conflict", () => assert.equal(sendFailure(409, "This chat was deleted or is unavailable. Start a new chat."), "conflict"));
test("C4 a stale-chat failed answer (no status) is still a conflict", () => assert.equal(sendFailure(null, "This chat changed while the answer was being written."), "conflict"));
test("C5 other refusals are neither", () => {
  assert.equal(sendFailure(429, "This household has reached its monthly limit.", "spend_limit"), "other");
  assert.equal(sendFailure(500, "Chat failed"), "other");
  assert.equal(sendFailure(404, "Family member not found."), "other");
  assert.equal(sendFailure(null, "Please add a family member first"), "other");
});

console.log(`no family send: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
