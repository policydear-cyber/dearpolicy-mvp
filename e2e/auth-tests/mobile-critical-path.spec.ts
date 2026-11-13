/**
 * Mobile critical path (phone viewport, touch): sign up, confirm, first
 * household, add a person, upload and scan a document, move around with the
 * bottom navigation, sign out and back in, delete the household. Real
 * sessions against the test-only Auth stand-in. Synthetic data only.
 */
import { test, expect } from "@playwright/test";
import { name, syntheticWordingPdf } from "../support/synthetic";
import { api, emailFor, newPassword, outboxLink, signUpThroughUi, signInThroughUi, expectNoHorizontalScroll, hideDevOverlay, recordHousehold, hardenNavigation } from "../support/journey";

test.describe.serial("mobile critical path", () => {
  test.setTimeout(420_000);
  const email = emailFor("mobile-owner");
  const password = newPassword();
  const household = name("Mobile-Household");
  const person = name("Mobile-Person");
  const file = `${name("mobile-wording")}.pdf`;
  test.beforeEach(async ({ page }) => { hardenNavigation(page); await hideDevOverlay(page); });

  test("sign up, confirm by email, add a person, upload a document and use the bottom navigation", async ({ page }) => {
    await signUpThroughUi(page, { email, password, household });
    await expectNoHorizontalScroll(page, "sign-up");
    await page.goto(await outboxLink(email));
    await page.waitForURL((u) => u.hostname === "localhost" && !u.pathname.startsWith("/login") && !u.pathname.startsWith("/api/"), { timeout: 60_000 });
    const hh = await api(page, "/api/household");
    expect(hh.body.activeHouseholdName).toBe(household);
    recordHousehold(hh.body.activeHouseholdId);

    // The phone layout: bottom navigation, no sidebar footer, sign-out in the top bar.
    await expect(page.locator(".mobile-bar").getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.locator(".sidebar-footer")).toBeHidden();
    for (const p of ["/", "/family", "/policies", "/claims", "/chat", "/household"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      await expectNoHorizontalScroll(page, p);
    }

    await page.goto("/family");
    await page.getByLabel("Full name").first().fill(person);
    await page.locator("#fm-new-relationship").selectOption("self");
    await page.getByRole("button", { name: "+ Add person" }).tap();
    await expect(page.locator(".profile-add-panel [role=status]")).toHaveText("Family member added.");

    await page.goto("/policies");
    await page.locator(".upload-form select").selectOption({ label: `${person} · self` });
    await page.locator(".upload-form input[type=file]").setInputFiles({ name: file, mimeType: "application/pdf", buffer: await syntheticWordingPdf("mobile-wording") });
    await page.getByRole("button", { name: "Upload & analyse" }).tap();
    await expect(page.locator(".upload-panel .upload-status")).toContainText("Upload received");
    await expect.poll(async () => ((await api<{ policies: { original_filename: string; processing_status: string }[] }>(page, "/api/policies")).body.policies ?? [])
      .find((p) => p.original_filename === file)?.processing_status, { timeout: 240_000, intervals: [1500] }).toBe("ready");
    await page.reload();
    await expect(page.locator(".document-card").filter({ hasText: file.replace(/\.pdf$/, "") }).or(page.locator(".document-card").first())).toContainText("Ready");
    await expectNoHorizontalScroll(page, "documents with a card");

    // Bottom navigation by touch. The bar holds Portfolio, Documents, Ask, Payments and More;
    // Learn and Account settings sit in the sheet that More opens, and Account settings opens on People.
    const bar = page.locator(".sidebar .nav");
    await expect(bar.locator('a[href="/chat"]')).toBeVisible();
    await expect(bar.locator('a[href="/claims"]')).toHaveCount(0);
    await bar.locator('a[href="/records"]').tap();
    await expect(page).toHaveURL(/\/records$/);
    await bar.getByRole("button", { name: "More" }).tap();
    await expect(page.locator("#nav-more-sheet").getByRole("menuitem", { name: "Learn" })).toBeVisible();
    await page.locator("#nav-more-sheet").getByRole("menuitem", { name: "Account settings" }).tap();
    await expect(page).toHaveURL(/\/family$/);
    await expect(page.locator("#nav-more-sheet")).toHaveCount(0);
    await expect(page.locator(`.profile-card input[value="${person}"]`)).toHaveCount(1);
  });

  test("sign out from the top bar, sign back in, delete the household", async ({ page }) => {
    await signInThroughUi(page, email, password);
    await page.locator(".mobile-bar").getByRole("button", { name: "Sign out" }).tap();
    await page.waitForURL(/\/login/);
    expect((await api(page, "/api/family")).status).toBe(401);
    await signInThroughUi(page, email, password, "/household");
    await page.getByLabel("Household name").fill(household);
    await page.getByRole("button", { name: "Permanently delete household" }).tap();
    await page.waitForURL((u) => u.pathname === "/household/deleted", { timeout: 60_000 }); // its own confirmation page
    expect((await api(page, "/api/policies")).status).toBe(404);
    // The confirmation page has its own Sign out button besides the top bar's; use the page's.
    await page.getByTestId("household-deleted").getByRole("button", { name: "Sign out" }).tap();
    await page.waitForURL(/\/login/);
  });
});
