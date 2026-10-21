/**
 * Documents: each card has a Preview that opens the stored file in a new tab, so a person can tell which document is
 * which when the file name is meaningless; the file name shows under the title DearPolicy read. A Word file offers
 * Download; a document still being scanned, or rejected, offers neither. Synthetic household, APIs mocked.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts r8-document-preview
 */
import { test, expect, type Route } from "@playwright/test";

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const family = [{ id: "m1", display_name: "Alex Tan", relationship: "self", policy_count: 1 }];
const doc = (o: Record<string, unknown>) => ({ id: "11111111-0000-4000-8000-000000000001", product_name: null, original_filename: "a8f3c1_20261020_0932.pdf", insurer: null,
  policy_number: null, group_policy_number: null, policy_type: null, document_role: "certificate", personal_coverage_confirmed: true, document_authority: 90,
  document_authority_label: null, needs_review: false, review_reason: null, processing_status: "ready", processing_stage: "ready", processing_progress: 100,
  processing_message: null, quarantine_status: "scan_clean", scan_result_detail: null, page_count: 4, processing_error: null, created_at: "2026-10-20T00:00:00Z",
  linked_people: [{ id: "m1", name: "Alex Tan", source: "upload" }], detected_people: [], tier_options: [], named_tiers: [], ...o });
const library = [
  doc({ product_name: "Shield Summary", insurer: "Example Insurer" }),
  doc({ id: "11111111-0000-4000-8000-000000000002", original_filename: "Benefits table.docx" }),
  doc({ id: "11111111-0000-4000-8000-000000000004", original_filename: "Product_Summary_GroupPersonalAccident_2026_v3.pdf" }),
  doc({ id: "11111111-0000-4000-8000-000000000003", original_filename: "scan_0007.pdf", quarantine_status: "scan_pending", processing_status: "uploaded", processing_stage: "uploaded", processing_progress: 0 }),
];

for (const width of [375, 1280]) test(`Preview opens the file at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/family") return json(route, { family });
    if (p === "/api/policies") return json(route, { documentSafetyMode: "malware_scan", policies: library });
    return json(route, {});
  });
  await page.goto("/policies");
  const named = page.locator(".document-card", { hasText: "Shield Summary" });
  await expect(named).toBeVisible();
  // The file name the person knows it by, under the title DearPolicy read.
  await expect(named.locator(".document-file")).toHaveText("a8f3c1_20261020_0932.pdf");
  const preview = named.getByRole("link", { name: "Preview Shield Summary" });
  await expect(preview).toHaveAttribute("href", "/api/policies/11111111-0000-4000-8000-000000000001/file");
  await expect(preview).toHaveAttribute("target", "_blank");
  await expect(preview).toHaveAttribute("rel", /noopener/);
  const box = (await preview.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(32);

  const word = page.locator(".document-card", { hasText: "Benefits table.docx" });
  await expect(word.getByRole("link", { name: /^Download/ })).toHaveAttribute("href", "/api/policies/11111111-0000-4000-8000-000000000002/file");
  await expect(word.locator(".document-file")).toHaveCount(0);

  // A long file name used as the title wraps inside its card instead of widening a phone screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  const scanning = page.locator(".document-card", { hasText: "scan_0007.pdf" });
  await expect(scanning).toBeVisible();
  await expect(scanning.getByRole("link", { name: /Preview|Download/ })).toHaveCount(0);
});
