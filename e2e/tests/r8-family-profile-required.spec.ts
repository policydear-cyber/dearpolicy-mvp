/**
 * Family page: relationship, date of birth, sex and preferred name are required when a person is added or edited
 * (DC, 17 Nov 2026). A person saved before that keeps their card and is asked to complete it; "Prefer not to say" is an
 * answer. Synthetic household, APIs mocked.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts r8-family-profile-required
 */
import { test, expect, type Route } from "@playwright/test";

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const base = { notes: null, policy_count: 0 };
const family = [
  { ...base, id: "m1", display_name: "Alex Tan", relationship: "self", date_of_birth: "1985-03-02", sex: "unspecified", preferred_name: "Alex" },
  { ...base, id: "m2", display_name: "Sam Tan", relationship: "child", date_of_birth: null, sex: null, preferred_name: null },
];

test("Adding and editing need every detail; an older incomplete person is asked to finish", async ({ page }) => {
  const patches: unknown[] = [], posts: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(), p = new URL(req.url()).pathname;
    if (p === "/api/family" && req.method() === "GET") return json(route, { family, profile: { sexField: true } });
    if (p === "/api/family" && req.method() === "POST") { posts.push(req.postDataJSON()); return json(route, { member: { id: "m3" } }); }
    if (p.startsWith("/api/family/") && req.method() === "PATCH") { patches.push(req.postDataJSON()); return json(route, { member: req.postDataJSON() }); }
    if (p === "/api/benefit-table") return json(route, { enabled: true, people: [] });
    return json(route, {});
  });
  await page.goto("/family");

  // The complete person: no prompt. The incomplete one: one line naming all three gaps and why.
  const alex = page.getByTestId("profile-card").filter({ hasText: "Alex Tan" });
  const sam = page.getByTestId("profile-card").filter({ hasText: "Sam Tan" });
  await expect(alex.getByTestId("profile-missing")).toHaveCount(0);
  await expect(sam.getByTestId("profile-missing")).toContainText("Add Sam Tan’s date of birth, sex and preferred name.");

  // Add now opens the details on the first gap; Save stays off until every gap is filled.
  await sam.getByRole("button", { name: "Add now" }).click();
  await expect(page.locator("#fm-m2-dob")).toBeFocused();
  await page.locator("#fm-m2-dob").fill("2015-03-02");
  const save = sam.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();
  await expect(sam.getByTestId("profile-edit-needs")).toHaveText("Still needed to save: sex and preferred name.");
  await page.locator("#fm-m2-sex").selectOption("unspecified"); // "Prefer not to say" is an answer
  await expect(save).toBeDisabled();
  await page.locator("#fm-m2-preferred").fill("   ");
  await expect(save).toBeDisabled();
  await page.locator("#fm-m2-preferred").fill("Sammy");
  await expect(sam.getByTestId("profile-edit-needs")).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toMatchObject({ dateOfBirth: "2015-03-02", sex: "unspecified", preferredName: "Sammy", relationship: "child" });

  // Editing a complete person and blanking a required detail turns Save off again.
  await alex.getByRole("button", { name: "Edit details" }).click();
  await page.locator("#fm-m1-preferred").fill("");
  await expect(alex.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(alex.getByTestId("profile-edit-needs")).toHaveText("Still needed to save: preferred name.");

  // Adding: the button waits for the preferred name too.
  const add = page.getByRole("button", { name: "+ Add person" });
  await page.locator("#fm-new-name").fill("Jamie Tan");
  await page.locator("#fm-new-relationship").selectOption("spouse");
  await page.locator("#fm-new-dob").fill("1987-06-09");
  await page.locator("#fm-new-sex").selectOption("female");
  await expect(add).toBeDisabled();
  await expect(page.locator("#fm-new-needs")).toHaveText("Still needed: preferred name.");
  await page.locator("#fm-new-preferred").fill("Jamie");
  await expect(add).toBeEnabled();
  await add.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ displayName: "Jamie Tan", relationship: "spouse", dateOfBirth: "1987-06-09", sex: "female", preferredName: "Jamie" });
});
