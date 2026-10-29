/**
 * Critic round 32: what Coverage, Family and Documents say about a row the
 * documents do not confirm (R32-1), a hospital benefit typed "other" or found
 * only on Benefits (R32-2), and the device-only "Not in my family" answers on
 * sign-out (R32-4). Synthetic data, household APIs mocked; needs only the
 * Next.js app with DEV_AUTH_ENABLED=true, like r8-chat-render.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts r8-coverage-to-confirm
 */
import { test, expect, type Page, type Route } from "@playwright/test";

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const PA = "00000000-0000-0000-0000-0000000000e1", LIFE = "00000000-0000-0000-0000-0000000000e2";
const family = [{ id: "m1", display_name: "Alex Tan", relationship: "self", policy_count: 1 }, { id: "m2", display_name: "Grace Tan", relationship: "child", policy_count: 1 }];

let n = 0;
const row = (o: Record<string, unknown>) => ({ id: `r${++n}`, familyMemberId: "m1", ownerName: "Alex Tan", policyId: PA, planName: "Group PA", insurer: "Example General",
  detail: null, cause: null, amount: null, currency: "SGD", conditions: [], sourcePage: 2, quote: "Synthetic line.", alternatives: null, ...o });
// A Group PA schedule line alone: the plan type's usual benefits, seeded as proposals.
const rows = [
  row({ eventType: "accidental_death", eventLabel: "Accidental death", paysKind: "lump_sum", amount: 200000, pays: "S$200,000 lump sum", hasFigure: true, origin: "schedule", status: "proposed" }),
  row({ eventType: "fracture", eventLabel: "Fracture", paysKind: "stated", pays: "", hasFigure: false, origin: "schedule", status: "proposed" }),
  row({ eventType: "accident_medical_expense", eventLabel: "Accident medical expenses", paysKind: "stated", pays: "", hasFigure: false, origin: "schedule", status: "proposed" }),
  // Confirmed death cover from the life plan's wording, and a hospital benefit the reading typed "other".
  row({ policyId: LIFE, planName: "Family Shield", eventType: "death", eventLabel: "Death", paysKind: "lump_sum", amount: 300000, pays: "S$300,000 lump sum", hasFigure: true, origin: "wording", status: "confirmed" }),
  row({ policyId: LIFE, planName: "Family Shield", eventType: "other", eventLabel: "Hospital and surgical benefit", paysKind: "stated", pays: "", hasFigure: false, origin: "wording", status: "confirmed" }),
  // Grace: a critical illness benefit; her hospital cover is listed only on Benefits.
  row({ familyMemberId: "m2", ownerName: "Grace Tan", policyId: LIFE, planName: "Family Shield", eventType: "critical_illness", eventLabel: "Critical illness", paysKind: "lump_sum", amount: 100000, pays: "S$100,000 lump sum", hasFigure: true, origin: "wording", status: "confirmed" }),
];
const benefits = [{ benefitName: "Daily hospital cash", owners: ["Grace Tan"] }];
const policies = [PA, LIFE].map((id, i) => ({ id, product_name: i ? "Family Shield" : "Group PA", original_filename: null, insurer: "Example", policy_number: null, group_policy_number: null,
  policy_type: null, document_role: i ? "policy_wording" : "certificate", personal_coverage_confirmed: true, document_authority: 1, document_authority_label: "Personal proof", needs_review: false,
  review_reason: null, processing_status: "ready", processing_stage: "done", processing_progress: 100, processing_message: null, quarantine_status: "clean", scan_result_detail: null,
  page_count: 4, processing_error: null, created_at: "2026-10-01T00:00:00Z", linked_people: [{ id: "m1", name: "Alex Tan", relationship: "self", source: "ai_name_match" }],
  detected_people: [], tier_options: [], named_tiers: [] }));

async function mock(page: Page, ledgerRows = rows, library = policies) {
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/ledger") return json(route, { rows: ledgerRows, family, reading: { pending: 0, inProgress: false, documents: [] } });
    if (p === "/api/benefits") return json(route, { benefits });
    if (p === "/api/family") return json(route, { family });
    if (p === "/api/policies") return json(route, { documentSafetyMode: "malware_scan", policies: library });
    if (p === "/api/auth/signout") return json(route, { ok: true });
    return json(route, {});
  });
}

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test("R32-1: Coverage never says Covered for a row the documents don't confirm", async ({ page }) => {
  await mock(page);
  await page.goto("/ledger");
  const alex = page.getByTestId("coverage-person").filter({ hasText: "Alex Tan" });
  const fracture = alex.getByTestId("coverage-row").filter({ hasText: "Fracture" });
  await expect(fracture).toContainText("Plans like this usually include this. Your documents don’t confirm it or print an amount.");
  await expect(fracture).not.toContainText("Covered.");
  // R34-1: the schedule prints this sum, so the line says what is unread, not that nothing confirms it.
  await expect(alex.getByTestId("coverage-row").filter({ hasText: "Accidental death" }).getByTestId("coverage-to-confirm"))
    .toHaveText("To confirm: the schedule prints this amount, but its wording hasn’t been read to confirm what it pays for.");
  await expect(alex.locator(".coverage-kinds")).toContainText("Accidents and injuries (to confirm)");
  // The confirmed wording row still says Covered.
  await expect(alex.getByTestId("coverage-row").filter({ hasText: "Hospital and surgical benefit" })).toContainText("Covered.");
});

