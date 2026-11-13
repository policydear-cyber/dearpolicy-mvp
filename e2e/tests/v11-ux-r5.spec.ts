/**
 * Round 5 (post-launch exploratory findings) -- the household journey that
 * found them, in a real browser with real sessions (test-only Auth
 * stand-in), the real upload pipeline (local storage driver, fake
 * VirusTotal, job worker, deterministic model stand-in). Synthetic data.
 *
 *   1. a 20 MB scanned document uploads (direct-to-storage, in parts)
 *   2. deleting a household lands on a confirmation with next steps
 *   3. a group booklet can cover several people, each with a cover tier
 *   4. chat length limit + counter, an open invitation (no starter prompts),
 *      a reload mid-answer resumes the same conversation, and a two-tab
 *      conflict says what happened with a reload button
 *   5. empty portfolio, locked-PDF password on the card, wrong password
 *      named as such, delete confirmation, future DOB refused, household
 *      roster (email, no sole-owner Leave), no app nav when signed out
 * Screenshots: e2e-results/v11-ux-shots[-<label>]/r5-*.png
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { adminCreateUser, api, emailFor, newPassword, hardenNavigation } from "../support/journey";
import { generateV1Fixtures } from "../support/v1-fixtures";
import { PREFIX } from "../support/synthetic";

const SHOTS = path.resolve(process.env.V11_UX_SHOTS_DIR ?? "e2e-results/v11-ux-shots");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, label: string) => page.screenshot({ path: path.join(SHOTS, `r5-${label}.png`), fullPage: true });
/** The exploratory run's locked schedule (user password S1234567), if present on this machine. */
const LOCKED_PDF = process.env.R5_LOCKED_PDF ?? "/home/user/explore/docs/out/PA_Guardian_LOCKED_v3.pdf";
const LOCKED_PASSWORD = process.env.R5_LOCKED_PASSWORD ?? "S1234567";

const PEOPLE = { employee: "Lim Wei Jie", spouse: "Tan Mei Ling", child: "Lim Xin Yi" };

/** A synthetic group benefits booklet naming an employee, spouse and child
 * (employee / spouse / child cover tiers), with the extraction control
 * block the local deterministic reader decodes. */
