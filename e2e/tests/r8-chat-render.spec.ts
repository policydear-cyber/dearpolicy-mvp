/**
 * Round 8: chat answers DISPLAY cleanly on a phone (375x812) and a desktop
 * (1280x800). Every answer here is a real answer the backend produced for
 * the two fixture households (scripts/r6/fixture.ts, scripts/r7/fixture.ts)
 * through the batteries (scripts/r6/battery.ts, scripts/r7/battery.ts,
 * scripts/r7/claims-battery.ts), recorded in e2e/support/r8-answers.json,
 * plus a few synthetic edge cases (x*-: very long names, Chinese and Malay
 * text, 14 citations, a deleted document, an indicative estimate card).
 *
 * The real chat page is driven in Chromium -- typed question, Send, pending
 * state, answer -- with only the household APIs answered from the recording,
 * so the page needs nothing but the Next.js app (no database, worker or
 * model). Asserted for each answer at both sizes:
 *   no horizontal page scroll; no raw markdown, HTML entities or escaped
 *   "\n"; no console errors or hydration warnings; every control at least
 *   44px (phone) / 24px (desktop); no empty or duplicated cards; every
 *   control named; WCAG AA text contrast; Chinese text drawn with real
 *   glyphs; the new answer's first line scrolled into view.
 *
 * Fixed set by default; R8_RENDER_FULL=1 runs all recorded answers and
 * R8_RENDER_SHOTS=<dir> keeps a screenshot of each.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts
 * (app started with DEV_AUTH_ENABLED=true, as in .github/workflows/browser-e2e.yml)
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { collectRenderIssues, type RenderIssue } from "../support/r8-render-checks";
import type { ChatAnswer } from "../../types";

type Case = { id: string; question: string; answer: ChatAnswer; restore?: boolean };
const ALL: Case[] = JSON.parse(readFileSync(path.join(__dirname, "../support/r8-answers.json"), "utf8"));
const FIXED = ["00-short", "02-greeting", "04-refusal", "07-bilingual", "08-bilingual", "09-notfound", "13-renewal", "16-premium", "19-tier", "21-multi-person", "27-portfolio",
  "30-citations", "32-limits", "35-person-choice", "38-fact-question-choice", "40-fact-question-date", "42-fact-question-text", "44-factfinding-plan", "50-claim-conclusion",
  "53-death", "57-review-partial", "71-claim-items-many", "73-conditions", "75-ff-documents", "x1-long-names", "x2-chinese", "x3-many-citations", "x4-invalidated", "x5-composition", "x6-currency-unknown"];
const CASES = process.env.R8_RENDER_FULL === "1" ? ALL : ALL.filter((c) => FIXED.includes(c.id));
const SHOTS = process.env.R8_RENDER_SHOTS ? path.resolve(process.env.R8_RENDER_SHOTS) : null;
const REPORT = process.env.R8_RENDER_REPORT ? path.resolve(process.env.R8_RENDER_REPORT) : null;
if (process.env.E2E_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } });

const FAMILY = [
  { id: "m-self", display_name: "Tan Mei Ling", relationship: "self", policy_count: 4 },
  { id: "m-spouse", display_name: "Lim Wei Jie", relationship: "spouse", policy_count: 5 },
  { id: "m-child", display_name: "Lim Xin Yi", relationship: "child", policy_count: 2 },
  { id: "m-long", display_name: "Muhammad Abdul Rahman bin Mohamed Iskandar Shah Alauddin", relationship: "parent", policy_count: 1 },
];
const HISTORY = [
  { id: "c-old-1", family_member_id: "m-spouse", title: "Wei Jie broke his arm at the playground — what can we claim under the PA plan and the shield plan?", updated_at: "2026-09-29T08:00:00Z", revision: "3" },
  { id: "c-old-2", family_member_id: null, title: "我们的保单什么时候续保？", updated_at: "2026-09-12T08:00:00Z", revision: "1" },
];
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

type Script = { answer?: ChatAnswer; post?: { status: number; body: unknown }; pendingPolls?: number; job?: (poll: number) => { status: number; body: unknown }; restore?: { messages: unknown[]; pendingJob?: unknown } };
async function mockHousehold(page: Page, script: Script) {
  let polls = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname, method = route.request().method();
    if (p === "/api/health") return json(route, { ok: true, hosted: true });
    if (p === "/api/family") return json(route, { family: FAMILY });
    if (p === "/api/chat/history" && method === "GET") return json(route, { conversations: HISTORY, nextCursor: null });
    if (p.startsWith("/api/chat/history/")) return json(route, { conversation: { id: "c-restore", revision: 2, family_member_id: null }, messages: script.restore?.messages ?? [], pendingJob: script.restore?.pendingJob ?? null, nextCursor: null });
    if (p === "/api/chat" && method === "POST") {
      if (script.post) return json(route, script.post.body, script.post.status);
      return json(route, { conversationId: "c-new", conversationRevision: 1, jobId: "job-1", familyMemberId: null });
    }
    if (p.startsWith("/api/chat/jobs/")) {
      if (method === "DELETE") return json(route, { ok: true });
      polls++;
      if (script.job) { const r = script.job(polls); return json(route, r.body, r.status); }
      if (polls <= (script.pendingPolls ?? 1)) return json(route, { job: { status: "running", progress: { stage: "Checking your policies…", completed: polls, total: 4 } } });
      return json(route, { job: { status: "complete" }, result: { answer: { ...script.answer, conversationId: "c-new", conversationRevision: 2 } } });
    }
    return json(route, {});
  });
}

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || (m.type() === "warning" && /hydrat|did not match|Each child in a list/i.test(m.text()))) errors.push(m.type() + ": " + m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  return errors;
}

async function openChat(page: Page, url = "/chat") {
  await page.goto(url);
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
}
async function ask(page: Page, question: string) {
  await page.getByLabel("Message to DearPolicy").fill(question);
  await page.getByRole("button", { name: /^Send/ }).click();
}
async function issues(page: Page, minTarget: number, extra: RenderIssue[] = []) {
  const found = await page.evaluate(collectRenderIssues, { root: ".chat-page", minTarget });
  return [...found, ...extra].map((i) => `${i.kind}: ${i.detail}`);
}
async function newestAnswerInView(page: Page): Promise<RenderIssue[]> {
  await page.waitForTimeout(700); // smooth scroll settles
  const top = await page.locator(".message.assistant").last().evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, vh: window.innerHeight }; });
  return top.top >= -1 && top.top < top.vh - 80 ? [] : [{ kind: "scroll", detail: `newest answer starts at y=${Math.round(top.top)} of ${top.vh}` }];
}
const shot = async (page: Page, size: string, id: string) => {
  if (!SHOTS) return;
  mkdirSync(path.join(SHOTS, size), { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, size, `${id}.png`), fullPage: true });
  const answer = page.locator(".message.assistant").last();
  if (await answer.count()) await answer.screenshot({ path: path.join(SHOTS, size, `${id}-answer.png`) });
};

const SIZES = [
  { name: "phone", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, minTarget: 44, dark: false, cases: CASES },
  { name: "desktop", viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, minTarget: 24, dark: false, cases: CASES },
  // Dark theme on a phone: the same answers, checked for contrast and stray light-only colours.
  { name: "phone-dark", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, minTarget: 44, dark: true, cases: ALL.filter((c) => FIXED.includes(c.id)) },
];
for (const size of SIZES) {
  test.describe(`chat render · ${size.name}`, () => {
    test.use({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch, deviceScaleFactor: 1 });
    if (size.dark) test.beforeEach(async ({ page }) => { await page.addInitScript(() => { try { localStorage.setItem("dearpolicy-theme", "dark"); } catch { /* ignore */ } }); });

    for (const c of size.cases) {
      test(`${c.id}: ${c.question.slice(0, 50)}`, async ({ page }) => {
        const errors = watchConsole(page);
        if (c.restore) {
          await mockHousehold(page, { restore: { messages: [{ id: "u1", role: "user", content: c.question }, { id: "a1", role: "assistant", content: c.answer.summary, answer_json: c.answer }] } });
          await openChat(page, "/chat?conversation=c-restore");
          await expect(page.locator(".message.assistant")).toHaveCount(1);
        } else {
          await mockHousehold(page, { answer: c.answer });
          await openChat(page);
          await ask(page, c.question);
          await expect(page.locator(".message.assistant .message-body:not(.thinking)")).toHaveCount(1, { timeout: 20_000 });
        }
        const scroll = c.restore ? [] : await newestAnswerInView(page);
        // Open every collapsed section so what it hides is checked too.
        await page.locator(".chat-window details:not([open]) > summary").evaluateAll((els) => els.forEach((el) => (el.parentElement as HTMLDetailsElement).open = true));
        if (/[\u4e00-\u9fff]/.test(c.question + c.answer.summary)) await expect(page.locator(".chat-window")).toContainText(/[\u4e00-\u9fff]/);
        await shot(page, size.name, c.id);
        const found = await issues(page, size.minTarget, scroll);
        if (REPORT) appendFileSync(REPORT, JSON.stringify({ size: size.name, id: c.id, issues: found, errors }) + "\n");
        expect({ issues: found, consoleErrors: errors }).toEqual({ issues: [], consoleErrors: [] });
      });
    }

    test("states: pending answer, failed answer, two-tab conflict, deleted document, restored pending job", async ({ page }) => {
      const errors = watchConsole(page);
      const answer = CASES[0].answer;
      // Slow answer: the pending bubble shows progress, then the answer replaces it in place.
      await mockHousehold(page, { answer, pendingPolls: 3 });
      await openChat(page);
      await ask(page, "When do our policies renew?");
      await expect(page.locator(".message-body.thinking")).toBeVisible();
      await expect(page.locator(".message-body.thinking")).toContainText("Checking your policies");
      expect(await issues(page, size.minTarget)).toEqual([]);
      await shot(page, size.name, "state-pending");
      await expect(page.locator(".message.assistant .message-body:not(.thinking)")).toHaveCount(1, { timeout: 20_000 });
      await expect(page.locator(".message-body.thinking")).toHaveCount(0);
      if (size.isMobile) {
        // The on-screen keyboard (Android resizes the page to what is left):
        // the message box and Send stay on screen, uncovered by the tab bar.
        await page.setViewportSize({ width: 375, height: 480 });
        await page.getByLabel("Message to DearPolicy").focus();
        await page.getByLabel("Message to DearPolicy").fill("and my wife?");
        await page.waitForTimeout(300);
        const covered = await page.evaluate(() => ["textarea[aria-label='Message to DearPolicy']", ".chat-composer button[type=submit]"].map((sel) => {
          const el = document.querySelector(sel)!; const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return r.top >= 0 && r.bottom <= window.innerHeight && !!hit && el.contains(hit) ? null : `${sel} hidden or covered (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)})`;
        }).filter(Boolean));
        expect(covered).toEqual([]);
        await shot(page, size.name, "state-keyboard");
        await page.setViewportSize(size.viewport);
      }
      await page.unrouteAll({ behavior: "wait" });

      // A failed job with an internal error: the plain fallback, never the internals.
      await mockHousehold(page, { job: () => ({ status: 200, body: { job: { status: "failed", error: "ECONNRESET: socket hang up at gemini model_call req_id=abc" } } }) });
      await openChat(page);
      await ask(page, "What does my hospital plan cover?");
      await expect(page.locator(".chat-window [role=alert]")).toContainText("could not finish this answer");
      await expect(page.locator(".chat-window")).not.toContainText(/ECONN|gemini|req_id/);
      expect(await issues(page, size.minTarget)).toEqual([]);
      await shot(page, size.name, "state-failed");
      await page.unrouteAll({ behavior: "wait" });

      // Two tabs: the server refuses a stale copy (409).
      await mockHousehold(page, { post: { status: 409, body: { error: "This chat changed in another tab. Reopen it." } } });
      await openChat(page);
      await ask(page, "and my wife?");
      await expect(page.getByTestId("chat-conflict")).toBeVisible();
      expect(await issues(page, size.minTarget)).toEqual([]);
      await shot(page, size.name, "state-conflict");
      await page.unrouteAll({ behavior: "wait" });

      // Reopened mid-answer: the pending job resumes and resolves.
      await mockHousehold(page, { answer, pendingPolls: 1, restore: { messages: [{ id: "u0", role: "user", content: "hi" }, { id: "a0", role: "assistant", content: "Hello! Ask me anything about your family's policies.", answer_json: { ...answer, summary: "Hello! Ask me anything about your family's policies.", details: [], citations: [] } }], pendingJob: { id: "job-9", message: "When do our policies renew?" } } });
      await openChat(page, "/chat?conversation=c-restore");
      await expect(page.locator(".message.assistant .message-body:not(.thinking)")).toHaveCount(2, { timeout: 20_000 });
      expect(await issues(page, size.minTarget)).toEqual([]);
      // The browser itself logs the 409 this test sends on purpose; nothing else may appear.
      expect(errors.filter((e) => !/Failed to load resource: the server responded with a status of 409/.test(e))).toEqual([]);
    });
  });
}

