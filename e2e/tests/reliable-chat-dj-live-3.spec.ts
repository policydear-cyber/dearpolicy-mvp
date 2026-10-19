import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";

/**
 * dj-live-3 answer completeness: the recorded DI turn of the live run (code f2fe6a6: the model asked "What was Daniel's exact
 * date of death?" and gave no next step) replayed verbatim through the REAL chat page and /api/chat on the repaired code.
 * No model call. Displayed = saved = reopened (page reload from the history route), next steps included.
 */
async function scenario(request: APIRequestContext, id: string): Promise<string[]> {
  const r = await request.post("/__rag2stress/scenario", { data: { id } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).messages as string[];
}
async function last(request: APIRequestContext) { return (await (await request.get("/__rag2stress/last")).json()) as { message: { answer_json: any; conversation_id: string } | null; state: any }; }
const norm = (t: string) => t.replace(/[\s ]+/g, " ").trim();
const savedLines = (a: any): string[] => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...uniqueSteps(a.nextSteps)].filter(Boolean).flatMap((t: string) => String(t).split("\n")).map(norm).filter(Boolean);

test("DI3: the recorded dj-live-3 turn on the repaired code -- dated Term Life kept, no accident-only amount, the insurer-contact step, no unneeded question; displayed = saved = reopened", async ({ page, request }) => {
  const [u1] = await scenario(request, "DI3");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const answers = page.locator(".message.assistant:not(:has(.thinking))");
  await page.getByLabel("Message to DearPolicy").fill(u1);
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(1, { timeout: 180_000 });
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  const shown = (await answers.last().innerText()).trim();
  console.log("--- DI3 DISPLAYED:\n" + shown);
  const s = await last(request); const saved = s.message!.answer_json;
  const d = norm(shown);
  for (const l of savedLines(saved)) expect(d, `saved line not displayed: ${l}`).toContain(l);
  expect(uniqueSteps(saved.nextSteps).length).toBeGreaterThan(0);
  for (const st of uniqueSteps(saved.nextSteps)) expect(d, `next step not displayed: ${st}`).toContain(norm(st));
  expect(shown).toMatch(/Group Term Life of S\$1,000,000 as of 6 October 2022/);
  expect(shown).toMatch(/does not confirm cover on his date of death/);
  expect(shown).not.toMatch(/600,000/);
  expect(shown).toMatch(/Contact Aldermoor Life Ltd/);
  expect(shown).toMatch(/to ask what it needs for a claim/);
  expect(shown).toMatch(/“last week”; I have not turned that into an exact day/);
  expect(shown).not.toMatch(/exact date of death\?/);
  expect(saved.questions ?? []).toHaveLength(0);
  expect(s.state?.ragLoop?.turns?.at(-1)?.outcome).toBe("final_answer");
  // reopened: the history route through a page reload shows the same answer, steps included
  await page.reload();
  const reopened = page.locator(".message.assistant").last();
  await expect(reopened).toContainText("Group Term Life", { timeout: 60_000 });
  const again = norm(await reopened.innerText());
  for (const l of savedLines(saved)) expect(again, `reopened chat lost: ${l}`).toContain(l);
  await expect(page.getByTestId("next-step-item").first()).toContainText("Contact Aldermoor Life Ltd");
});
