import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";

/**
 * V1.5 BROWSER TEST: the live verification's inventory failure (the composed answer listed the unreadable upload, the
 * saved / displayed answer did not), through the ACTUAL chat page and /api/chat on the live-library household, seeded
 * by `node --import tsx e2e/support/seed-rag2-stress-report.ts --household livelib --scan-name "Claim S$5,000 receipt
 * 05-03-2024.pdf"` (a file name the save-time figure gate used to read as an uncited amount). Server:
 * e2e/support/rag2-loop-server.ts with E2E_RAG2_HOUSEHOLD=livelib. Plumbing evidence, not a model result.
 */
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
  return (await answers.last().innerText()).trim();
}
const norm = (t: string) => t.replace(/[\s ]+/g, " ").trim();

test("L1 inventory: the unreadable upload's status line is composed, saved verbatim and displayed -- even with a file name that looks like an amount", async ({ page, request }) => {
  const [m] = await scenario(request, "L1");
  await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
  const shown = await send(page, m);
  const s = await last(request);
  const turn = s.state?.ragLoop?.turns?.at(-1);
  const line = (turn?.composed as string[]).find((c) => c.includes("Claim S$5,000 receipt 05-03-2024.pdf"));
  expect(line, JSON.stringify(turn?.composed)).toBeTruthy();
  const saved = [s.message!.answer_json.summary, ...s.message!.answer_json.details];
  expect(saved).toContain(line);
  expect(norm(shown)).toContain(norm(line!));
  expect(turn?.gate ?? []).toEqual([]);
});

test("L2 next steps: the full saved list is displayed in order, each step once -- not only the first", async ({ page, request }) => {
  const [m] = await scenario(request, "L2");
  await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
  await send(page, m);
  const saved = ((await last(request)).message!.answer_json.nextSteps ?? []) as string[];
  const visible = (await page.locator(".message.assistant:not(:has(.thinking))").last().locator("[data-testid=next-step-item]").allInnerTexts()).map(norm);
  console.log(`saved ${JSON.stringify(saved)}\nvisible ${JSON.stringify(visible)}`);
  expect(saved.length, "the saved answer keeps every step the composer kept").toBeGreaterThanOrEqual(3);
  expect(visible).toEqual(uniqueSteps(saved).map(norm));
  expect(visible.length).toBe(3);
});
