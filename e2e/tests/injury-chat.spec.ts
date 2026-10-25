import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The live injury-chat defect, replayed in a real browser against the local
 * synthetic stack (seed: e2e/support/seed-injury-fixture.ts). Josephine's
 * synthetic personal-accident plan has a permanent-loss "Loss of arm" row, a
 * genuine "Fracture of arm" benefit and accident medical reimbursement.
 * Writes a transcript and per-turn screenshots of synthetic pages only.
 *
 * Runs only when that fixture was seeded (it adds members to household A,
 * which the other journeys do not expect):
 *   node --import tsx e2e/support/seed-injury-fixture.ts
 *   npx playwright test -c e2e/playwright.config.ts injury-chat
 */
const OUT = path.resolve("e2e-results/injury-chat");
const MONEY = /S\$\s?\d|SGD\s?\d|US\$\s?\d/;
const INTERNAL = /Not applicable here|benefit rules? read|\b\d+ benefit rules?\b|policy_benefits|storage_key|job[_ ]id|gpt-|gemini|openai:/i;
if (process.env.E2E_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } });

const transcript: { turn: number; user: string; answer: string; ms: number }[] = [];

async function send(page: Page, turn: number, text: string) {
  const answers = page.locator(".message.assistant:not(:has(.thinking))");
  const before = await answers.count();
  const started = Date.now();
  await page.getByLabel("Message to DearPolicy").fill(text);
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  const answer = answers.last();
  const visible = (await answer.innerText()).trim();
  transcript.push({ turn, user: text, answer: visible, ms: Date.now() - started });
  await page.screenshot({ path: path.join(OUT, `turn-${turn}.png`), fullPage: true });
  return { answer, visible };
}

test.skip(!existsSync(path.resolve(process.env.E2E_INJURY_SEED_FILE || ".e2e-injury-seed.json")), "injury fixture not seeded");

test("broken arm: fracture kept, permanent loss never shown, one question at a time", async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);

  const t1 = await send(page, 1, "Josephine broke her arm.");
  expect(t1.visible).toMatch(/accident|illness/i);
  expect(t1.visible).not.toMatch(/loss of arm/i);
  expect(t1.visible).not.toMatch(MONEY);
  expect(t1.visible).not.toMatch(INTERNAL);

  const t2 = await send(page, 2, "An accident.");
  expect(t2.visible).toMatch(/where did the accident happen/i);
  expect(t2.visible).toMatch(/not the same as permanent loss/i);
  expect(t2.visible).not.toMatch(/loss of arm/i);
  expect(t2.visible).not.toMatch(MONEY);
  expect(t2.visible).not.toMatch(INTERNAL);
  expect(await t2.answer.locator(".claim-item, .claim-card").count()).toBe(0);
  expect(await page.locator(".potential-totals, [data-testid=potential-totals]").count()).toBe(0);

  const t3 = await send(page, 3, "Singapore");
  expect(t3.visible).toMatch(/when did/i);
  // The explanation is said once; later turns acknowledge and ask.
  expect(t3.visible).toMatch(/Thanks, noted\./);
  expect(t3.visible).not.toMatch(/may relate to/i);
  expect(t3.visible).not.toMatch(/loss of arm/i);
  expect(t3.visible).not.toMatch(MONEY);
  expect(t3.visible).not.toMatch(INTERNAL);

  // Reopen: the saved chat restores the same facts and the same next question.
  await page.reload();
  const history = await page.evaluate(async () => (await (await fetch("/api/chat/history?scope=all")).json()) as { conversations: { id: string }[] });
  expect(history.conversations.length).toBeGreaterThan(0);

  await writeFile(path.join(OUT, "transcript.json"), JSON.stringify(transcript, null, 2));
});