/* The claim screens the chat links to ("Upload documents for this claim",
 * "Continue answering questions"), with a death claim and a hospital claim. */
const CLAIMS = [
  { id: "cl-death", family_member_id: "m-spouse", conversation_id: "c-old-1", display_name: "Lim Wei Jie", relationship: "spouse", event_summary: "Death of Lim Wei Jie — motorcycle accident in Phuket, Thailand", updated_at: "2026-09-30T02:00:00Z",
    display: { label: "Documents needed", tone: "waiting", hasEstimate: false, requestedDocuments: ["Death certificate", "Police or accident report", "Coroner's report, if there was an inquiry", "Proof of relationship to the deceased"] } },
  { id: "cl-hosp", family_member_id: "m-long", conversation_id: null, display_name: "Muhammad Abdul Rahman bin Mohamed Iskandar Shah Alauddin", relationship: "parent", event_summary: "Hospital stay at Mount Elizabeth Novena Hospital for a knee replacement (total knee arthroplasty)", updated_at: "2026-09-21T02:00:00Z",
    display: { label: "Assessment ready", tone: "ready", hasEstimate: true, requestedDocuments: [] } },
  { id: "cl-open", family_member_id: "m-child", conversation_id: "c-old-2", display_name: "Lim Xin Yi", relationship: "child", event_summary: "林欣怡 broke her right arm at school", updated_at: "2026-09-29T02:00:00Z",
    display: { label: "Questions to answer", tone: "info", hasEstimate: false, requestedDocuments: [] } },
];
const DOCS: Record<string, unknown[]> = {
  "cl-death": [{ id: "d1", document_type: "death_certificate", original_filename: "death-certificate-scan-2026-09-01-final-version-signed.pdf", status: "needs_review", scan_status: "clean", identity_status: "confirmed", processing_error_code: null, created_at: "2026-09-30T02:00:00Z", reviewStatus: "in_review",
    extraction: { id: "e1", reviewed_fields: null, identity_conflicts: [], extracted_fields: { deceasedName: "LIM WEI JIE", otherNamesMentioned: [], personIdentifiers: [], dateOfDeath: "2026-08-24", statedCauseOfDeath: "Multiple injuries — road traffic accident", mannerOfDeath: "Accident", issuingAuthority: "Royal Thai Police, Phuket Provincial Police", documentReference: null, documentType: "death_certificate", pageCitations: [], confidence: {} } } }],
  "cl-hosp": [{ id: "d2", document_type: "hospital_bill", original_filename: "MEN-final-bill.pdf", status: "needs_review", scan_status: "clean", identity_status: "confirmed", processing_error_code: null, created_at: "2026-09-20T02:00:00Z", reviewStatus: null,
    extraction: { id: "e2", reviewed_fields: null, identity_conflicts: [], extracted_fields: { deceasedName: null, otherNamesMentioned: [], personIdentifiers: [], dateOfDeath: null, statedCauseOfDeath: null, mannerOfDeath: null, issuingAuthority: null, documentReference: null, documentType: "hospital_bill", confidence: {},
      pageCitations: [{ field: "billLineItems", pageStart: 2, pageEnd: 3, excerpt: "" }], patientName: "Muhammad Abdul Rahman bin Mohamed Iskandar Shah Alauddin", hospitalName: "Mount Elizabeth Novena Hospital", hospitalCountry: "Singapore", admissionDate: "2026-09-10", dischargeDate: "2026-09-14", admissionType: "Inpatient", wardType: "Single room",
      billLineItems: [{ category: "Room and board", description: "Single room, 4 nights", amountText: "4,280.00", currency: "SGD" }, { category: "Surgeon's fee", description: "Total knee arthroplasty (right)", amountText: "18,500.00", currency: "SGD" }],
      thirdPartyPayments: [{ source: "MediSave", amountText: "3,950.00", currency: "SGD" }, { source: "Cash", amountText: "1,200.00", currency: "SGD" }] } } }],
};
const ESTIMATE = { claimSessionId: "cl-hosp", eventType: "hospitalisation", notice: "An indicative estimate from reviewed evidence. The insurer decides eligibility and the final amount.", hasEstimate: true,
  benefits: [{ title: "Hospital inpatient treatment (as charged)", status: "included", amountText: "S$19,330.00", currency: "SGD", reason: "The reviewed bill and the policy's as-charged benefit support this amount after the S$3,500 deductible and 10% co-insurance.", citations: [{ policyName: "MediGuard Integrated Shield", pageStart: 4, pageEnd: 5 }] },
    { title: "Daily hospital cash", status: "needs_document", amountText: null, currency: null, reason: "Upload the discharge summary showing the nights in hospital.", citations: [] }],
  totalsByCurrency: [{ currency: "SGD", amountText: "S$19,330.00" }], outstandingQuestions: ["Was any part of the bill paid by another insurer?"] };
