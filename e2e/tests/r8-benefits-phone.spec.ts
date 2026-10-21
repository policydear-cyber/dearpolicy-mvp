/**
 * Benefits on a narrow phone: no sideways scroll, even when a document's file name is one long word
 * ("Product_Summary_GroupPersonalAccident_2026_v3.pdf") or a plan has no product name and is grouped by that file name.
 * Synthetic data, APIs mocked; needs only the Next.js app with DEV_AUTH_ENABLED=true, like r8-chat-render.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts r8-benefits-phone
 */
import { test, expect, type Route } from "@playwright/test";

const json = (route: Route, body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const FILE = "Product_Summary_GroupPersonalAccident_2026_v3.pdf";
const benefit = (i: number, o: Record<string, unknown> = {}) => ({ id: `b${i}`, policyId: "p1", productName: "Group Personal Accident Plan", documentName: FILE, insurer: "Example General",
  benefitName: "Fracture of the wrist", formulaKind: "sum_insured", formulaValue: 25, currency: "SGD", factKey: null, offsetDays: null, maximumDays: null, pays: "25% of the fracture limit",
  sourcePage: 13, quote: `Quoted from ${FILE}`, conditions: [], needsConfirmation: false, attention: null, calculatedAgainst: [], owners: ["Alex Tan"], alternatives: null, ...o });

for (const width of [320, 360]) test(`Benefits at ${width}px: nothing wider than the screen`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/benefits") return json(route, { benefits: [benefit(0), benefit(1, { productName: null, benefitName: "Daily hospital cash" })],
      conditions: [{ id: "c1", policyId: "p1", documentName: FILE, cover: "Fracture", kind: "waiting_period", description: "A 30-day waiting period applies", effect: "waiting", sourcePage: 20, quote: "Thirty days." }] });
    if (p === "/api/family") return json(route, { family: [{ id: "m1", display_name: "Alex Tan", relationship: "self" }] });
    if (p === "/api/benefits/index") return json(route, { unread: [], documents: [] });
    return json(route, {});
  });
  await page.goto("/schedule");
  await expect(page.getByText("Daily hospital cash")).toBeVisible();
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.screen);
});

test.use({ isMobile: true, hasTouch: true });
