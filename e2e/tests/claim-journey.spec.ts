/**
 * Synthetic browser claim journey (Phase 6). Real Chromium, real Next.js,
 * real PostgreSQL; the only stand-in is the deterministic model
 * (lib/ai/deterministic-model.ts), which cannot run in production.
 * Synthetic data only -- see e2e/support/seed-claim-fixture.ts.
 *
 * Covered here: asking "how much can I claim?" starts fact-finding without an
 * estimate; any policy-stated limit carries the approved label and notice
 * and is never totalled; no pre-review payout wording anywhere; the answer
 * is not readable from another household; reopening the saved chat re-serves
 * it through the same boundary. See e2e/README.md for what is not covered.
 */
import { test, expect, type Page } from "@playwright/test";
import { PREFIX } from "../support/synthetic";

const BASE_B = process.env.E2E_BASE_URL_B ?? "http://localhost:3001";
const FORBIDDEN = /potential payout|potential reimbursement|claimable amount|expected payout|estimated settlement|amount you will receive|approved amount|estimated claim amount/i;
const LIMIT_LABEL = "Policy-stated coverage limit";
const LIMIT_NOTICE = "This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.";

async function api<T = unknown>(page: Page, path: string): Promise<{ status: number; body: T }> {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { cache: "no-store" });
    const text = await res.text(); let body: unknown = text; try { body = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, body: body as never };
  }, path);
}

test.describe.serial("synthetic claim journey", () => {
  let page: Page;
  let conversationId = "";

  test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); });

  test("2-5. \"How much can I claim?\" starts fact-finding with no estimate; a policy-stated limit is labelled and never totalled", async () => {
    await page.goto("/chat");
    await page.getByLabel("Message to DearPolicy").fill(`${PREFIX}-Claimant here. I was diagnosed with stage 2 breast cancer. How much can I claim?`);
    await page.getByRole("button", { name: /send/i }).click();
    const answer = page.locator(".preliminary-assessment, .fact-finding").first();
    await expect(answer).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("preliminary-assessment")).toBeVisible();
    await expect(page.getByTestId("fact-finding")).toBeVisible();
    await expect(page.getByTestId("fact-finding")).toContainText(/Critical illness/i);
    await expect(page.getByTestId("fact-finding")).toContainText(/Specialist's diagnosis report/i);
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(FORBIDDEN);
    // No claim card and no total carries a figure before reviewed evidence.
    for (const text of await page.locator(".claim-item, .claim-card").allInnerTexts()) expect(text).not.toMatch(/S\$\s?\d|SGD\s?\d/);
    expect(await page.locator(".potential-totals, [data-testid=potential-totals]").count()).toBe(0);
    const limits = page.getByTestId("policy-stated-limits");
    if (await limits.count()) {
      await expect(limits).toContainText(LIMIT_LABEL);
      await expect(limits).toContainText(LIMIT_NOTICE);
    }
    const history = await api<{ conversations: { id: string }[] }>(page, "/api/chat/history?scope=all");
    conversationId = history.body.conversations?.[0]?.id ?? "";
    expect(conversationId).not.toBe("");
  });

  test("9. reopening the saved answer re-serves it through the boundary", async () => {
    type Saved = { claimItems?: { amountText: string | null }[]; potentialPayoutTotals?: unknown[]; summary?: string; answer?: Saved };
    const saved = await api<{ messages: { answer_json?: Saved | null }[] }>(page, `/api/chat/history/${conversationId}`);
    expect(saved.status).toBe(200);
    let checked = 0;
    for (const m of saved.body.messages ?? []) {
      const a = m.answer_json?.answer ?? m.answer_json;
      if (!a?.claimItems) continue;
      checked++;
      expect(a.claimItems.every((i) => i.amountText === null)).toBe(true);
      expect(a.potentialPayoutTotals ?? []).toEqual([]);
      expect(a.summary ?? "").not.toMatch(FORBIDDEN);
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("13. another household cannot read this answer", async ({ browser }) => {
    const other = await (await browser.newContext({ baseURL: BASE_B })).newPage();
    await other.goto(`${BASE_B}/chat`);
    const res = await api(other, `/api/chat/history/${conversationId}`);
    expect([403, 404]).toContain(res.status);
    await other.context().close();
  });
});
