import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * PR #69: a reopened chat marks an answer that no longer stands, on the anonymised actual-library household
 * (E2E_RAG2_HOUSEHOLD=actuallib, scripted moves of scripts/fixtures/reliable-chat/actual-lib-conversations.ts), through
 * the REAL chat page, /api/chat, the Documents page and the history route. Synthetic data only, no model call.
 *
 *   SR1 tibia -> hip correction, reloaded: the tibia answer is replaced by the "replaced" note, shows no figure; the
 *       hip answer below keeps its S$3,750.
 *   SR2 an answer about Grace, then Grace is removed from the document it used, the chat reopened: her answer is the
 *       "removed" note with no figure; Daniel's answer on the same document is untouched (control); ticking Grace again
 *       brings her answer back.
 */
async function scenario(request: APIRequestContext, id: string): Promise<string[]> {
  const r = await request.post("/__rag2stress/scenario", { data: { id } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).messages as string[];
}
async function send(page: Page, text: string) {
  const answers = page.locator(".message.assistant:not(:has(.thinking))");
  const before = await answers.count();
  await page.getByLabel("Message to DearPolicy").fill(text);
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  return (await answers.last().innerText()).trim();
}
/** Reopens the chat that holds `first` (the user's first message): a reload restores it; otherwise it is opened from the history list. */
async function reopen(page: Page, first: string) {
  await page.goto("/chat");
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  const mine = page.locator(".message.user").filter({ hasText: first.slice(0, 40) });
  if (!(await mine.first().isVisible().catch(() => false))) {
    await expect(async () => {
      await page.locator("details.chat-history").evaluate((d) => { (d as HTMLDetailsElement).open = true; });
      await page.locator(".history-open").first().waitFor({ state: "visible", timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.locator(".history-open").first().click();
  }
  await expect(mine.first()).toBeVisible({ timeout: 60_000 });
}
/** The assistant answer that follows the user's message `user`. */
const answerAfter = (page: Page, user: string) =>
  page.locator(".message.user").filter({ hasText: user.slice(0, 40) }).first().locator("xpath=following-sibling::*[contains(concat(' ', normalize-space(@class), ' '), ' assistant ')][1]");
const FIGURE = /S\$\s?[\d,]+|\b\d+%/;

/** The covers chip for one person on the 2024 Product Summary's card; opens the picker first if it is folded to one line. */
async function chip(page: Page, who: string) {
  await page.goto("/policies");
  const card = page.locator(".document-card").filter({ hasText: "Group Insurance Product Summary" }).filter({ hasNotText: "(2022)" }).first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  const change = card.getByTestId("covers-picker").getByRole("button", { name: "Change" });
  if (await change.isVisible().catch(() => false)) await change.click();
  return card.locator(".declare-owner button").filter({ hasText: who }).first();
}
async function setCovered(page: Page, who: string, on: boolean) {
  const c = await chip(page, who);
  if ((await c.getAttribute("aria-pressed")) !== String(on)) await c.click();
  await expect(c).toHaveAttribute("aria-pressed", String(on), { timeout: 30_000 });
  await expect(page.getByTestId("library-notice")).toContainText("Saved", { timeout: 30_000 });
}

test.describe.serial("reopened answers that no longer stand", () => {
  test("SR1: tibia -> hip correction, reloaded: the tibia answer is replaced and shows no figure", async ({ page, request }) => {
    const [u1, u2] = await scenario(request, "SA2");
    await page.goto("/chat");
    await page.getByRole("button", { name: "New chat" }).click();
    const a1 = await send(page, u1);
    expect(a1, "setup: the tibia answer shows its figure before the correction").toMatch(/S\$2,500/);
    const a2 = await send(page, u2);
    expect(a2).toMatch(/conditional illustration is S\$3,750/);

    await page.reload();
    await reopen(page, u1);
    const old = answerAfter(page, u1);
    await expect(old.getByTestId("answer-invalidated")).toHaveAttribute("data-reason", "superseded", { timeout: 60_000 });
    await expect(old.getByTestId("answer-invalidated")).toContainText("Replaced. This answer was replaced by the corrected answer below.");
    console.log(`--- SR1 replaced answer as displayed:\n${await old.innerText()}`);
    // F69-1 (27c78b3): the stored text of the old answer was still shown above the note. Its text is now the notice.
    await expect(old).toContainText("This earlier answer was replaced by the corrected answer below");
    await expect(old).not.toContainText("two different answers");
    expect.soft(await old.innerText(), "the replaced answer shows no figure").not.toMatch(FIGURE);
    const fixed = answerAfter(page, u2);
    await expect(fixed).toContainText("conditional illustration is S$3,750");
    await expect(fixed.getByTestId("answer-invalidated")).toHaveCount(0);
  });

  test("SR2: Grace removed from the document her answer used, chat reopened: the 'removed' note, no figure; ticked again, it comes back", async ({ page, request }) => {
    const [u1, u2] = await scenario(request, "SA6");
    await page.goto("/chat");
    await page.getByRole("button", { name: "New chat" }).click();
    const d = await send(page, u1);
    expect(d, "setup: Daniel's answer shows a figure").toMatch(/S\$[\d,]+/);
    const g = await send(page, u2);
    expect(g, "setup: Grace's answer shows a figure").toMatch(/S\$3,750/);

    await setCovered(page, "Grace", false);
    await reopen(page, u1);
    const grace = answerAfter(page, u2);
    await expect(grace.getByTestId("answer-invalidated")).toHaveAttribute("data-reason", "person_unlinked", { timeout: 60_000 });
    await expect(grace.getByTestId("answer-invalidated")).toContainText("Out of date. Someone this answer was about has since been removed from the document it relied on.");
    console.log(`--- SR2 out-of-date answer as displayed:\n${await grace.innerText()}`);
    await expect(grace).toContainText("This answer was about someone who has since been removed from the document it relied on");
    await expect(grace).not.toContainText("conditional illustration");
    expect.soft(await grace.innerText(), "the out-of-date answer shows no figure").not.toMatch(FIGURE);
    const daniel = answerAfter(page, u1);
    await expect(daniel.getByTestId("answer-invalidated"), "control: Daniel is still covered by the document").toHaveCount(0);
    expect(await daniel.innerText()).toMatch(/S\$[\d,]+/);

    await setCovered(page, "Grace", true);
    await reopen(page, u1);
    const back = answerAfter(page, u2);
    await expect(back).toContainText("S$3,750", { timeout: 60_000 });
    await expect(back.getByTestId("answer-invalidated")).toHaveCount(0);
  });
});
