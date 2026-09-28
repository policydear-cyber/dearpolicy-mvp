/**
 * V1.1 Task 4: household screens show answers, not the system's work.
 *
 * Real sign-in (test-only Auth stand-in), a synthetic family member and one
 * synthetic personal-accident policy uploaded and processed by the real
 * pipeline (deterministic model stand-in, local fake VirusTotal, job
 * worker). Every household screen is opened, screenshotted and its visible
 * text checked for system work (model/provider/queue/search status, quotas,
 * raw errors, repair tasks, internal counts). The claims list and claim
 * detail must show the same status. The operator area refuses a household
 * account and opens for a provisioned staff account.
 *
 * Screenshots: e2e-results/v11-ux-shots[-<label>]/screen-*.png (synthetic).
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adminCreateUser, api, emailFor, newPassword, hardenNavigation, reviewerAdmin, authUserId } from "../support/journey";
import { generateV1Fixtures, printedName } from "../support/v1-fixtures";

const SHOTS = path.resolve(process.env.V11_UX_SHOTS_DIR ?? "e2e-results/v11-ux-shots");
mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.E2E_AUTH_BASE_URL ?? "http://localhost:3100";

/** System work that must never be on a household screen. */
const SYSTEM_WORK: [RegExp, string][] = [
  [/re-?analy[sz]e/i, "re-analyse"], [/re-?read all|re-?read (?:the|your) documents/i, "re-read documents"],
  [/confirm this\b|table heading/i, "confirm a heading"], [/fix a row|\bFix\b|add a row/, "fix/add rows"],
  [/semantic search|pinecone|search index/i, "search status"], [/\bdatabase\b|\bqueue\b|\bscanner\b|job worker/i, "infrastructure status"],
  [/reading model|answering model|local model|model calls?|openai|gemini|gpt-|anthropic|deterministic/i, "model names/status"],
  [/\btokens\b|quota|billing|hard stop|list price|per 1M/i, "provider cost/quota"], [/org-[A-Za-z0-9]{6,}/, "organisation id"],
  [/benefit rules|\d+ (?:of \d+ )?(?:pages|passages)|pages read|pages stored|rows in the ledger|\d+ contracts?/i, "internal counts"],
  [/ruled out|excluded or pending|not applicable here/i, "ruled-out lists"], [/confidence \d/i, "confidence scores"],
  [/Assessment ready|ECONNREFUSED|stack trace|status code \d{3}|internal server error/i, "raw status or error"],
];
const findings: string[] = [];
async function checkScreen(page: Page, label: string) {
  await page.waitForLoadState("load").catch(() => undefined);
  // Let the page finish loading its data (a first request compiles the
  // route on the local development server).
  await page.waitForFunction(() => !/Loading\b|Loading…|Checking the reviewed evidence/.test(document.querySelector("main")?.textContent ?? ""), undefined, { timeout: 120_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, `screen-${label}.png`), fullPage: true });
  const text = await page.locator("body").innerText();
  // A plain-text transcript of what the person sees (synthetic data only).
  writeFileSync(path.join(SHOTS, `screen-${label}.txt`), (await page.locator("main").innerText().catch(() => text)).trim() + "\n");
  for (const [re, what] of SYSTEM_WORK) {
    const m = text.match(re);
    if (m) findings.push(`${label}: ${what} -- "${text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 60).replace(/\s+/g, " ")}"`);
  }
}
async function signIn(page: Page, email: string, password: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.waitForLoadState("load");
  await page.waitForTimeout(1500);
  await page.locator("#dp-email").fill(email);
  await page.locator("#dp-password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => u.pathname === next, { timeout: 60_000 });
}
async function ask(page: Page, question: string) {
  await page.getByLabel("Message to DearPolicy").fill(question);
  await page.getByRole("button", { name: /Send/ }).click();
  const before = await page.locator(".message.assistant").count();
  await expect(page.locator(".message.assistant")).toHaveCount(before + 1, { timeout: 150_000 }).catch(() => undefined);
  await expect(page.locator(".thinking")).toHaveCount(0, { timeout: 150_000 }).catch(() => undefined);
}

test.describe("household screens show answers, not the system's work", () => {
  test.setTimeout(900_000);
  const email = emailFor("ux-screens");
  const password = process.env.V11_UX_SYNTHETIC_PASSWORD ?? newPassword();

  test("every household screen; claims list and detail agree; operator area gated", async ({ page }) => {
    hardenNavigation(page);
    await adminCreateUser(email, password).catch((e) => { if (!/already|exists|registered/i.test(String(e))) throw e; });
    await signIn(page, email, password, "/family");

    // A synthetic family member and a synthetic personal-accident policy.
    const displayName = printedName("Charmaine");
    let family = (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family ?? [];
    let member = family.find((m) => m.display_name === displayName);
    if (!member) {
      const created = await api(page, "/api/family", { method: "POST", body: { displayName, relationship: "self", preferredName: "Charmaine" } });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      family = (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family ?? [];
      member = family.find((m) => m.display_name === displayName)!;
    }
    const [fixture] = await generateV1Fixtures({ include: "primary", only: ["accident-pdf"] });
    const upload = await page.context().request.post(new URL("/api/policies/upload", BASE).toString(), {
      headers: { origin: new URL(BASE).origin },
      multipart: { file: { name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer }, familyMemberId: member.id },
      timeout: 180_000,
    });
    expect(upload.status(), (await upload.text()).slice(0, 300)).toBeLessThan(300);
    let status = "";
    for (let i = 0; i < 90; i++) {
      const p = (await api<{ policies: { original_filename: string; processing_status: string }[] }>(page, "/api/policies")).body.policies?.find((x) => x.original_filename === fixture.name);
      status = p?.processing_status ?? "";
      if (["ready", "failed", "error"].includes(status)) break;
      await page.waitForTimeout(3000);
    }
    console.log(`synthetic policy processing status: ${status}`);

    await page.goto("/"); await checkScreen(page, "01-portfolio");
    await page.goto("/policies"); await checkScreen(page, "02-documents");
    const details = page.getByRole("button", { name: "Details" }).first();
    if (await details.isVisible().catch(() => false)) { await details.click(); await checkScreen(page, "03-document-details"); }
    await page.goto("/schedule"); await checkScreen(page, "04-benefits");
    const source = page.locator("details.source-details > summary").first();
    if (await source.isVisible().catch(() => false)) { await source.click(); await checkScreen(page, "05-benefits-source-open"); }
    await page.goto("/ledger"); await checkScreen(page, "06-coverage");
    await page.goto(`/coverage?member=${member.id}&category=${encodeURIComponent("Personal Accident")}`); await checkScreen(page, "07-coverage-category");
    await page.goto("/usage"); await checkScreen(page, "08-plan-usage");
    await page.goto("/household"); await checkScreen(page, "09-household");

    // Navigation: no Usage & Cost, no operator link.
    const navText = await page.locator("nav.nav").innerText();
    expect.soft(navText, "household navigation").not.toMatch(/Usage/);
    expect.soft(navText, "household navigation").not.toMatch(/Operator/);

    // A factual question, then a claim event.
    await page.goto(`/chat?member=${member.id}`);
    await ask(page, "What does Charmaine's AccidentGuard policy pay for a fracture?");
    await checkScreen(page, "10-chat-factual");
    const citations = page.locator("details.citations").last();
    if (await citations.isVisible().catch(() => false)) {
      expect.soft(await citations.evaluate((el) => (el as HTMLDetailsElement).open), "sources start collapsed").toBe(false);
    }
    await page.getByRole("button", { name: "New chat" }).click();
    await ask(page, "Charmaine broke her arm");
    await checkScreen(page, "11-chat-claim-start");
    // Answer the interview's questions (one at a time) so a claim is recorded.
    for (let turn = 0; turn < 6; turn++) {
      const last = page.locator(".message.assistant").last();
      const question = last.locator(".fact-question").first();
      if (!(await question.isVisible().catch(() => false))) break;
      const options = question.locator(".quick-replies button:not([disabled])");
      const texts = (await options.allInnerTexts()).map((t) => t.trim());
      const prefer = texts.find((t) => /^(an accident|accident|singapore|yes|outpatient|a&e)/i.test(t)) ?? texts[0];
      const before = await page.locator(".message.assistant").count();
      if (prefer) await options.filter({ hasText: prefer }).first().click();
      else {
        const input = question.locator("input").first();
        if (!(await input.isVisible().catch(() => false))) break;
        await input.fill((await input.getAttribute("type")) === "date" ? "2026-09-20" : "She went to A&E and had a cast put on.");
        await question.getByRole("button", { name: "Answer" }).click();
      }
      await expect(page.locator(".message.assistant")).toHaveCount(before + 1, { timeout: 150_000 }).catch(() => undefined);
      await expect(page.locator(".thinking")).toHaveCount(0, { timeout: 150_000 }).catch(() => undefined);
    }
    await checkScreen(page, "11b-chat-claim-after-answers");

    // Claims list and claim detail agree.
    await page.goto("/claims"); await checkScreen(page, "12-claims-list");
    const entries = page.locator('[data-testid="claim-entry"], .claim-session-entry');
    if (await entries.count()) {
      const listLabel = (await entries.first().locator('[data-testid="claim-status"], .claim-session-status').first().innerText({ timeout: 10_000 }).catch(() => "(no status in the list)")).trim();
      const href = await entries.first().locator(".claim-session-card").getAttribute("href");
      const id = (href ?? "").match(/[0-9a-f-]{36}/g)?.pop();
      await page.goto(`/claims/${id}`);
      const detailLabel = (await page.locator('[data-testid="claim-display-label"]').innerText({ timeout: 30_000 }).catch(() => "(no status shown on the detail page)")).trim();
      await checkScreen(page, "13-claim-detail");
      expect.soft(detailLabel.toLowerCase(), "claims list and claim detail show the same status").toBe(listLabel.toLowerCase());
      const requested = await page.locator('[data-testid="claim-requested-documents"]').innerText().catch(() => "");
      expect.soft(requested, "a fracture claim never asks for death documents").not.toMatch(/death certificate|coroner/i);
    } else {
      findings.push("claims: no claim was recorded for 'Charmaine broke her arm'");
    }

    // Operator area: refused for a household account...
    const refused = await page.goto("/operator");
    expect.soft(refused?.status(), "operator area refuses a household account").toBe(404);
    await page.screenshot({ path: path.join(SHOTS, "screen-14-operator-refused.png"), fullPage: true });
    // ...and open to a provisioned DearPolicy staff account.
    const userId = await authUserId(email);
    reviewerAdmin(["provision", "--user", userId, "--label", "Synthetic operator", "--operator", "e2e-operator"]);
    const allowed = await page.goto("/operator");
    expect.soft(allowed?.status(), "operator area opens for a staff account").toBe(200);
    await expect.soft(page.locator('[data-testid="operator-budget"]')).toContainText("The provider enforces it; DearPolicy does not and cannot");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SHOTS, "screen-15-operator-overview.png"), fullPage: true });
    await page.goto("/operator/benefits"); await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOTS, "screen-16-operator-benefits.png"), fullPage: true });
    // Suspending the staff account closes the area again at once.
    reviewerAdmin(["suspend", "--user", userId, "--reason", "end of synthetic check", "--operator", "e2e-operator"]);
    expect.soft((await page.goto("/operator"))?.status(), "suspended staff account is refused").toBe(404);

    console.log(findings.length ? `SYSTEM WORK ON HOUSEHOLD SCREENS:\n${findings.join("\n")}` : "No system work found on any household screen.");
    expect(findings, "household screens must not show the system's work").toEqual([]);
  });
});