async function mockClaims(page: Page) {
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/health") return json(route, { ok: true, hosted: true });
    if (p === "/api/claims") return json(route, { claims: CLAIMS });
    const one = p.match(/^\/api\/claims\/(cl-[a-z]+)$/);
    if (one) { const c = CLAIMS.find((x) => x.id === one[1]); return json(route, { claim: { ...c, status: "open", facts: { eventType: c?.id === "cl-death" ? "death" : "hospitalisation" }, decision_packet: null } }); }
    if (p === "/api/claims/evidence") return json(route, { documents: DOCS[new URL(route.request().url()).searchParams.get("claimSessionId") ?? ""] ?? [] });
    if (/\/indicative$/.test(p)) return json(route, { estimate: p.includes("cl-hosp") ? ESTIMATE : { ...ESTIMATE, hasEstimate: false, benefits: [], totalsByCurrency: [], outstandingQuestions: [] } });
    return json(route, {});
  });
}
for (const size of SIZES) {
  test.describe(`claim screens · ${size.name}`, () => {
    test.use({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch, deviceScaleFactor: 1 });
    if (size.dark) test.beforeEach(async ({ page }) => { await page.addInitScript(() => { try { localStorage.setItem("dearpolicy-theme", "dark"); } catch { /* ignore */ } }); });
    for (const url of ["/claims", "/claims/cl-death", "/claims/cl-hosp"]) {
      test(url, async ({ page }) => {
        const errors = watchConsole(page);
        await mockClaims(page);
        await page.goto(url);
        await expect(page.locator(".page h1")).toBeVisible();
        if (url === "/claims") await expect(page.getByTestId("claim-entry")).toHaveCount(3);
        else await expect(page.getByTestId("indicative-estimate")).toBeVisible();
        await page.waitForTimeout(300);
        if (SHOTS) { mkdirSync(path.join(SHOTS, size.name), { recursive: true }); await page.screenshot({ path: path.join(SHOTS, size.name, `claims-${url.split("/").pop()}.png`), fullPage: true }); }
        const found = (await page.evaluate(collectRenderIssues, { root: ".main-content", minTarget: size.minTarget })).map((i) => `${i.kind}: ${i.detail}`);
        if (REPORT) appendFileSync(REPORT, JSON.stringify({ size: size.name, id: url, issues: found, errors }) + "\n");
        expect({ issues: found, consoleErrors: errors }).toEqual({ issues: [], consoleErrors: [] });
      });
    }
  });
}
