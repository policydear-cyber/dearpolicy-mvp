/** Scripted tests: a chat page that is behind its own chat (one tab, an answer finished late) is brought up to date and the
 * message sent once more, instead of every send being refused as "updated in another tab" (Live tester, 25 Nov).
 * No model, network or database.
 *   npm run -s chat:stale-revision-resend-test */
import assert from "node:assert/strict";
import { sendWithResync } from "@/components/chat-send-failure";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
type Reply = { status: number; data: { error?: unknown; code?: unknown; jobId?: string } };
const stale: Reply = { status: 409, data: { error: "This chat changed. Reopen it before sending another message." } };
const ok: Reply = { status: 200, data: { jobId: "j1" } };

(async () => {
  await test("S1 a stale revision is refreshed and the message goes once more with the new revision", async () => {
    const sent: Array<number | null> = []; let shown = 0;
    const out = await sendWithResync(async (r) => { sent.push(r); return r === 3 ? ok : stale; }, 1, async () => ({ revision: 3, show: () => { shown++; } }));
    assert.deepEqual(sent, [1, 3]); assert.equal(shown, 1); assert.equal(out.status, 200); assert.equal(out.resynced, true);
  });
  await test("S2 still refused after the refresh: the refusal is reported, and there is no third send", async () => {
    const sent: Array<number | null> = [];
    const out = await sendWithResync(async (r) => { sent.push(r); return stale; }, 1, async () => ({ revision: 3, show: () => {} }));
    assert.deepEqual(sent, [1, 3]); assert.equal(out.status, 409);
  });
  await test("S3 an empty household (no_family_members) is never retried", async () => {
    let loads = 0; const sent: Array<number | null> = [];
    const out = await sendWithResync(async (r) => { sent.push(r); return { status: 409, data: { error: "Add a family member first.", code: "no_family_members" } } as Reply; }, 1, async () => { loads++; return { revision: 3, show: () => {} }; });
    assert.deepEqual(sent, [1]); assert.equal(loads, 0); assert.equal(out.resynced, false);
  });
  await test("S4 a first message (no chat yet) and other errors are never retried", async () => {
    const sent: Array<number | null> = [];
    await sendWithResync(async (r) => { sent.push(r); return stale; }, null, async () => ({ revision: 3, show: () => {} }));
    await sendWithResync(async (r) => { sent.push(r); return { status: 500, data: { error: "x" } } as Reply; }, 1, async () => ({ revision: 3, show: () => {} }));
    assert.deepEqual(sent, [null, 1]);
  });
  await test("S5 an unreadable fresh chat, or the same revision, keeps the original refusal", async () => {
    const sent: Array<number | null> = [];
    const a = await sendWithResync(async (r) => { sent.push(r); return stale; }, 1, async () => null);
    const b = await sendWithResync(async (r) => { sent.push(r); return stale; }, 1, async () => { throw new Error("offline"); });
    const c = await sendWithResync(async (r) => { sent.push(r); return stale; }, 1, async () => ({ revision: 1, show: () => {} }));
    assert.deepEqual(sent, [1, 1, 1]); assert.ok([a, b, c].every((o) => o.status === 409 && !o.resynced));
  });
  await test("S6 success first time: one send, nothing loaded", async () => {
    let loads = 0; const sent: Array<number | null> = [];
    const out = await sendWithResync(async (r) => { sent.push(r); return ok; }, 2, async () => { loads++; return null; });
    assert.deepEqual(sent, [2]); assert.equal(loads, 0); assert.equal(out.resynced, false);
  });
  console.log(`stale-revision-resend: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
})();
