/**
 * Family page, first run (DC, 21 Nov 2026): a new user was asked to add a family member and added her husband without
 * adding herself. A household with nobody on file now sees "About you" first, saved as "self", and only then the family
 * form. A household that has people but no "self" is not blocked and is offered "Add yourself". Synthetic household,
 * APIs mocked.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts r8-family-owner-first
 */
import { test, expect, type Route } from "@playwright/test";

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const base = { notes: null, policy_count: 0, sex: "unspecified" };
const person = (id: string, name: string, relationship: string) => ({ ...base, id, display_name: name, relationship, date_of_birth: "1985-03-02", preferred_name: name.split(" ")[0] });

async function mock(page: import("@playwright/test").Page, family: unknown[]) {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(), p = new URL(req.url()).pathname;
    if (p === "/api/family" && req.method() === "GET") return json(route, { family, profile: { sexField: true } });
    if (p === "/api/family" && req.method() === "POST") {
      const body = req.postDataJSON(); posts.push(body);
      family.push(person(`m${family.length + 1}`, body.displayName, body.relationship));
      return json(route, { member: { id: "new" } }, 201);
    }
    return json(route, {});
  });
  return posts;
}

test("A new household is asked about the person who signed up first, and cannot add anyone else before", async ({ page }) => {
  const posts = await mock(page, []);
  await page.goto("/family");
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.locator("#fm-new-relationship")).toHaveCount(0); // no way to add a husband here: this is you
  await expect(page.getByRole("heading", { name: "Add a family member" })).toHaveCount(0);

  // Pressing Save empty marks each field "Required" and saves nothing.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#fm-new-name-error")).toHaveText("Required");
  await expect(page.locator("#fm-new-dob-error")).toHaveText("Required");
  expect(posts.length).toBe(0);

  await page.locator("#fm-new-name").fill("Mei Lin Tan");
  await page.locator("#fm-new-dob").fill("1988-04-05");
  await page.locator("#fm-new-sex").selectOption("female");
  await page.locator("#fm-new-preferred").fill("Mei");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ displayName: "Mei Lin Tan", relationship: "self" });

  // Only now is anyone else offered.
  await expect(page.getByRole("heading", { name: "Add a family member" })).toBeVisible();
  await expect(page.locator("#fm-new-relationship")).toBeVisible();
});

test("A household with people but no owner is not blocked, and is offered Add yourself", async ({ page }) => {
  const posts = await mock(page, [person("m1", "Daniel Tan", "spouse")]);
  await page.goto("/family");
  await expect(page.getByTestId("owner-missing")).toBeVisible();
  await expect(page.locator("#fm-new-relationship")).toBeVisible(); // adding others still works
  await page.getByRole("button", { name: "Add yourself" }).click();
  await expect(page.locator("#fm-new-relationship")).toHaveCount(0);
  await page.locator("#fm-new-name").fill("Mei Lin Tan");
  await page.locator("#fm-new-dob").fill("1988-04-05");
  await page.locator("#fm-new-sex").selectOption("female");
  await page.locator("#fm-new-preferred").fill("Mei");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ relationship: "self" });
  await expect(page.getByTestId("owner-missing")).toHaveCount(0);
});

test("A household with an owner on file sees the unchanged family page", async ({ page }) => {
  await mock(page, [person("m1", "Mei Lin Tan", "self")]);
  await page.goto("/family");
  await expect(page.getByRole("heading", { name: "Your family" })).toBeVisible();
  await expect(page.getByTestId("owner-missing")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Add a family member" })).toBeVisible();
  await expect(page.locator("#fm-new-relationship")).toBeVisible();
});
