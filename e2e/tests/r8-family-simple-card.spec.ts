/**
 * Family page cards are kept simple (DC, 18 Nov 2026): each person shows who they are, with no document count and no
 * "Covered for ..." line, and their name opens their cover. The page no longer asks for the cover list at all, so it
 * can never show a stale or guessed cover summary. Synthetic household, APIs mocked.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts r8-family-simple-card
 */
import { test, expect, type Route } from "@playwright/test";

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const family = [
  { id: "m1", display_name: "Alex Tan", relationship: "self", date_of_birth: "1985-03-02", sex: "female", preferred_name: "Alex", notes: null, policy_count: 11 },
  { id: "m2", display_name: "Sam Tan", relationship: "child", date_of_birth: "2015-03-02", sex: "male", preferred_name: "Sam", notes: null, policy_count: 0 },
];

test("Each person shows who they are; no document count or cover list; the name opens their cover", async ({ page }) => {
  const asked: string[] = [];
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname; asked.push(p);
    if (p === "/api/family") return json(route, { family, profile: { sexField: true } });
    if (p === "/api/benefit-table") return json(route, { enabled: true, people: [{ id: "m1", rows: [{ benefit: "Death", pays: "lump_sum", product: "Harbour Term Life", cover: "Basic", source: { documentId: "d1" } }] }] });
    return json(route, {});
  });
  await page.goto("/family");
  const alex = page.getByTestId("profile-card").filter({ hasText: "Alex Tan" });
  const sam = page.getByTestId("profile-card").filter({ hasText: "Sam Tan" });
  await expect(alex).toContainText("Me");
  await expect(sam).toContainText("Child");
  for (const card of [alex, sam]) {
    await expect(card).not.toContainText(/documents? linked|No documents linked|Covered for|No cover found|Checking what/);
  }
  await expect(alex.getByTestId("family-see-cover")).toHaveAttribute("href", "/ledger?member=m1");
  await expect(sam.getByTestId("family-see-cover")).toHaveAttribute("href", "/ledger?member=m2");
  await page.waitForTimeout(500);
  expect(asked.filter((p) => p === "/api/benefit-table" || p === "/api/ledger")).toEqual([]);
});
