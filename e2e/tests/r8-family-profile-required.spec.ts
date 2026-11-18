/**
 * Family page: full name, relationship, date of birth, sex and preferred name are required when a person is added or edited
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

  // Add now opens the details on the first gap. Save stays pressable; pressing it with gaps marks each empty field
  // "Required" (no explanation paragraph) and saves nothing.
  await sam.getByRole("button", { name: "Add now" }).click();
  await expect(page.locator("#fm-m2-dob")).toBeFocused();
  await page.locator("#fm-m2-dob").fill("2015-03-02");
  const save = sam.getByRole("button", { name: "Save" });
  await expect(save).toBeEnabled();
  await expect(sam.locator("small.error")).toHaveCount(0); // nothing red before Save is pressed
  await save.click();
  await expect(page.locator("#fm-m2-sex-error")).toHaveText("Required");
  await expect(page.locator("#fm-m2-preferred-error")).toHaveText("Required");
  await expect(page.locator("#fm-m2-dob-error")).toHaveCount(0);
  await expect(page.locator("#fm-m2-sex")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#fm-m2-sex")).toBeFocused(); // the first empty field
  expect(patches.length).toBe(0);
  await page.locator("#fm-m2-sex").selectOption("unspecified"); // "Prefer not to say" is an answer
  await expect(page.locator("#fm-m2-sex-error")).toHaveCount(0); // clears as soon as it is filled
  await page.locator("#fm-m2-preferred").fill("   ");
  await save.click();
  await expect(page.locator("#fm-m2-preferred-error")).toHaveText("Required"); // spaces are not a name
  expect(patches.length).toBe(0);
  await page.locator("#fm-m2-preferred").fill("Sammy");
  await expect(sam.locator("small.error")).toHaveCount(0);
  await save.click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toMatchObject({ dateOfBirth: "2015-03-02", sex: "unspecified", preferredName: "Sammy", relationship: "child" });

  // The "Saved" line from that save goes once Save is pressed again with a gap (no stale status beside "Required").
  await expect(sam).toContainText("Saved Sam Tan.");
  // (The mocked list still returns Sam's old, incomplete record, so changing the date leaves the other gaps empty.)
  await sam.getByRole("button", { name: "Edit details" }).click();
  await page.locator("#fm-m2-dob").fill("2015-03-03");
  await sam.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#fm-m2-preferred-error")).toHaveText("Required");
  await expect(sam).not.toContainText("Saved Sam Tan.");
  await sam.getByRole("button", { name: "Undo changes" }).click();

  // Editing a complete person: the full name is required too, and blanking it or a detail is caught on Save.
  await alex.getByRole("button", { name: "Edit details" }).click();
  await expect(alex.locator('label[for="fm-m1-name"] .field-required')).toHaveCount(1);
  await page.locator("#fm-m1-name").fill("");
  await page.locator("#fm-m1-preferred").fill("");
  await alex.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#fm-m1-name-error")).toHaveText("Required");
  await expect(page.locator("#fm-m1-preferred-error")).toHaveText("Required");
  expect(patches.length).toBe(1);
  // Undo clears the marks.
  await alex.getByRole("button", { name: "Undo changes" }).click();
  await expect(alex.locator("small.error")).toHaveCount(0);

  // Adding: no explanation paragraph; every label is marked required; Add marks what is empty and sends nothing.
  await expect(page.getByText("All fields are needed")).toHaveCount(0);
  for (const f of ["name", "relationship", "dob", "sex", "preferred"]) await expect(page.locator(`label[for="fm-new-${f}"] .field-required`)).toHaveCount(1);
  const add = page.getByRole("button", { name: "+ Add person" });
  await expect(add).toBeEnabled();
  await add.click();
  for (const f of ["name", "relationship", "dob", "sex", "preferred"]) await expect(page.locator(`#fm-new-${f}-error`)).toHaveText("Required");
  await expect(page.locator("#fm-new-name")).toBeFocused();
  await page.locator("#fm-new-name").fill("Jamie Tan");
  await page.locator("#fm-new-relationship").selectOption("spouse");
  await page.locator("#fm-new-dob").fill("1987-06-09");
  await page.locator("#fm-new-sex").selectOption("female");
  await expect(page.locator("#fm-new-name-error")).toHaveCount(0);
  await expect(page.locator("#fm-new-preferred-error")).toHaveText("Required");
  expect(posts.length).toBe(0); // the first Add, with every field empty, sent nothing
  await add.click();
  await expect(page.locator("#fm-new-preferred")).toBeFocused();
  expect(posts.length).toBe(0);
  await page.locator("#fm-new-preferred").fill("Jamie");
  await expect(page.locator("#fm-new-preferred-error")).toHaveCount(0);
  await add.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ displayName: "Jamie Tan", relationship: "spouse", dateOfBirth: "1987-06-09", sex: "female", preferredName: "Jamie" });
  // After a successful add the cleared form shows no errors.
  await expect(page.getByText("Family member added.")).toBeVisible();
  await expect(page.locator("#fm-new-name-error")).toHaveCount(0);
});
