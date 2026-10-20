/**
 * The chat answer on a phone, against "bottom line first, short cards, sources one tap away", for three states: an
 * answer the documents leave to confirm, an either/or amount (never added together), and the stop when a question
 * reaches the model-use limit. Synthetic household and answers; chat APIs mocked. Needs only the Next.js app with
 * DEV_AUTH_ENABLED=true, like r8-chat-render. R8_PHONE_SHOTS=<dir> also saves a screenshot of each answer.
 *
 *   E2E_R8_BASE_URL=http://localhost:3200 npx playwright test -c e2e/playwright.r8.config.ts r8-chat-phone-states
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page, type Route } from "@playwright/test";

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const SHOTS = process.env.R8_PHONE_SHOTS;
const FAMILY = [{ id: "m1", display_name: "Alex Tan", relationship: "self", policy_count: 2 }, { id: "m2", display_name: "Grace Tan", relationship: "child", policy_count: 2 }];
const [LOW, HIGH] = (process.env.R8_EITHER ?? "S$1,000|S$100,000").split("|");

const base = { mode: "answer", details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], claimSessionId: null, questions: [], knownFacts: [], missingFacts: [],
  disclaimer: "Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.", policyStatedLimits: [], potentialPayoutTotals: [], payoutQualifiers: [] };
const cite = (chunkId: string, policyName: string, page: number, excerpt: string) => ({ chunkId, policyId: "p-" + chunkId, policyName, pageStart: page, pageEnd: page, excerpt });

const ANSWERS: Record<string, unknown> = {
  toConfirm: { ...base,
    summary: "Grace’s Family Shield plan usually includes a hospital benefit, but her documents don’t confirm it or print an amount. Upload the Family Shield policy wording so DearPolicy can check what it pays.",
    bottomLine: "Not confirmed yet: plans like Grace’s Family Shield usually include a hospital benefit, but her documents don’t print one.",
    nextSteps: ["Upload the Family Shield policy wording."],
    citations: [cite("c1", "Family Shield", 2, "Schedule of benefits: Death S$300,000; Critical illness S$100,000.")],
    statements: [
      { id: "s1", kind: "uncertainty", text: "Grace’s Family Shield schedule lists death and critical illness cover only.", fullText: "Grace’s Family Shield schedule lists death and critical illness cover only.", conditions: [],
        source: { policyName: "Family Shield", page: 2, citationIds: ["c1"] } },
      { id: "s2", kind: "not_found", text: "No hospital benefit or amount was found in the documents on file.", fullText: "No hospital benefit or amount was found in the documents on file.", conditions: [] },
    ] },
  eitherOr: { ...base,
    summary: `For Grace’s wrist fracture, Group PA pays either ${LOW} or ${HIGH}, depending on how the injury is assessed. These are alternatives, never added together.`,
    bottomLine: `Grace’s wrist fracture: either ${LOW} or ${HIGH}, depending on how the injury is assessed. Never both.`,
    citations: [cite("c2", "Group PA", 13, "Fracture of the wrist: 25% of the fracture benefit limit."), cite("c3", "Group PA", 8, "Permanent loss of use of a hand: 20% of the sum insured.")],
    statements: [
      { id: "e1", kind: "calculation", personName: "Grace Tan", text: "If it is treated as a fracture: 25% of the fracture benefit.", fullText: `If it is treated as a fracture, Group PA pays 25% of the fracture benefit, ${LOW}.`,
        amount: { text: LOW, currencyResolved: true, illustration: true }, basis: "25% of the fracture benefit limit", conditions: ["The fracture is confirmed by X-ray.", "The claim is made within 30 days."],
        source: { policyName: "Group PA", page: 13, rowLabel: "Wrist", citationIds: ["c2"] }, group: { id: "g1", kind: "either_or", note: "These are alternatives for the same injury, never a total." } },
      { id: "e2", kind: "calculation", personName: "Grace Tan", text: "If it leaves permanent loss of use of the hand: 20% of the sum insured.", fullText: `If it leaves permanent loss of use of the hand, Group PA pays 20% of the sum insured, ${HIGH}.`,
        amount: { text: HIGH, currencyResolved: true, illustration: true }, basis: "20% of the accident sum insured", conditions: ["The loss of use is permanent after 12 months.", "The claim is made within 30 days."],
        source: { policyName: "Group PA", page: 8, rowLabel: "Loss of use of one hand", citationIds: ["c3"] }, group: { id: "g1", kind: "either_or", note: "These are alternatives for the same injury, never a total." } },
    ] },
  budgetStop: { ...base, confidence: "low",
    summary: "I couldn’t finish: this question reached the limit set for model use on a single question, so I stopped before answering. If the question is about several people or policies, asking about each one separately usually stays within it." },
};

async function mock(page: Page, answer: unknown) {
  let polls = 0;
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname, method = route.request().method();
    if (p === "/api/family") return json(route, { family: FAMILY });
    if (p === "/api/chat/history" && method === "GET") return json(route, { conversations: [], nextCursor: null });
    if (p === "/api/chat" && method === "POST") return json(route, { conversationId: "c-new", conversationRevision: 1, jobId: "job-1", familyMemberId: null });
    if (p.startsWith("/api/chat/jobs/")) {
      if (++polls <= 1) return json(route, { job: { status: "running", progress: { stage: "Checking your policies…", completed: 1, total: 4 } } });
      return json(route, { job: { status: "complete" }, result: { answer: { ...(answer as object), conversationId: "c-new", conversationRevision: 2 } } });
    }
    return json(route, {});
  });
}
async function askOnPhone(page: Page, id: string, question: string) {
  await mock(page, ANSWERS[id]);
  await page.goto("/chat");
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
  await page.getByLabel("Message to DearPolicy").fill(question);
  await page.getByRole("button", { name: /^Send/ }).click();
  // The progress card shows, then gives way to the answer.
  await expect(page.getByText("Checking your policies").first()).toBeVisible();
  await expect(page.getByText("Checking your policies")).toHaveCount(0, { timeout: 20_000 });
  const answer = page.locator(".message.assistant").last();
  return answer;
}
async function shot(page: Page, id: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(500);
  // The fixed message box and tab bar would sit over the middle of a tall answer's picture.
  const hide = await page.addStyleTag({ content: ".chat-composer, .sidebar, nextjs-portal { visibility: hidden !important; }" });
  await page.locator(".message.assistant").last().screenshot({ path: path.join(SHOTS, `${id}.png`) });
  await hide.evaluate((el) => (el as Element).remove());
  await page.screenshot({ path: path.join(SHOTS, `${id}-screen.png`) });
}
/** How far down the phone screen the first line of the answer starts. */
const topOf = (el: Locator) => el.evaluate((e) => Math.round(e.getBoundingClientRect().top));

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test("to confirm: the bottom line says so first, and the next step is right under it", async ({ page }) => {
  const answer = await askOnPhone(page, "toConfirm", "Is Grace covered for a hospital stay?");
  await expect(answer.getByTestId("answer-bottom-line")).toContainText("Not confirmed yet");
  await expect(answer.getByTestId("answer-bottom-line")).toHaveClass(/to-confirm/);
  // The step that settles it sits with the answer, before the collapsed sources.
  expect(await topOf(answer.getByTestId("next-step"))).toBeLessThan(await topOf(answer.getByTestId("answer-where")));
  // Said once: the summary's restatement of the bottom line and the step itself are not repeated under "Also in this answer".
  await expect(answer.getByTestId("answer-remaining")).toHaveCount(0);
  await shot(page, "1-to-confirm");
});

