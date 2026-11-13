/**
 * Text typed into the chat box before the page has finished loading is kept and Send is ready (13 Nov: claim-journey
 * test 1 timed out with Send greyed out on #455 and #457). The page's scripts are held back so the box is filled first.
 */
import { test, expect } from "@playwright/test";

test("text typed before the chat page finishes loading keeps Send ready", async ({ page }) => {
  await page.route("**/_next/static/**/*.js", async (route) => { await new Promise((r) => setTimeout(r, 4_000)); await route.continue(); });
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  const box = page.getByLabel("Message to DearPolicy");
  await box.fill("What is the waiting period?");
  await expect(page.getByRole("button", { name: /send/i })).toBeEnabled({ timeout: 60_000 });
  await expect(box).toHaveValue("What is the waiting period?");
});
