/**
 * Keyboard-only critical path: no pointer input at all. Sign in, reach the
 * Family page from the navigation, add and delete a person (with the
 * two-step confirmation), upload a document, sign out, sign in and delete
 * the household -- each control reached with Tab and operated with
 * Enter/Space, each focused control visibly focused. Synthetic data only.
 */
import { test, expect, type Page } from "@playwright/test";
import { name, syntheticWordingPdf } from "../support/synthetic";
import { api, emailFor, newPassword, adminCreateUser, recordHousehold, hardenNavigation } from "../support/journey";

type Focus = { tag: string; text: string; label: string; id: string; type: string; visible: boolean };
async function focused(page: Page): Promise<Focus> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return { tag: "", text: "", label: "", id: "", type: "", visible: false };
    const cs = getComputedStyle(el);
    const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
    return { tag: el.tagName.toLowerCase(), text: (el.innerText || "").trim(), label: el.getAttribute("aria-label") ?? "", id: el.id, type: el.getAttribute("type") ?? "", visible };
  });
}
/** Presses Tab until the focused element matches, and checks it is visibly focused. */
async function tabTo(page: Page, match: (f: Focus) => boolean, what: string, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const f = await focused(page);
    if (match(f)) {
      expect(f.visible, `${what} shows a visible focus indicator`).toBe(true);
      return f;
    }
  }
  throw new Error(`could not reach ${what} with the keyboard`);
}

test.describe.serial("keyboard-only critical path", () => {
  test.setTimeout(420_000);
  const email = emailFor("keyboard-owner");
  const password = newPassword();
  const person = name("Keyboard-Person");
  const file = `${name("keyboard-wording")}.pdf`;
  test.beforeEach(async ({ page }) => { hardenNavigation(page); });

  test("sign in, manage a person and upload a document using only the keyboard", async ({ page }) => {
    await adminCreateUser(email, password);
    await page.goto("/login");
    await tabTo(page, (f) => f.id === "dp-email", "the email field");
    await page.keyboard.type(email);
    await tabTo(page, (f) => f.type === "password", "the password field");
    await page.keyboard.type(password);
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
    const household = await api(page, "/api/household");
    recordHousehold(household.body.activeHouseholdId);
    const hh = String(household.body.activeHouseholdName);
    expect(hh.toLowerCase()).toContain("synthetic-dptest");

    await page.goto("/");
    await tabTo(page, (f) => f.tag === "a" && f.text === "Family", "the Family navigation link");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/family$/);

    await tabTo(page, (f) => f.id === "fm-new-name", "the new person's name field");
    await page.keyboard.type(person);
    await tabTo(page, (f) => f.id === "fm-new-relationship", "the relationship field");
    await page.keyboard.press("Home");
    await tabTo(page, (f) => f.text === "+ Add person", "the Add person button");
    await page.keyboard.press("Enter");
    await expect(page.locator(".profile-add-panel [role=status]")).toHaveText("Profile added.");

    // Two-step delete, both steps by keyboard; focus stays on the control.
    await tabTo(page, (f) => f.label === `Delete ${person}`, "the person's Delete button");
    await page.keyboard.press("Enter");
    expect((await focused(page)).label).toBe(`Confirm delete ${person}`);
    await page.keyboard.press("Enter");
    await expect(page.locator(".profile-add-panel [role=status]")).toContainText(`Removed ${person}`);

    // Add the person back, then upload a document with the keyboard (Space opens the file chooser).
    await page.reload();
    await tabTo(page, (f) => f.id === "fm-new-name", "the new person's name field");
    await page.keyboard.type(person);
    await tabTo(page, (f) => f.text === "+ Add person", "the Add person button");
    await page.keyboard.press("Enter");
    await expect(page.locator(".profile-add-panel [role=status]")).toHaveText("Profile added.");
    await page.goto("/policies");
    await tabTo(page, (f) => f.tag === "input" && f.type === "file", "the document file field");
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Space");
    await (await chooser).setFiles({ name: file, mimeType: "application/pdf", buffer: await syntheticWordingPdf("keyboard-wording") });
    await tabTo(page, (f) => f.text === "Upload & analyse", "the upload button");
    await page.keyboard.press("Enter");
    await expect(page.locator(".upload-panel .upload-status")).toContainText("Upload received");
  });

  test("sign out, sign in and delete the household using only the keyboard", async ({ page }) => {
    await page.goto("/login");
    await tabTo(page, (f) => f.id === "dp-email", "the email field");
    await page.keyboard.type(email);
    await tabTo(page, (f) => f.type === "password", "the password field");
    await page.keyboard.type(password);
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
    await tabTo(page, (f) => f.text === "Sign out", "the Sign out button");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/login/);
    expect((await api(page, "/api/family")).status).toBe(401);

    await page.goto("/login?next=%2Fhousehold");
    await tabTo(page, (f) => f.id === "dp-email", "the email field");
    await page.keyboard.type(email);
    await tabTo(page, (f) => f.type === "password", "the password field");
    await page.keyboard.type(password);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/household$/);
    const hh = String((await api(page, "/api/household")).body.activeHouseholdName);
    expect(hh.toLowerCase()).toContain("synthetic-dptest");
    await tabTo(page, (f) => f.id === "hh-delete-confirm", "the delete confirmation field");
    await page.keyboard.type(hh);
    await tabTo(page, (f) => f.text === "Permanently delete household", "the delete household button");
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => u.pathname === "/household/deleted", { timeout: 60_000 }); // its own confirmation page
    expect((await api(page, "/api/policies")).status).toBe(404);
  });
});
