import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * INTEGRATION TEST (browser): the conversational RAG loop through the ACTUAL chat page and /api/chat, with the
 * conversation persisted in PostgreSQL. Server: e2e/support/rag2-loop-server.ts (next dev in-process,
 * DEARPOLICY_RAG_LOOP=1, the scripted TEST model from scripts/fixtures/rag2-adv chosen per test). Data: the synthetic
 * households seeded by e2e/support/seed-rag2-conversation.ts (the server signs in as household Tan).
 * The scripted model plays the model; what is asserted is what DearPolicy shows and saves -- REQUIRED behaviour, so
 * on the base commit several tests fail (see REVIEW.md).
 *
 * Run (local Postgres with the schema applied, Chromium available):
 *   export DATABASE_URL=postgres://postgres:postgres@localhost:5432/dearpolicy_e2e DEARPOLICY_RAG_LOOP=1
 *   node --import tsx e2e/support/seed-rag2-conversation.ts
 *   PORT=3300 node --import tsx e2e/support/rag2-loop-server.ts &      # wait for "rag2 loop test server"
 *   npm run e2e:rag2-conversation
 *   node --import tsx e2e/support/seed-rag2-conversation.ts --cleanup
 */
const MONEY = /S\$\s?\d/;
const INTERNAL = /\b(?:e\d+|v\d+|r\d+)\b(?=[,.)\s])|evidence_id|value_id|result_id|select_table_value|final_answer|ask_user/;

async function scenario(request: APIRequestContext, id: string): Promise<string[]> {
  const r = await request.post("/__rag2adv/scenario", { data: { id } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).messages as string[];
}
async function last(request: APIRequestContext) {
  const r = await request.get("/__rag2adv/last");
  return (await r.json()) as { message: { content: string; answer_json: any } | null; state: any; otherHouseholdMessages: number };
}
async function newChat(page: Page) {
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
}
async function send(page: Page, text: string) {
  const answers = page.locator(".message.assistant:not(:has(.thinking))");
  const before = await answers.count();
  await page.getByLabel("Message to DearPolicy").fill(text);
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  const answer = answers.last();
  return { answer, visible: (await answer.innerText()).trim() };
}

test.describe.configure({ mode: "serial" });

test("S1 factual: Ethan's fracture benefit from his own (Child) column, cited", async ({ page, request }) => {
  const [m] = await scenario(request, "S1");
  await newChat(page);
  const t = await send(page, m);
  expect(t.visible).toMatch(/S\$600 per fracture/);
  expect(t.visible).not.toMatch(/1,000/);
  expect(t.visible).not.toMatch(INTERNAL);
  const saved = await last(request);
  expect(saved.message?.answer_json?.figureBindings?.some((b: any) => b.value === 600 && b.column === "Child")).toBeTruthy();
  expect(saved.state?.ragLoop?.turns?.at(-1)?.gate ?? []).toEqual([]);
});

test("S2 broken arm: asks how it happened; never records 'accident' from 'broke his arm'; report is not reviewed evidence", async ({ page, request }) => {
  const [m1, m2] = await scenario(request, "S2");
  await newChat(page);
  const t1 = await send(page, m1);
  expect(t1.visible).toMatch(/accident|illness|how/i);
  expect(t1.visible).not.toMatch(MONEY);
  expect((t1.visible.match(/\?/g) ?? []).length).toBeLessThanOrEqual(2); // the one question (summary + its card)
  const s1 = await last(request);
  expect(s1.state?.ragLoop?.claim?.facts?.cause?.value).not.toBe("accident");
  const t2 = await send(page, m2);
  expect(t2.visible).toMatch(/S\$600 per fracture/);
  expect(t2.visible).not.toMatch(/medically confirmed|approved/i);
});

test("S3 hospital income per complete 24 hours: times asked one at a time; nights never become payable days", async ({ page, request }) => {
  const [m1, m2, m3] = await scenario(request, "S3");
  await newChat(page);
  const t1 = await send(page, m1);
  expect(t1.visible).toMatch(/admitted/i); expect(t1.visible).not.toMatch(MONEY);
  const t2 = await send(page, m2);
  expect(t2.visible).toMatch(/discharged/i); expect(t2.visible).not.toMatch(MONEY);
  const t3 = await send(page, m3);
  expect(t3.visible).not.toMatch(/S\$270/);
  expect(t3.visible).toMatch(/Indicative estimate[^.]*S\$180/);
  expect(t3.visible).not.toMatch(/payout/i);
});

test("S4 side question about the speaker: answered for Marcus, then Ethan's pending question re-asked, Ethan's facts kept", async ({ page, request }) => {
  const [m1, m2] = await scenario(request, "S4");
  await newChat(page);
  await send(page, m1);
  const t2 = await send(page, m2);
  expect(t2.visible).toMatch(/S\$2,500 per policy year/);
  expect(t2.visible).toMatch(/bill/i);
  const s = await last(request);
  expect(s.state?.ragLoop?.claim?.subjectId).toBe("73000000-0000-4000-8000-000000000003");
  expect(s.state?.ragLoop?.claim?.facts?.injury?.value).toBe("broken arm");
});

test("S7 min(bill, limit) - excess survives the save-time gate and is shown as an indicative estimate", async ({ page, request }) => {
  const [m] = await scenario(request, "S7");
  await newChat(page);
  const t = await send(page, m);
  expect(t.visible).toMatch(/Indicative estimate[^.]*S\$1,100/);
  expect(t.visible).toMatch(/not a payout/i);
  const s = await last(request);
  expect(s.message?.answer_json?.computations?.some((c: any) => c.result.value === 1100)).toBeTruthy();
});

test("S9 another household's member, policy and figure never appear; nothing is written to the other household", async ({ page, request }) => {
  const [m] = await scenario(request, "S9");
  await newChat(page);
  const t = await send(page, m);
  expect(t.visible).not.toMatch(/S\$120|FamilyFirst|Insured Child/);
  const s = await last(request);
  expect(s.otherHouseholdMessages).toBe(0);
  expect(s.state?.ragLoop?.claim ?? null).toBeNull();
});

test("X1 prompt injection printed in a policy page is never repeated as an answer", async ({ page, request }) => {
  const [m] = await scenario(request, "X1");
  await newChat(page);
  const t = await send(page, m);
  expect(t.visible).not.toMatch(/pre-approved|50,000|will receive/i);
});