test("R32-2: a hospital benefit typed 'other', or found only on Benefits, is not listed as not found", async ({ page }) => {
  await mock(page);
  await page.goto("/ledger");
  const alex = page.getByTestId("coverage-person").filter({ hasText: "Alex Tan" });
  await expect(alex.locator(".coverage-kinds")).toContainText("Hospital and medical");
  await expect(alex.getByTestId("coverage-gaps")).not.toContainText(/hospital/i);
  const grace = page.getByTestId("coverage-person").filter({ hasText: "Grace Tan" });
  await expect(grace.getByTestId("coverage-gaps")).toContainText(/death cover/i);
  await expect(grace.getByTestId("coverage-gaps")).not.toContainText(/hospital/i);
});

test("R34-2: a guessed accident medical row does not say medical costs were found", async ({ page }) => {
  await mock(page, rows.filter((r) => r.familyMemberId === "m1" && r.policyId === PA));
  await page.goto("/ledger");
  const gaps = page.getByTestId("coverage-person").filter({ hasText: "Alex Tan" }).getByTestId("coverage-gaps");
  await expect(gaps).toContainText("plans like this may include accident medical expenses, but your documents don’t confirm it yet");
  await expect(gaps).not.toContainText("were found");
});

test("R32-1: Family and Documents mark unconfirmed cover", async ({ page }) => {
  await mock(page);
  await page.goto("/family");
  await expect(page.locator(".profile-card").filter({ hasText: "Alex Tan" })).toContainText("Accidents and injuries (to confirm)");
  await page.goto("/policies");
  // Changed 28 Oct (owner rule: a plan type is not proof of cover): the Documents card no longer prints a
  // plan-type guess ("Plans like this usually include ..."); a document with only guessed rows shows no found line.
  // The original assertion expected the guess line; see the PR body for the reason.
  // Wait until the ledger rows have reached the page (the confirmed life plan's found line shows), so the two
  // negative checks below can't pass before /api/ledger returns (Critic R307 M1).
  await expect(page.locator(".document-card").filter({ hasText: "Family Shield" }).getByTestId("document-found")).toContainText("Death");
  await expect(page.locator(".document-card").filter({ hasText: "Group PA" })).not.toContainText("Plans like this usually include");
  await expect(page.locator(".document-card").filter({ hasText: "Group PA" }).getByTestId("document-found")).toHaveCount(0);
});

test("R32-4: signing out clears the device-only 'Not in my family' answers", async ({ page }) => {
  await mock(page);
  await page.goto("/policies");
  await page.evaluate(() => localStorage.setItem("dearpolicy.notFamily", JSON.stringify(["x:S TAN"])));
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem("dearpolicy.notFamily"))).toBeNull();
});

test("a summary used as matching wording for someone's plan names them, not \"Covers nobody yet\"", async ({ page }) => {
  const ref = (id: string, name: string, linked: { id: string; name: string; relationship: string; source: string }[]) =>
    ({ ...policies[0], id, product_name: name, document_role: "product_summary", personal_coverage_confirmed: false, document_authority_label: "Reference", linked_people: linked });
  await mock(page, rows, [
    ref("00000000-0000-0000-0000-0000000000e3", "Shield Summary", [{ id: "m1", name: "Alex Tan", relationship: "self", source: "scheme_reference_match" }, { id: "m2", name: "Grace Tan", relationship: "child", source: "scheme_reference_match" }]),
    ref("00000000-0000-0000-0000-0000000000e4", "Travel brochure", []),
  ]);
  await page.goto("/policies");
  const summary = page.locator(".document-card").filter({ hasText: "Shield Summary" }).getByTestId("covers-picker");
  await expect(summary).toContainText("Used for Alex Tan, Grace Tan");
  await expect(summary).not.toContainText("nobody");
  await expect(summary.getByRole("button", { name: "Change" })).toBeVisible();
  // A reference document linked to nobody at all still says so.
  await expect(page.locator(".document-card").filter({ hasText: "Travel brochure" }).getByTestId("covers-picker")).toContainText("Covers nobody yet");
});
