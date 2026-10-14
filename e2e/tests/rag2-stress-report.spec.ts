import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * V1.3 BROWSER TEST: the structures of the 14 October live stress-test report, through the ACTUAL chat page and
 * /api/chat, persisted in PostgreSQL. Household: scripts/fixtures/rag2-stress/report-household.ts (seeded by
 * e2e/support/seed-rag2-stress-report.ts). Server: e2e/support/rag2-loop-server.ts with E2E_RAG2_HOUSEHOLD=report; the
 * scripted stand-in for the model plays scripts/fixtures/rag2-stress/report-conversations.ts (chosen per test). What is
 * asserted is what DearPolicy shows and saves -- plumbing evidence, not a model result.
 *
 *   node --import tsx e2e/support/seed-rag2-stress-report.ts
 *   E2E_RAG2_HOUSEHOLD=report DEARPOLICY_RAG_LOOP=1 PORT=3300 node --import tsx e2e/support/rag2-loop-server.ts &
 *   npm run e2e:rag2-stress-report
 */
const INTERNAL = /\b(?:e\d+|v\d+|vb\d+_\d+|r\d+)\b(?=[,.)\s])|evidence_id|value_id|result_id|select_table_value|final_answer|ask_user/;

async function scenario(request: APIRequestContext, id: string): Promise<string[]> {
  const r = await request.post("/__rag2stress/scenario", { data: { id } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).messages as string[];
}
async function last(request: APIRequestContext) {
  return (await (await request.get("/__rag2stress/last")).json()) as { message: { content: string; answer_json: any } | null; state: any };
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
  const visible = (await answers.last().innerText()).trim();
  expect(visible).not.toMatch(INTERNAL);
  return visible;
}
const calc = (saved: Awaited<ReturnType<typeof last>>, name: string) => ((saved.message?.answer_json?.calculations ?? []) as any[]).find((r) => r.calculator === name);

test.describe.configure({ mode: "serial" });

test("R1 household document inventory: per person, insurer and role; pet documents linked to nobody; the unreadable scan; no figures", async ({ page, request }) => {
  const [m] = await scenario(request, "R1");
  await newChat(page);
  const v = await send(page, m);
  for (const x of [/Marcus:/, /Serena:/, /Public Officers Group Scheme - Certificate/, /Kestrel Assurance/, /personal policy document/, /Summary of Benefits/, /reference wording/, /Not linked to anyone[^\n]*PawSafe Pet Insurance/, /scan-0042\.jpg could not be read/]) expect(v).toMatch(x);
  expect(v).not.toMatch(/S\$\d/);
  expect(v).not.toMatch(/Lee, Marcus|S\$700,000/);
});

test("R2 direct Personal Accident amount, then the household's wrong amount is corrected", async ({ page, request }) => {
  const [m1, m2] = await scenario(request, "R2");
  await newChat(page);
  const v1 = await send(page, m1);
  expect(v1).toMatch(/S\$450,000[^.]*15 September 2023/);
  expect(v1).not.toMatch(/S\$1,200,000/);
  const v2 = await send(page, m2);
  expect(v2).toMatch(/^No\b/m);
  expect(v2).toMatch(/S\$450,000/);
  expect(v2).toMatch(/S\$1,200,000[^.;]*Term Life/);
  expect(v2).not.toMatch(/Personal Accident[^.;]*is S\$1,200,000/);
});

test("R3 percentage of a fixed benefit limit (S$2,500) versus percentage of the Sum Insured (S$225,000), each saved with its own base", async ({ page, request }) => {
  const [m1, m2] = await scenario(request, "R3");
  await newChat(page);
  const v1 = await send(page, m1);
  expect(v1).toMatch(/\bIf\b[^.]*S\$2,500/);
  expect(v1).not.toMatch(/S\$225,000/);
  const r1 = calc(await last(request), "lump_sum");
  expect(r1?.result?.value).toBe(2500);
  expect(r1.operands.some((o: any) => o.id === "benefit_limit" && o.value === 5000)).toBeTruthy();
  expect(r1.operands.some((o: any) => o.id === "sum_insured")).toBeFalsy();
  const v2 = await send(page, m2);
  expect(v2).toMatch(/S\$225,000/);
  const r2 = calc(await last(request), "lump_sum");
  expect(r2?.result?.value).toBe(225000);
  expect(r2.operands.some((o: any) => o.id === "sum_insured" && o.value === 450000)).toBeTruthy();
  expect(r2.operands.some((o: any) => o.id === "benefit_limit")).toBeFalsy();
});

test("R4 an invalid date is asked about, then the valid correction decides the 11th-day waiting period with no amount", async ({ page, request }) => {
  const [m1, m2] = await scenario(request, "R4");
  await newChat(page);
  const v1 = await send(page, m1);
  expect(v1).toMatch(/30 February isn['’]t a calendar date/);
  expect(calc(await last(request), "hospital_cash")).toBeFalsy();
  const v2 = await send(page, m2);
  expect(v2).toMatch(/11th day/);
  expect(v2).toMatch(/does not reach/);
  expect(v2).not.toMatch(/S\$0\b/);
  const s = await last(request);
  expect(String(s.state?.ragLoop?.claim?.facts?.admission_datetime?.value)).toMatch(/2026-02-28/);
  expect(s.state?.ragLoop?.claim?.facts?.discharge_datetime?.previous?.length ?? 0).toBe(0);
});

test("R5 the subject switches between two people and back, each figure bound to that person", async ({ page, request }) => {
  const [m1, m2, m3] = await scenario(request, "R5");
  await newChat(page);
  const subjects: string[] = [];
  const v1 = await send(page, m1); subjects.push(((await last(request)).message?.answer_json?.figureBindings ?? [])[0]?.subjectId);
  const v2 = await send(page, m2); subjects.push(((await last(request)).message?.answer_json?.figureBindings ?? [])[0]?.subjectId);
  const v3 = await send(page, m3); subjects.push(((await last(request)).message?.answer_json?.figureBindings ?? [])[0]?.subjectId);
  expect(v1).toMatch(/Serena[^.]*Personal Accident[^.]*S\$450,000/);
  expect(v2).toMatch(/Term Life[^.]*S\$1,200,000/);
  expect(v3).toMatch(/Serena[^.]*Term Life[^.]*S\$1,200,000/);
  expect(subjects).toEqual(["7e000000-0000-4000-8000-000000000002", "7e000000-0000-4000-8000-000000000001", "7e000000-0000-4000-8000-000000000002"]);
});

test("R6 the Term Life figure stated as Personal Accident, repair unavailable: the figure is not shown, the certificate and its products are, and the answer is not a generic refusal", async ({ page, request }) => {
  const [m] = await scenario(request, "R6");
  await newChat(page);
  const v = await send(page, m);
  expect(v).not.toMatch(/S\$1,200,000/);
  expect(v).not.toMatch(/^I couldn[’']t confirm an answer to that from your documents\.?$/);
  expect(v).toMatch(/Public Officers Group Scheme - Certificate[^.]*Group Term Life[^.]*Group Personal Accident/);
  // Incomplete by design of this control: the Personal Accident amount is not given.
  expect(v).not.toMatch(/S\$450,000/);
});