test("either/or: two options, joined by or, never a total, each source one tap away", async ({ page }) => {
  const answer = await askOnPhone(page, "eitherOr", "How much would Grace get for a wrist fracture?");
  const block = answer.getByTestId("answer-either");
  await expect(block.getByTestId("answer-card")).toHaveCount(2);
  await expect(block).toContainText("or");
  await expect(answer).not.toContainText(/total of|in total|combined/i);
  // A shared condition is said once.
  await expect(block.getByTestId("answer-either-shared")).toContainText("within 30 days");
  // Tapping a card's document chip opens its source with the quoted words.
  await block.getByRole("button", { name: /Where this comes from: Group PA, page 8/ }).click();
  await expect(answer.getByTestId("answer-where")).toHaveAttribute("open", "");
  await expect(answer.getByTestId("answer-where")).toContainText("Permanent loss of use of a hand");
  await page.locator(".message.assistant").last().evaluate((el) => el.querySelector("details")?.removeAttribute("open"));
  await shot(page, "2-either-or");
});

test("budget stop: shown as a stop, with one tap per person for a question about several people", async ({ page }) => {
  const answer = await askOnPhone(page, "budgetStop", "Tell me everything every policy pays for everyone in the family");
  const stop = answer.getByTestId("answer-stopped");
  await expect(stop).toBeVisible();
  await expect(stop).toContainText("This question reached its limit");
  await expect(stop).toContainText("asking about each one separately");
  // One tap asks a narrower question, about one person.
  await expect(stop.getByRole("button", { name: "Ask about Grace Tan" })).toBeVisible();
  await shot(page, "3-budget-stop");
  await stop.getByRole("button", { name: "Ask about Grace Tan" }).click();
  await expect(page.getByLabel("Message to DearPolicy")).toHaveValue(/Grace Tan/);
});

test("budget stop on a question about one person: the same question again, not 'ask about one person'", async ({ page }) => {
  const answer = await askOnPhone(page, "budgetStop", "What does Grace’s Group PA pay for a wrist fracture?");
  const stop = answer.getByTestId("answer-stopped");
  await expect(stop).toContainText("This question reached its limit");
  await expect(stop.getByRole("button", { name: /^Ask about/ })).toHaveCount(0);
  await stop.getByRole("button", { name: "Ask again" }).click();
  await expect(page.getByLabel("Message to DearPolicy")).toHaveValue("What does Grace’s Group PA pay for a wrist fracture?");
});
