/**
 * The simple chat switched on for every household (DEARPOLICY_SIMPLE_CHAT_ALL_ACCOUNTS, lib/simple-chat/flag.ts; DC, 3 Nov:
 * new users get the simple chat at launch). The switch only widens who gets it: the other switches still gate it, a
 * call that names no account stays off, and a household that already chatted on the earlier path continues its
 * conversation. Made-up household in PGlite, a stand-in model, no network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDatabase } from "../r6/fixture";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

test("the switch opens the simple chat to any named household, and only with the other switches set", async () => {
  const { simpleChatStatus, simpleChatEnabled } = await import("@/lib/simple-chat/flag");
  const prod = { VERCEL: "1", DEARPOLICY_SIMPLE_CHAT: "1", DEARPOLICY_SIMPLE_CHAT_ALLOW_PRODUCTION: "1", DEARPOLICY_ALPHA_ACCOUNTS: "alpha-1" };
  const all = env({ ...prod, DEARPOLICY_SIMPLE_CHAT_ALL_ACCOUNTS: "1" });
  assert.equal(simpleChatEnabled(env(prod), "new-household"), false, "without the switch: alpha only, as before");
  assert.equal(simpleChatEnabled(all, "new-household"), true);
  assert.match(simpleChatStatus(all, "new-household").reason, /every account/);
  assert.equal(simpleChatEnabled(all, "alpha-1"), true, "the alpha household keeps it");
  assert.equal(simpleChatEnabled(env({ ...prod, DEARPOLICY_ALPHA_ACCOUNTS: "", DEARPOLICY_SIMPLE_CHAT_ALL_ACCOUNTS: "1" }), "new-household"), true, "an empty alpha list does not matter");
  for (const none of [null, undefined, "", "  "]) assert.equal(simpleChatEnabled(all, none), false, "no account: " + JSON.stringify(none));
  assert.equal(simpleChatEnabled(env({ VERCEL: "1", DEARPOLICY_SIMPLE_CHAT_ALL_ACCOUNTS: "1" }), "new-household"), false, "DEARPOLICY_SIMPLE_CHAT unset");
  assert.equal(simpleChatEnabled(env({ VERCEL: "1", DEARPOLICY_SIMPLE_CHAT: "1", DEARPOLICY_SIMPLE_CHAT_ALL_ACCOUNTS: "1" }), "new-household"), false, "production switch unset");
  assert.equal(simpleChatEnabled(env({ ...prod, DEARPOLICY_SIMPLE_CHAT_ALL_ACCOUNTS: "0" }), "new-household"), false, "0 is off");
  assert.equal(simpleChatEnabled(env({ ...prod, DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS: "1" }), "new-household"), false, "the table's own switch never opens the chat");
});

test("a household that chatted on the earlier path continues the same conversation on the simple chat", async () => {
  const db = await installDatabase();
  const A = "00000000-0000-0000-0000-0000000c0001", P = "76000000-0000-4000-8000-000000000001";
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household')", [A]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Farah Aziz','self')", [P, A]);
  const conv = (await db.query<{ id: string }>("INSERT INTO chat_conversations(account_id,family_member_id,title) VALUES($1,$2,'Hospital cover') RETURNING id", [A, P])).rows[0].id;
  // An earlier turn answered by the earlier chat path: its answer is stored as answer_json.
  await db.query("INSERT INTO chat_messages(account_id,family_member_id,conversation_id,role,content) VALUES($1,$2,$3,'user','What does my hospital plan pay per day?')", [A, P, conv]);
  await db.query("INSERT INTO chat_messages(account_id,family_member_id,conversation_id,role,content,answer_json) VALUES($1,$2,$3,'assistant','RM200 a day',$4)",
    [A, P, conv, JSON.stringify({ summary: "Your Example Takaful hospital plan pays RM200 a day in hospital.", nextSteps: [], questions: [] })]);

  Object.assign(process.env, { DEARPOLICY_SIMPLE_CHAT: "1", DEARPOLICY_SIMPLE_CHAT_ALL_ACCOUNTS: "1", DEARPOLICY_ALPHA_ACCOUNTS: "someone-else" });
  const { simpleChatEnabled } = await import("@/lib/simple-chat/flag");
  assert.equal(simpleChatEnabled(process.env, A), true, "not on the alpha list, on by the switch");
  const { prepareSimpleChat, conversationTurns } = await import("@/lib/simple-chat/hook");
  const ctx = await prepareSimpleChat({ accountId: A, familyMemberId: P, question: "And for intensive care?", conversationId: conv } as never);
  assert.equal(ctx.conversation.id, conv, "the same conversation, not a new one");
  assert.equal(ctx.chatPath, "simple");
  const turns = await conversationTurns(A, conv);
  assert.deepEqual(turns.map((t) => t.role), ["user", "assistant"]);
  assert.match(turns[1].text, /RM200 a day in hospital/, "the earlier answer is carried into the simple chat's history");
  assert.equal(fetches, 0);
});
