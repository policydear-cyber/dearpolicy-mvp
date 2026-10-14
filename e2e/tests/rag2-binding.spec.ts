import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * V1.4 BROWSER TEST: person / product / benefit binding on the binding household (scripts/fixtures/rag2-binding,
 * seeded by `node --import tsx e2e/support/seed-rag2-stress-report.ts --household binding`), through the ACTUAL chat
 * page and /api/chat. Server: e2e/support/rag2-loop-server.ts with E2E_RAG2_HOUSEHOLD=binding; the scripted stand-in
 * for the model plays scripts/fixtures/rag2-binding/conversations.ts. Plumbing evidence, not a model result.
 */
const INTERNAL = /\b(?:e\d+|v\d+|vb\d+_\d+|r\d+)\b(?=[,.)\s])|evidence_id|value_id|select_table_value|final_answer|person_benefits/;
async function scenario(request: APIRequestContext, id: string): Promise<string[]> {
  const r = await request.post("/__rag2stress/scenario", { data: { id } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).messages as string[];
}
async function last(request: APIRequestContext) { return (await (await request.get("/__rag2stress/last")).json()) as { message: { answer_json: any } | null; state: any }; }
async function send(page: Page, text: string) {
  const answers = page.locator(".message.assistant:not(:has(.thinking))");
  const before = await answers.count();
  await page.getByLabel("Message to DearPolicy").fill(text);
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  const visible = (await answers.last().innerText()).trim();
  expect(visible).not.toMatch(INTERNAL);
  return visible;
}
test.describe.configure({ mode: "serial" });

test("B1 death after a reported accident: Darren's own Term Life and PA amounts with their dates, the condition, ONE question (the accident date); no person's name as a product; no unrelated insurer; no invented requirement", async ({ page, request }) => {
  const [m] = await scenario(request, "B1");
  await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
  const v = await send(page, m);
  expect(v).toMatch(/Group Term Life sum assured as S\$1,000,000 as of 6 October 2022/);
  expect(v).toMatch(/Group Personal Accident sum insured as S\$600,000 as of 6 October 2022/);
  expect(v).toMatch(/within 365 days of that Accident/);
  expect(v).toMatch(/On what date did the accident happen\?/);
  expect((v.match(/\?/g) ?? []).length).toBe(1);
  expect(v).not.toMatch(/lists separate|Tan Kai Ming, Darren amount|Lumen General|S\$1,600,000/);
  const s = await last(request);
  expect(s.state?.ragLoop?.pending?.factKey).toBe("accident_date");
});

test("B2 switching from Michelle (her endorsement amends the certificate amount from its effective date) back to Darren (his own PA amount)", async ({ page, request }) => {
  const [m1, m2] = await scenario(request, "B2");
  await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
  const v1 = await send(page, m1);
  expect(v1).toMatch(/S\$400,000 with effect from 1 January 2024[^.]*S\$300,000 as of 6 October 2022/);
  expect(v1).not.toMatch(/S\$600,000|S\$1,000,000/);
  const v2 = await send(page, m2);
  expect(v2).toMatch(/Darren[^.]*S\$600,000/);
  expect(v2).not.toMatch(/S\$300,000|S\$400,000/);
});
