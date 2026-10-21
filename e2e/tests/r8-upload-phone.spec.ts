/**
 * Uploading a document on a phone: choosing the file, sending it, DearPolicy reading it, and the two ways it goes
 * wrong (the upload is refused, or the document can't be read). Synthetic household, APIs mocked; needs only the
 * Next.js app with DEV_AUTH_ENABLED=true, like r8-chat-render. R8_PHONE_SHOTS=<dir> also saves screenshots.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts r8-upload-phone
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const SHOTS = process.env.R8_PHONE_SHOTS;
const family = [{ id: "m1", display_name: "Alex Tan", relationship: "self", policy_count: 0 }, { id: "m2", display_name: "Grace Tan", relationship: "child", policy_count: 0 }];
const doc = (o: Record<string, unknown>) => ({ id: "d1", product_name: null, original_filename: "group-pa-certificate.pdf", insurer: null, policy_number: null, group_policy_number: null,
  policy_type: null, document_role: null, personal_coverage_confirmed: false, document_authority: 0, document_authority_label: null, needs_review: false, review_reason: null,
  processing_status: "extracting", processing_stage: "reading", processing_progress: 40, processing_message: "Reading page 3 of 8", quarantine_status: "clean", scan_result_detail: null,
  page_count: 8, processing_error: null, created_at: "2026-10-20T00:00:00Z", linked_people: [], detected_people: [], tier_options: [], named_tiers: [], ...o });

type Plan = { start?: { status: number; body: unknown }; holdPut?: Promise<void> };
async function mock(page: Page, plan: Plan, library: () => unknown[]) {
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/family") return json(route, { family });
    if (p === "/api/policies") return json(route, { documentSafetyMode: "malware_scan", policies: library() });
    if (p === "/api/policies/upload/start") return plan.start ? json(route, plan.start.body, plan.start.status) : json(route, { mode: "signed-url", uploadUrl: "/api/test-put", token: "t1" });
    if (p === "/api/test-put") { await plan.holdPut; return route.fulfill({ status: 200, body: "" }); }
    if (p === "/api/policies/upload/finalize") return json(route, { policyId: "d1" });
    return json(route, {});
  });
}
async function shot(page: Page, id: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${id}.png`), fullPage: true });
}
const pdf = { name: "group-pa-certificate.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic") };

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test("first upload: choose, send, then reading", async ({ page }) => {
  let release!: () => void;
  const plan: Plan = { holdPut: new Promise<void>((r) => { release = r; }) };
  let uploaded = false;
  await mock(page, plan, () => uploaded ? [doc({})] : []);
  await page.goto("/policies");
  await expect(page.getByRole("button", { name: /Upload/ })).toBeVisible();
  // The file comes first, as one large target, and no password is asked before a PDF is chosen.
  const drop = page.getByTestId("upload-drop");
  expect((await drop.boundingBox())!.height).toBeGreaterThanOrEqual(80);
  await expect(page.getByLabel(/^PDF password/)).toHaveCount(0);
  await shot(page, "1-empty");
  await page.getByLabel(/Insurance document/).setInputFiles(pdf);
  await expect(drop).toContainText("group-pa-certificate.pdf");
  await expect(page.getByLabel(/^PDF password/)).toBeVisible();
  await shot(page, "2-chosen");
  await page.getByRole("button", { name: /Upload/ }).click();
  await expect(page.getByText(/Uploading document/)).toBeVisible();
  await shot(page, "3-sending");
  uploaded = true;
  release();
  await expect(page.getByText(/Upload received/)).toBeVisible();
  await shot(page, "4-reading");
});

test("refused upload says what to do", async ({ page }) => {
  await mock(page, { start: { status: 400, body: { error: "This file type can’t be read. Upload a PDF, a photo or a scan." } } }, () => []);
  await page.goto("/policies");
  await page.setInputFiles("#up-file", pdf);
  await page.getByRole("button", { name: /Upload/ }).click();
  // Said right under the button, and on screen.
  await expect(page.locator(".upload-status.error")).toBeInViewport();
  await expect(page.locator(".upload-status.error")).toContainText("can’t be read");
  await shot(page, "5-refused");
});

test("a document that can't be read", async ({ page }) => {
  await mock(page, {}, () => [doc({ processing_status: "failed", processing_stage: "failed", processing_progress: 100, processing_message: null, processing_error: "The pages could not be read." })]);
  await page.goto("/policies");
  await expect(page.locator(".document-card").first()).toBeVisible();
  // A way back to the upload box from the card that failed.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload a clearer copy" }).click();
  await chooser;
  await shot(page, "6-cant-read");
});
