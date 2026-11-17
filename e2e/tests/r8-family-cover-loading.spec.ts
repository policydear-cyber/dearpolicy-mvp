/**
 * Family page: until the cover list has answered, no card says "No cover found". On a real household the line read
 * "No cover found in these documents yet" for ~10 seconds, then switched to "Covered for Death · Disability · …".
 * A neutral "Checking …" line shows instead; the real empty state stays for a person whose documents truly show no
 * cover, and a cover list that fails says nothing about cover. Synthetic household, APIs mocked.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts r8-family-cover-loading
 */
import { test, expect, type Route } from "@playwright/test";

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const family = [
  { id: "m1", display_name: "Alex Tan", relationship: "self", date_of_birth: "1985-03-02", sex: "unspecified", policy_count: 2 },
  { id: "m2", display_name: "Jamie Tan", relationship: "spouse", date_of_birth: "1987-06-09", sex: "unspecified", policy_count: 1 },
];
const deathRow = { benefit: "Death benefit", pays: "amount", product: "Example Term Life", cover: "Term Life" };
const table = { enabled: true, people: [{ id: "m1", rows: [deathRow], covers: [], scheduleLines: [] }, { id: "m2", rows: [], covers: [], scheduleLines: [] }] };

async function mock(page: import("@playwright/test").Page, tableAnswer: (route: Route) => Promise<void>) {
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/family") return json(route, { family, profile: { sexField: true } });
    if (p === "/api/benefit-table") return tableAnswer(route);
    return json(route, {});
  });
}

test("No cover is claimed before the cover list loads", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await mock(page, async (route) => { await held; await json(route, table); });
  await page.goto("/family");
  await expect(page.getByTestId("family-cover-loading")).toHaveCount(2);
  await expect(page.getByText(/No cover found/)).toHaveCount(0);
  await expect(page.getByTestId("family-cover-loading").first()).toContainText("Checking what Alex Tan is covered for");
  release();
  // Loaded: Alex's Death row shows; Jamie, whose document truly shows none, gets the real empty state.
  await expect(page.getByTestId("family-cover-loading")).toHaveCount(0);
  await expect(page.getByTestId("family-no-cover")).toHaveCount(1);
  await expect(page.getByTestId("family-no-cover")).toContainText("No cover found in this document yet");
  await expect(page.getByTestId("family-covered-for")).toHaveCount(1);
});

test("A cover list that fails says nothing about cover", async ({ page }) => {
  await mock(page, (route) => json(route, { error: "unavailable" }, 503));
  await page.goto("/family");
  await expect(page.getByText("Alex Tan").first()).toBeVisible();
  await expect(page.getByTestId("family-cover-loading")).toHaveCount(0);
  await expect(page.getByTestId("family-no-cover")).toHaveCount(0);
  await expect(page.getByText(/No cover found/)).toHaveCount(0);
});
