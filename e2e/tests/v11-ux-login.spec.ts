/**
 * V1.1 defect: "the login button sometimes required two clicks".
 *
 * Real sign-in through the app's own Supabase Auth code against the
 * test-only stand-in (no development identity). Synthetic user only.
 *
 * Each scenario gives the sign-in button exactly ONE real mouse click and
 * then requires the person to be signed in and on the page they asked for:
 *   1. credentials the browser filled in without typing (password-manager /
 *      Chrome autofill: the fields show values, but no input event reached
 *      the page yet) -- the owner's everyday case;
 *   2. credentials typed normally, three sign-ins in a row (navigation must
 *      not be lost after a successful sign-in);
 *   3. credentials typed while the page's scripts were still loading.
 * Screenshots (synthetic pages only) are written to e2e-results/v11-ux-shots.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { adminCreateUser, emailFor, newPassword, hardenNavigation } from "../support/journey";

const SHOTS = path.resolve(process.env.V11_UX_SHOTS_DIR ?? "e2e-results/v11-ux-shots");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, label: string) => page.screenshot({ path: path.join(SHOTS, `login-${label}.png`), fullPage: true });

/** One physical click at the centre of the sign-in button -- what a person
 * does. (Playwright's locator.click() would wait for an enabled button and
 * so hide exactly the defect being tested.) */
async function clickSignInOnce(page: Page) {
  const button = page.getByRole("button", { name: /sign in/i });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  if (!box) throw new Error("sign-in button has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function expectSignedInAt(page: Page, pathname: string) {
  await page.waitForURL((u) => u.pathname === pathname, { timeout: 45_000 });
  // Still there a moment later: a second navigation must not bounce the
  // person back to the sign-in page.
  await page.waitForTimeout(2500);
  expect(new URL(page.url()).pathname).toBe(pathname);
  await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible();
}
/** The page is interactive (hydrated): the form's controls respond to React. */
async function waitInteractive(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForFunction(() => {
    const el = document.querySelector("#dp-email");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps") || k.startsWith("__reactFiber"));
  }, undefined, { timeout: 60_000 });
}

test.describe("sign-in works on the first click", () => {
  test.setTimeout(300_000);
  const email = emailFor("ux-login");
  // One random password per run, created by the runner and handed to every
  // worker in memory (scripts/v11-ux-playwright.config.ts); never written out.
  const password = process.env.V11_UX_SYNTHETIC_PASSWORD ?? newPassword();

  // Each scenario is independent (one failing must not hide the others); a
  // restarted worker finds the synthetic user already there.
  test.beforeAll(async () => {
    try { await adminCreateUser(email, password); }
    catch (error) { if (!/already|exists|registered/i.test(String(error))) throw error; }
  });

  test("browser-filled credentials: one click signs in", async ({ page, context }) => {
    hardenNavigation(page);
    await context.clearCookies();
    await page.goto("/login?next=%2Fhousehold");
    await waitInteractive(page);
    // What autofill does before the person interacts: values appear in the
    // fields, but no input/change event has been delivered to the page.
    await page.evaluate(({ email, password }) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(document.querySelector("#dp-email"), email);
      set.call(document.querySelector("#dp-password"), password);
    }, { email, password });
    await shot(page, "autofill-before-click");
    await clickSignInOnce(page);
    try {
      await expectSignedInAt(page, "/household");
    } finally {
      await shot(page, "autofill-after-one-click");
    }
  });

  test("typed credentials: one click signs in, three times in a row", async ({ page, context }) => {
    hardenNavigation(page);
    for (let round = 1; round <= 3; round++) {
      await context.clearCookies();
      await page.goto("/login?next=%2Ffamily");
      await waitInteractive(page);
      await page.locator("#dp-email").fill(email);
      await page.locator("#dp-password").fill(password);
      await clickSignInOnce(page);
      try {
        await expectSignedInAt(page, "/family");
      } finally {
        if (round === 1) await shot(page, "typed-after-one-click");
      }
    }
  });

  test("typed before the page finished loading: one click signs in", async ({ page, context }) => {
    hardenNavigation(page);
    await context.clearCookies();
    // Hold back the page's scripts until the person has typed.
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    await page.route(/\/_next\/static\/chunks\//, async (route) => { await released; await route.continue(); });
    await page.goto("/login?next=%2Fhousehold", { waitUntil: "commit" });
    const emailField = page.locator("#dp-email");
    const rendered = await emailField.waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
    if (rendered) {
      await emailField.pressSequentially(email, { delay: 5 });
      await page.locator("#dp-password").pressSequentially(password, { delay: 5 });
    }
    release();
    await waitInteractive(page);
    if (!rendered) {
      // The form is only rendered once scripts run (production static
      // rendering): nothing could be typed early -- type now.
      await page.locator("#dp-email").fill(email);
      await page.locator("#dp-password").fill(password);
    }
    await shot(page, "early-typing-before-click");
    await clickSignInOnce(page);
    await expectSignedInAt(page, "/household");
  });

  test("wrong password: one click shows a plain message and keeps the person on the page", async ({ page, context }) => {
    hardenNavigation(page);
    await context.clearCookies();
    await page.goto("/login");
    await waitInteractive(page);
    await page.locator("#dp-email").fill(email);
    await page.locator("#dp-password").fill(password + "-wrong");
    await clickSignInOnce(page);
    await expect(page.locator(".alert.error")).toContainText("Incorrect email or password.");
    expect(new URL(page.url()).pathname).toBe("/login");
    // Nothing typed ever lands in the address bar.
    expect(page.url()).not.toContain("password");
    await shot(page, "wrong-password");
  });
});