async function groupBooklet(): Promise<Buffer> {
  const cov = (category: string, amount: number | null, evidence: string) => ({ category, productName: null, policyNumber: null, amount, currency: amount == null ? null : "SGD", notes: null, sourcePage: 1, evidenceText: evidence, evidenceVerified: false });
  const payload = {
    documentType: "Benefits Booklet", documentRole: "benefit_guide", documentNotes: [], insurer: "Synthetic Group Insurer (fictitious)",
    productName: `${PREFIX}-Group Insurance Programme`, productsMentioned: ["Group Term Life", "Group Personal Accident"], policyNumber: null,
    groupPolicyNumber: `${PREFIX}-GRP-01`, policyType: "Group insurance", policyholder: "Synthetic Employer Pte Ltd (fictitious)",
    personalCoverageConfirmed: false, startDate: "2026-01-01", renewalOrExpiryDate: "2026-12-31",
    insuredPeople: [
      { name: PEOPLE.employee, relationshipHint: "employee", coverages: [cov("Life", null, "36 x basic monthly salary, max S$500,000")] },
      { name: PEOPLE.spouse, relationshipHint: "spouse", coverages: [cov("Accidental death", 50000, "Spouse: S$50,000")] },
      { name: PEOPLE.child, relationshipHint: "child", coverages: [cov("Accidental death", 20000, "Child: S$20,000")] },
    ],
    referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [],
    keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = doc.addPage([595, 842]);
  ["SYNTHETIC TEST DOCUMENT - NOT A REAL POLICY", `${PREFIX} Group Insurance Programme - Employee Benefits Booklet 2026`,
    `Employee: ${PEOPLE.employee}  Spouse: ${PEOPLE.spouse}  Child: ${PEOPLE.child}`,
    "Group Term Life: 36 x basic monthly salary, max S$500,000 (employee)", "Group Personal Accident: Spouse S$50,000; Child S$20,000"]
    .forEach((line, i) => text.drawText(line, { x: 40, y: 790 - i * 20, size: 10, font }));
  const control = doc.addPage([595, 842]);
  ["DPTEST-EXTRACTION:", ...(encoded.match(/.{1,80}/g) ?? []), ":DPTEST-END"].forEach((line, i) => control.drawText(line, { x: 40, y: 800 - i * 18, size: 9, font }));
  return Buffer.from(await doc.save());
}

type PolicyRow = { id: string; original_filename: string; processing_status: string; processing_error: string | null; linked_people: { id: string; name: string; source?: string; planTier?: string | null }[]; tier_options?: string[] };
const policies = async (page: Page) => (await api<{ policies: PolicyRow[] }>(page, "/api/policies")).body.policies ?? [];
async function waitFor(page: Page, filename: string, done: (p: PolicyRow) => boolean, ms = 240_000) {
  const until = Date.now() + ms;
  for (;;) {
    const p = (await policies(page)).find((x) => x.original_filename === filename);
    if (p && done(p)) return p;
    if (Date.now() > until) return p ?? null;
    await page.waitForTimeout(3000);
  }
}
async function uploadThroughPage(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, password?: string) {
  await page.goto("/policies");
  await page.getByLabel(/Insurance document/).setInputFiles(file);
  if (password !== undefined) await page.getByLabel(/^PDF password/).fill(password);
  await page.getByRole("button", { name: /upload and read/i }).click();
  await expect(page.locator(".upload-panel .upload-status")).toContainText(/DearPolicy is reading it now/i, { timeout: 240_000 });
}

test.describe("round 5: the exploratory findings, fixed", () => {
  test.setTimeout(1_500_000);
  const email = emailFor("ux-r5");
  const password = process.env.V11_UX_SYNTHETIC_PASSWORD ?? newPassword();

  test("upload, group booklet, locked PDF, chat, empty states and household deletion", async ({ page, browser }) => {
    hardenNavigation(page);
    await adminCreateUser(email, password).catch((e) => { if (!/already|exists|registered/i.test(String(e))) throw e; });

    // Signed-out pages carry no app navigation.
    await page.goto("/login");
    await expect(page.locator("#dp-email")).toBeVisible();
    await expect(page.locator(".sidebar .nav a")).toHaveCount(0);
    await shot(page, "01-login-no-nav");
    await page.locator("#dp-email").fill(email);
    await page.locator("#dp-password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 60_000 });

    // Empty portfolio: the next step, not "everything looks current" / S$0.00.
    await expect(page.getByTestId("empty-portfolio")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("main")).not.toContainText(/Nothing to do right now|S\$0\.00|Family member's protection/);
    await shot(page, "02-empty-portfolio");
    // PR #77 (first-run): with nothing uploaded, an empty chat says to upload first and offers no fixed questions.
    await page.goto("/chat");
    const firstRun = page.getByTestId("chat-welcome");
    await expect(firstRun).toContainText("Upload a policy first", { timeout: 60_000 });
    await expect(firstRun.getByRole("link", { name: "Upload a document" })).toHaveAttribute("href", "/policies");
    await expect(page.locator(".prompt-grid")).toHaveCount(0);

    // Family; a future date of birth is refused.
    const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const refused = await api(page, "/api/family", { method: "POST", body: { displayName: `${PREFIX} Future`, relationship: "child", dateOfBirth: future } });
    expect(refused.status, "future date of birth refused by the API").toBe(400);
    const ids: Record<string, string> = {};
    for (const [relationship, name] of [["self", PEOPLE.employee], ["spouse", PEOPLE.spouse], ["child", PEOPLE.child]] as const) {
      const r = await api(page, "/api/family", { method: "POST", body: { displayName: name, relationship } });
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    }
    for (const m of (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family) ids[m.display_name] = m.id;
    await page.goto("/family");
    await page.locator("#fm-new-name").fill(`${PREFIX} Future Child`);
    await page.locator("#fm-new-relationship").selectOption("child"); // PR #65: no relationship is pre-chosen any more
    await page.locator("#fm-new-dob").fill(future);
    await page.getByRole("button", { name: "+ Add person" }).click();
    // Refused either by the browser (the field's max is today) or by the page's own check.
    await page.waitForTimeout(1500);
    const invalid = await page.locator("#fm-new-dob:invalid").count();
    if (!invalid) await expect(page.locator("main")).toContainText("A date of birth can't be in the future.");
    expect((await api<{ family: { display_name: string }[] }>(page, "/api/family")).body.family.some((m) => m.display_name.includes("Future Child")), "no profile with a future birth date").toBe(false);

    // 1. A 20 MB scanned document uploads (the exploratory run failed from 10 MB).
    const [accident] = await generateV1Fixtures({ include: "primary", only: ["accident-pdf"] });
    const big = { name: `${PREFIX}-big-scan.pdf`, mimeType: "application/pdf", buffer: Buffer.concat([accident.buffer, Buffer.from("\n%" + " ".repeat(20 * 1024 * 1024) + "\n", "latin1")]) };
    await uploadThroughPage(page, big);
    const bigRow = await waitFor(page, big.name, (p) => ["ready", "failed"].includes(p.processing_status));
    expect(bigRow?.processing_status, "the 20 MB document was accepted and read").toBe("ready");
    await shot(page, "03-large-upload");

    // 3. A group booklet covers several people, each with a cover tier.
    const booklet = { name: `${PREFIX}-group-booklet.pdf`, mimeType: "application/pdf", buffer: await groupBooklet() };
    await uploadThroughPage(page, booklet);
    const bookletRow = await waitFor(page, booklet.name, (p) => ["ready", "failed"].includes(p.processing_status));
    expect(bookletRow?.processing_status).toBe("ready");
    await page.goto("/policies");
    const card = page.locator(".document-card").filter({ hasText: "Group Insurance Programme" }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    const picker = card.getByTestId("covers-picker");
    // Once anyone is linked the picker is one "Covers …" line with a Change button; open it before using the chips.
    const openPicker = async () => {
      // PR #77: the picker is one line for every document until opened; "Choose" when nobody is linked yet, "Change" otherwise. Was: { name: "Change" } only.
      const change = picker.getByRole("button", { name: /^(?:Change|Choose)$/ });
      if (await change.isVisible().catch(() => false)) await change.click();
      await expect(picker.locator(".declare-owner")).toBeVisible({ timeout: 30_000 });
    };
    if (await picker.isVisible().catch(() => false)) {
      for (const name of Object.values(PEOPLE)) {
        await openPicker();
        const button = picker.locator(".declare-owner button").filter({ hasText: name });
        if ((await button.getAttribute("aria-pressed")) !== "true") {
          await button.click({ timeout: 30_000 });
          await expect(button).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
        }
      }
      for (const [tier, name] of [["Employee", PEOPLE.employee], ["Spouse", PEOPLE.spouse], ["Child", PEOPLE.child]] as const) {
        await openPicker();
        const select = picker.getByLabel(`${name}’s cover`);
        await select.selectOption(tier, { timeout: 30_000 });
        await expect(page.getByTestId("library-notice")).toContainText(`${name} (${tier})`, { timeout: 30_000 });
      }
      await shot(page, "04-group-booklet-three-people");
      const linked = (await policies(page)).find((p) => p.original_filename === booklet.name)!;
      expect(new Set(linked.linked_people.map((l) => l.name))).toEqual(new Set(Object.values(PEOPLE)));
      expect(Object.fromEntries(linked.linked_people.map((l) => [l.name, l.planTier]))).toEqual({ [PEOPLE.employee]: "Employee", [PEOPLE.spouse]: "Spouse", [PEOPLE.child]: "Child" });
      // Unticking one person removes only that person (a link the household made).
      const childLink = (await policies(page)).find((p) => p.original_filename === booklet.name)?.linked_people.find((l) => l.name === PEOPLE.child);
      if (childLink?.source === "user_declared") {
      await openPicker();
      await picker.locator(".declare-owner button").filter({ hasText: PEOPLE.child }).click();
      await expect(picker.locator(".declare-owner button").filter({ hasText: PEOPLE.child })).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
      expect((await policies(page)).find((p) => p.original_filename === booklet.name)!.linked_people.map((l) => l.name).sort()).toEqual([PEOPLE.spouse, PEOPLE.employee].sort());
      }
    } else {
      // The reader treated it as personal proof: every named person must still be linkable.
      await shot(page, "04-group-booklet-personal");
      expect(bookletRow?.linked_people.length ?? 0, "all named people linked").toBeGreaterThanOrEqual(3);
    }

    // 5. A locked PDF: the password is entered on its card; a wrong one is named.
    if (existsSync(LOCKED_PDF)) {
      const locked = { name: `${PREFIX}-locked.pdf`, mimeType: "application/pdf", buffer: readFileSync(LOCKED_PDF) };
      await uploadThroughPage(page, locked);
      const lockedRow = await waitFor(page, locked.name, (p) => p.processing_status === "failed");
      await page.goto("/policies");
      const lockedCard = page.locator(`.document-card[data-policy-id="${lockedRow?.id}"]`);
      await expect(lockedCard).toBeVisible({ timeout: 60_000 });
      await expect(lockedCard.getByTestId("document-locked")).toContainText("This PDF is password-protected");
      await lockedCard.getByLabel("PDF password").fill("definitely-wrong");
      await lockedCard.getByRole("button", { name: "Unlock and read" }).click();
      await waitFor(page, locked.name, (p) => p.processing_status === "failed" && /incorrect/i.test(p.processing_error ?? ""));
      await page.goto("/policies");
      await expect(lockedCard.getByTestId("document-locked")).toContainText("The password didn’t work", { timeout: 30_000 });
      await shot(page, "05-locked-wrong-password");
      await lockedCard.getByLabel("PDF password").fill(LOCKED_PASSWORD);
      await lockedCard.getByRole("button", { name: "Try again" }).click();
      const unlocked = await waitFor(page, locked.name, (p) => ["ready"].includes(p.processing_status) || (p.processing_status === "failed" && !/password/i.test(p.processing_error ?? "")));
      expect(unlocked?.processing_status, "unlocked with the right password, no re-upload").toBe("ready");
      // Deleting a document confirms it.
      await page.goto("/policies");
      await expect(lockedCard).toBeVisible({ timeout: 60_000 });
      await lockedCard.getByRole("button", { name: "Delete" }).click({ timeout: 30_000 });
      await lockedCard.getByRole("button", { name: "Confirm delete" }).click({ timeout: 30_000 });
      await expect(page.getByTestId("library-notice")).toContainText(/^Deleted /, { timeout: 30_000 });
      await shot(page, "06-delete-confirmed");
    } else {
      console.log(`locked-PDF fixture not found at ${LOCKED_PDF}: that part was skipped`);
    }

    // 4. Chat: limit + counter, this household's names, resume after reload, two-tab conflict.
    await page.goto("/chat");
    // PR #77 (first-run): no fixed starter questions; an open invitation that names nothing from another household.
    // Original (starter questions built from this household's people):
    //   const grid = page.locator(".prompt-grid");
    //   await expect(grid).toBeVisible();
    //   await expect(grid).not.toContainText(/Josephine|endowment/);
    //   await expect(grid).toContainText(PEOPLE.employee);
    const welcome = page.getByTestId("chat-welcome");
    await expect(welcome).toBeVisible();
    await expect(welcome).toContainText("Ask anything about your policies, in your own words.");
    await expect(welcome).not.toContainText(/Upload a policy first|Josephine|endowment/);
    await expect(page.locator(".prompt-grid")).toHaveCount(0);
    const box = page.getByLabel("Message to DearPolicy");
    await box.fill("x".repeat(2100));
    expect((await box.inputValue()).length).toBe(2000);
    await expect(page.locator("#chat-length")).toContainText("2,000 / 2,000");
    await shot(page, "07-chat-limit");
    await box.fill(`What is ${PEOPLE.employee} covered for?`);
    await page.getByRole("button", { name: /Send/ }).click();
    await page.waitForURL(/conversation=/, { timeout: 60_000 });
    const conversationUrl = page.url();
    await page.reload();
    await expect(page.locator(".message.user")).toHaveCount(1, { timeout: 60_000 });
    await expect(page.locator(".message.assistant")).toHaveCount(1, { timeout: 180_000 });
    const history = (await api<{ conversations: unknown[] }>(page, "/api/chat/history?scope=all")).body.conversations ?? [];
    expect(history.length, "the reload resumed the same conversation").toBe(1);
    await shot(page, "08-chat-resumed-after-reload");
    // Two tabs: the server refuses a message sent from a stale copy of the
    // chat (409, lib/chat/workflow.ts). Whether a real second tab trips that
    // check depends on server timing, so the refusal is replayed exactly as
    // the server sends it; the page must say what happened and offer a reload.
    await page.route("**/api/chat", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "This chat changed. Reopen it before sending another message." }) });
    });
    await box.fill("Is dental covered?");
    await page.getByRole("button", { name: /Send/ }).click();
    const conflict = page.getByTestId("chat-conflict");
    await expect(conflict).toContainText("updated in another tab or window", { timeout: 60_000 });
    await expect(conflict).not.toContainText("Send it again when you’re ready");
    await expect(conflict).not.toContainText("Reopen it before sending");
    await shot(page, "09-chat-conflict");
    await page.unroute("**/api/chat");
    await conflict.getByRole("button", { name: "Reload this chat" }).click();
    await expect(page.getByTestId("chat-conflict")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator(".message.assistant")).toHaveCount(1, { timeout: 60_000 });
    expect(await box.inputValue(), "the unsent message is kept").toBe("Is dental covered?");

    // Household roster: email shown, the sole owner is not offered Leave.
    // (Since the Account settings menu: the sign-in list is on People, beside the family profiles.)
    await page.goto("/family");
    await expect(page.getByTestId("household-access")).toContainText(email);
    await expect(page.getByTestId("household-access").getByRole("button", { name: "Leave" })).toHaveCount(0);
    await shot(page, "10-household-roster");

    // 2. Delete the household -> a confirmation with next steps, not an error.
    // (Deletion needs a recent sign-in; this journey is long.)
    await page.context().clearCookies();
    await page.goto("/login?next=%2Fhousehold");
    await page.locator("#dp-email").fill(email);
    await page.locator("#dp-password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => u.pathname === "/household", { timeout: 60_000 });
    const householdName = (await api<{ activeHouseholdName: string }>(page, "/api/household")).body.activeHouseholdName;
    await page.locator("#hh-delete-confirm").fill(householdName);
    await page.getByRole("button", { name: "Permanently delete household" }).click();
    await page.waitForURL(/\/household\/deleted/, { timeout: 60_000 });
    await expect(page.getByTestId("household-deleted")).toContainText("Your household has been deleted.");
    await expect(page.locator("main")).not.toContainText(/could(?: not|n.t) load|contact support/i);
    await shot(page, "11-household-deleted");
    await page.getByRole("button", { name: "Start a new household" }).click();
    await page.waitForURL(/\/family/, { timeout: 60_000 });
    await expect(page.locator("main")).not.toContainText(/could(?: not|n.t) load|contact support|No household/i);
    await shot(page, "12-new-household");
    void browser;
  });
});
